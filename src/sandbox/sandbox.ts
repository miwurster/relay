import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createSandbox, type CreateSandboxOptions, type Sandbox } from "@ai-hero/sandcastle";
import { docker as dockerSandbox } from "@ai-hero/sandcastle/sandboxes/docker";
import type { RelayConfig } from "../config.js";
import {
  assertGhInSandbox,
  detectDockerSocketGid,
  DOCKER_SOCKET_PATH,
  resolveTestcontainersHost,
} from "./docker-host.js";
import { resolveSandboxImage } from "./sandbox-image.js";
import type { Secrets } from "../host/secrets.js";
import { resolveSkillPlugins, type SkillPlugin } from "./skills.js";

/**
 * A fresh git worktree does not populate submodules, and a target repo that
 * keeps generated resources in one fails to build without them.
 */
const SUBMODULE_INIT = "git submodule update --init --recursive";

const execFileAsync = promisify(execFile);

/**
 * What only the host can answer, resolved once per pass: which image to run,
 * how to reach the host daemon, and what to mount.
 */
export interface HostFacts {
  image: string;
  socketGid: number;
  testcontainersHost: string;
  plugins: readonly SkillPlugin[];
}

/**
 * Everything the sandbox mounts at runtime: nothing here is baked into the
 * image, so skills stay at the operator's installed version and credentials
 * stay out of the image.
 */
export function sandboxMounts({ plugins }: { plugins: readonly SkillPlugin[] }) {
  return [
    { hostPath: DOCKER_SOCKET_PATH, sandboxPath: DOCKER_SOCKET_PATH },
    ...plugins.map((plugin) => ({
      hostPath: plugin.hostPath,
      sandboxPath: plugin.sandboxPath,
      readonly: true,
    })),
  ];
}

/**
 * The sandbox environment: the host address Testcontainers must dial, and the
 * credentials the in-sandbox tools authenticate with (`gh`, `claude`).
 *
 * The GitHub token travels as `GH_TOKEN` — the variable `gh` prefers, and the
 * one that cannot collide with what GitHub Actions injects — and reaches the
 * sandbox as an environment variable only, never as a file on its disk.
 */
export function sandboxEnv({
  secrets,
  testcontainersHost,
}: {
  secrets: Secrets;
  testcontainersHost: string;
}): Record<string, string> {
  return {
    TESTCONTAINERS_HOST_OVERRIDE: testcontainersHost,
    GH_TOKEN: secrets.githubToken,
    [secrets.claude.variable]: secrets.claude.token,
  };
}

/** The branch one pass runs on. */
export function passBranch(config: RelayConfig, workItem: number): string {
  return `${config.branchPrefix}${workItem}`;
}

/**
 * Whether the pass's branch is already there. A pass never reuses, resets or
 * deletes one: an existing branch may carry someone else's commits, and losing
 * those is worse than refusing to run.
 */
export async function branchExists(repoRoot: string, branch: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], {
      cwd: repoRoot,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Where a worktree of `branch` is checked out, or `undefined` when none is.
 *
 * A hard-killed pass leaves both its worktree and git's record of it, so
 * `git worktree prune` will not collect it and git refuses to delete the
 * branch until it is gone.
 */
export async function worktreeForBranch(
  repoRoot: string,
  branch: string,
): Promise<string | undefined> {
  const { stdout } = await execFileAsync("git", ["worktree", "list", "--porcelain"], {
    cwd: repoRoot,
  });
  return worktreePathsByBranch(stdout).get(`refs/heads/${branch}`);
}

/** Each registered worktree's branch ref mapped to the path it sits at. */
function worktreePathsByBranch(porcelain: string): Map<string, string> {
  const paths = new Map<string, string>();
  let worktree: string | undefined;

  for (const line of porcelain.split("\n")) {
    if (line.startsWith("worktree ")) {
      worktree = line.slice("worktree ".length).trim();
    } else if (line.startsWith("branch ") && worktree) {
      paths.set(line.slice("branch ".length).trim(), worktree);
    }
  }

  return paths;
}

/**
 * The sandbox one pass runs in: a fresh worktree on its own branch, cut from
 * the repo's default branch, with the runtime mounts wired.
 *
 * The socket's in-container group is added to the non-root sandbox user so the
 * green gate's Testcontainers tier can reach the host daemon.
 */
export function sandboxOptions({
  repoRoot,
  config,
  secrets,
  branch,
  host,
}: {
  repoRoot: string;
  config: RelayConfig;
  secrets: Secrets;
  branch: string;
  host: HostFacts;
}): CreateSandboxOptions {
  return {
    cwd: repoRoot,
    branch,
    baseBranch: config.defaultBranch,
    hooks: { host: { onWorktreeReady: [{ command: SUBMODULE_INIT }] } },
    sandbox: dockerSandbox({
      imageName: host.image,
      groups: [host.socketGid],
      mounts: sandboxMounts({ plugins: host.plugins }),
      env: sandboxEnv({ secrets, testcontainersHost: host.testcontainersHost }),
    }),
  };
}

/**
 * Open the pass's sandbox: resolve the image prebuilt-ref-first, prove it can
 * talk to the tracker, detect what only the host can tell us (socket group,
 * Testcontainers host), mount the installed skills, and create the worktree.
 */
export async function openSandbox({
  repoRoot,
  config,
  secrets,
  branch,
}: {
  repoRoot: string;
  config: RelayConfig;
  secrets: Secrets;
  branch: string;
}): Promise<Sandbox> {
  // Operator setup first: a plugin the host has not installed must not cost a
  // whole image build before it is reported.
  const plugins = await resolveSkillPlugins();

  const [image, testcontainersHost] = await Promise.all([
    resolveSandboxImage({ repoRoot, config }),
    resolveTestcontainersHost(),
  ]);
  // Before the first leg: a tracker-less image must not cost a whole pass.
  await assertGhInSandbox({ image });
  const socketGid = await detectDockerSocketGid({ image });

  return await createSandbox(
    sandboxOptions({
      repoRoot,
      config,
      secrets,
      branch,
      host: { image, socketGid, testcontainersHost, plugins },
    }),
  );
}
