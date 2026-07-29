import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { cp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Sandbox } from "@ai-hero/sandcastle";
import { expect, it } from "vitest";
import { DEFAULT_DOCKERFILE_PATH, loadConfig } from "../src/config.js";
import { resourcePath } from "../src/resources.js";
import { openSandbox } from "../src/sandbox/sandbox.js";
import type { Secrets } from "../src/host/secrets.js";

const execFileAsync = promisify(execFile);

/** The fixture repo the probe opens a sandbox over. */
const FIXTURE = "pnpm-testcontainers";

/**
 * Where the fixture is copied to. The basename is stable on purpose:
 * `sandboxImageName` tags the built image after it, so a fresh temp name every
 * run would mint a new tag every run and pay a rebuild for it.
 *
 * Resolved through `realpathSync`, because macOS hands out `/var/folders/…` for
 * the temp directory and that is a symlink to `/private/var/folders/…`. A linked
 * worktree's `.git` file records one of those paths while the mount lands at the
 * other, and git inside the sandbox then finds no repository at all.
 */
const PROBE_DIR = join(realpathSync(tmpdir()), `relay-probe-${FIXTURE}`);

/** The branch the probe's worktree is cut on, inside the fixture's own clone. */
const PROBE_BRANCH = "agent/sandbox-probe";
const BASE_BRANCH = "main";

/**
 * What the fixture's test prints after a real query. Grepped rather than
 * trusted, because a suite that matched no file exits green: the exit code
 * alone is too weak an oracle for a probe that is itself the assertion.
 */
const MARKER = "sandbox probe: PostgreSQL";

/**
 * The credentials the probe runs on: placeholders. It spends no Claude session
 * and calls no tracker, so demanding real tokens would gate a Docker plumbing
 * check on secrets it never reads.
 */
const DUMMY_SECRETS: Secrets = {
  githubToken: "probe-not-a-real-token",
  claude: { variable: "ANTHROPIC_API_KEY", token: "probe-not-a-real-token" },
  sources: [],
};

/**
 * The sandbox probe: open a sandbox the way a pass does, and run a target
 * repo's own command in it against a sibling container.
 *
 * Sibling of `src/doctor/gate-probe.ts` — open, answer one question, tear down —
 * and one layer deeper than doctor's `dockerDaemonVersionInSandbox`, which
 * proves only that the sandbox user reaches the socket. Here a container is
 * actually started, its port published on the host daemon, and queried.
 *
 * It uses the real `openSandbox` rather than assembling its own options: a
 * probe over a configuration nothing else uses is how a spike-grade proof goes
 * stale.
 */
it(
  "runs the fixture's Testcontainers tier inside a sandbox",
  { timeout: 30 * 60 * 1000 },
  async () => {
    await inSandbox(async (sandbox) => {
      // Setup, and reported as setup: "the npm registry is unreachable or the
      // lockfile is stale" is a different problem, with a different owner, than
      // "the sandbox cannot reach the sibling container".
      const install = await sandbox.exec("pnpm install --frozen-lockfile");
      expect(install.exitCode, `pnpm install failed:\n${install.stdout}\n${install.stderr}`).toBe(
        0,
      );

      const verify = await sandbox.exec("pnpm verify");
      expect(verify.exitCode, `pnpm verify failed:\n${verify.stdout}\n${verify.stderr}`).toBe(0);
      expect(
        `${verify.stdout}\n${verify.stderr}`,
        "pnpm verify was green but printed no marker, so the integration test never ran",
      ).toContain(MARKER);
    });
  },
);

/**
 * The regression this probe exists for as much as the container one.
 *
 * A leg runs in a linked worktree, whose `.git` is a file pointing at an
 * absolute host path, so the host `.git` is mounted at that same path — and
 * docker fabricates the directories above it as root. nx keeps its shared
 * workspace-data in the *main* worktree rather than the local one, so it writes
 * into that fabricated directory and a non-root leg gets EACCES, before any
 * target of the green gate runs.
 *
 * Two things are asserted, because either alone can pass while the pass is
 * broken: git resolves a common dir at all (a path mismatch leaves none), and
 * the main worktree root is writable by the sandbox user.
 */
it(
  "leaves the main worktree root writable by the sandbox user",
  { timeout: 30 * 60 * 1000 },
  async () => {
    await inSandbox(async (sandbox) => {
      const commonDir = await sandbox.exec("git rev-parse --git-common-dir");
      expect(commonDir.exitCode, `git could not resolve its common dir:\n${commonDir.stderr}`).toBe(
        0,
      );
      expect(
        commonDir.stdout.trim(),
        "git resolved no common dir, so the worktree's gitdir pointer and the mount disagree",
      ).not.toBe("");

      // What nx does: resolve the main worktree from the gitdir pointer, then
      // write cache state into it.
      const write = await sandbox.exec(
        'main="$(dirname "$(git rev-parse --git-common-dir)")"; ' +
          'ls -ld "$main"; mkdir -p "$main/.nx/workspace-data" && echo WRITABLE',
      );
      expect(
        write.exitCode,
        `the main worktree root is not writable by the sandbox user:\n${write.stdout}\n${write.stderr}`,
      ).toBe(0);
      expect(write.stdout).toContain("WRITABLE");
    });
  },
);

/**
 * Open a sandbox over a freshly built fixture clone, run one question against
 * it, and take it down — the shape `src/doctor/gate-probe.ts` already uses.
 */
async function inSandbox(ask: (sandbox: Sandbox) => Promise<void>): Promise<void> {
  await prepareFixtureRepo();
  const config = await loadConfig(PROBE_DIR);

  let sandbox: Sandbox | undefined;
  let green = false;
  try {
    sandbox = await openSandbox({
      repoRoot: PROBE_DIR,
      config,
      secrets: DUMMY_SECRETS,
      branch: PROBE_BRANCH,
      baseBranch: BASE_BRANCH,
    });
    await ask(sandbox);
    green = true;
  } finally {
    await dispose({ sandbox, green });
  }
}

/**
 * Build the fixture's clone from scratch: a copy of the committed fixture, the
 * sandbox recipe relay ships, and one commit — a git worktree checks out
 * committed files only, so anything left uncommitted would never reach the
 * sandbox.
 */
async function prepareFixtureRepo(): Promise<void> {
  await rm(PROBE_DIR, { recursive: true, force: true });
  await mkdir(PROBE_DIR, { recursive: true });
  await cp(join(import.meta.dirname, "..", "fixtures", FIXTURE), PROBE_DIR, { recursive: true });
  await cp(
    resourcePath("sandbox-recipes", "node.Dockerfile"),
    join(PROBE_DIR, DEFAULT_DOCKERFILE_PATH),
  );

  // Identity on the commands rather than in the repo's config: the probe's
  // clone is disposable, and a host with no global identity must still be able
  // to run it.
  await git(["init", "--initial-branch", BASE_BRANCH]);
  await git(["add", "--all"]);
  await git([
    "-c",
    "user.name=relay sandbox probe",
    "-c",
    "user.email=probe@relay.invalid",
    "commit",
    "--message",
    "The sandbox probe's fixture",
  ]);
}

async function git(args: readonly string[]): Promise<void> {
  await execFileAsync("git", ["-C", PROBE_DIR, ...args]);
}

/**
 * Take the sandbox down either way, and keep the fixture's clone when the probe
 * failed: what pnpm and vitest left in that worktree is the diagnosis, the same
 * reason a crashed pass leaves its work for a human (ADR-0003).
 *
 * Cleanup may not replace the failure that brought us here, so a dispose that
 * cannot finish is reported and swallowed.
 */
async function dispose({
  sandbox,
  green,
}: {
  sandbox: Sandbox | undefined;
  green: boolean;
}): Promise<void> {
  try {
    await sandbox?.close();
  } catch (error) {
    console.error("sandbox probe: could not dispose of the sandbox:", error);
  }

  if (!green) {
    console.error(
      `sandbox probe: left the fixture's clone at ${PROBE_DIR} — yours to read and delete.`,
    );
    return;
  }

  try {
    await rm(PROBE_DIR, { recursive: true, force: true });
  } catch (error) {
    console.error(`sandbox probe: could not remove ${PROBE_DIR}:`, error);
  }
}
