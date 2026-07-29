import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createSandbox, type CreateSandboxOptions, type Sandbox } from "@ai-hero/sandcastle";
import { docker as dockerSandbox } from "@ai-hero/sandcastle/sandboxes/docker";
import type { RelayConfig } from "../config.js";
import { SandboxError } from "../errors.js";
import {
  assertGhInSandbox,
  detectDockerSocketGid,
  DOCKER_SOCKET_PATH,
  resolveTestcontainersHost,
} from "./docker-host.js";
import { hostGid, hostUid, resolveSandboxImage } from "./sandbox-image.js";
import type { Secrets } from "../host/secrets.js";
import { resolveSkillPlugins, type SkillPlugin } from "./skills.js";

/**
 * A fresh git worktree does not populate submodules, and a target repo that
 * keeps generated resources in one fails to build without them.
 */
const SUBMODULE_INIT = "git submodule update --init --recursive";

/**
 * Hand the repo root inside the sandbox to the sandbox user.
 *
 * A linked worktree's `.git` is a file pointing at an absolute host path, so
 * the host `.git` is mounted at that same path ([ADR-0010](../../docs/adr/0010-the-sandbox-shares-the-hosts-worktree-and-git-directory.md)) —
 * and docker fabricates the directories above a mount target that the image
 * does not have, owned by root. The repo root is one of them: nothing mounts
 * it, relay's mount merely caused it to exist.
 *
 * Tools that resolve state against the main worktree rather than the local one
 * then write into a root-owned directory as a non-root user and fail. nx puts
 * its shared workspace-data there, which is what this fixes; the next tool to
 * do the same thing gets it for free.
 *
 * Not recursive: the `.git` and worktree mounts underneath are real host files,
 * and rewriting their ownership would reach out of the sandbox onto the
 * operator's disk. Only the fabricated directory itself changes hands, so what
 * a tool writes there lives and dies with the container.
 */
function claimRepoRoot(repoRoot: string): string {
  return `chown ${hostUid()}:${hostGid()} ${repoRoot}`;
}

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
 * the pass's base branch, with the runtime mounts wired.
 *
 * The socket's in-container group is added to the non-root sandbox user so the
 * green gate's Testcontainers tier can reach the host daemon.
 */
export function sandboxOptions({
  repoRoot,
  secrets,
  branch,
  baseBranch,
  host,
}: {
  repoRoot: string;
  secrets: Secrets;
  branch: string;
  baseBranch: string;
  host: HostFacts;
}): CreateSandboxOptions {
  return {
    cwd: repoRoot,
    branch,
    baseBranch,
    hooks: {
      host: { onWorktreeReady: [{ command: SUBMODULE_INIT }] },
      sandbox: { onSandboxReady: [{ command: claimRepoRoot(repoRoot), sudo: true }] },
    },
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
  baseBranch,
}: {
  repoRoot: string;
  config: RelayConfig;
  secrets: Secrets;
  branch: string;
  baseBranch: string;
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

  const sandbox = await createSandbox(
    sandboxOptions({
      repoRoot,
      secrets,
      branch,
      baseBranch,
      host: { image, socketGid, testcontainersHost, plugins },
    }),
  );

  await assertRepoRootWritable({ sandbox, repoRoot });
  return sandbox;
}

/**
 * Prove the repo root inside the sandbox took the ownership `claimRepoRoot`
 * asked for, before any leg runs.
 *
 * The hook runs `chown` under the image's own `sudo`, which relay's recipes
 * grant and a repo's hand-written Dockerfile may not. A silent failure here
 * costs a whole pass: the green gate crashes on a permission error with nothing
 * to do with the branch, which is how it presents and not what it is.
 */
async function assertRepoRootWritable({
  sandbox,
  repoRoot,
}: {
  sandbox: Sandbox;
  repoRoot: string;
}): Promise<void> {
  const { exitCode } = await sandbox.exec(`test -w ${repoRoot}`);
  if (exitCode === 0) return;

  await sandbox.close();
  throw new SandboxError(
    `The repo root ${repoRoot} is not writable inside the sandbox. docker fabricates ` +
      "it to hang the host `.git` mount inside, owned by root, and relay's " +
      "`chown` hook did not take — most likely the sandbox image has no working " +
      "`sudo` for its own user. Tools that keep state in the main worktree (nx " +
      "puts its shared workspace-data there) fail on it, and the green gate is " +
      "where you would find out.",
  );
}
