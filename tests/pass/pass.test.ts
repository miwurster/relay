import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Sandbox } from "@ai-hero/sandcastle";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../../src/cli.js";
import { CONFIG_FILE_PATH, relayConfigSchema, RELAY_DIR } from "../../src/config.js";
import type { Crew } from "../../src/crew/contract.js";
import { ConfigError, SandboxError } from "../../src/errors.js";
import { ExitCode } from "../../src/exit-codes.js";
import type { GitHubClient, GitHubIssue } from "../../src/tracker/github.js";
import { type PassRun, runPass, runPassOnItem } from "../../src/pass/pass.js";

import { createStubCrew } from "../crew/stub-crew.js";
import type { Secrets } from "../../src/host/secrets.js";
import { TRACKER_DOC_PATH } from "../../src/tracker/tracker-doc.js";

const validConfig = `export default {
  defaultBranch: "main",
};`;

const secrets = ["GH_TOKEN=gh-token", "CLAUDE_CODE_OAUTH_TOKEN=oauth-token"];

/** A repo root with a valid config, made the process's working directory. */
async function repoWithValidConfig(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "relay-pass-"));
  await mkdir(join(root, RELAY_DIR), { recursive: true });
  await writeFile(join(root, CONFIG_FILE_PATH), validConfig, "utf8");
  vi.spyOn(process, "cwd").mockReturnValue(root);
  return root;
}

/** The tracker doc every tracker-facing role is told to read first. */
async function withTrackerDoc(root: string): Promise<void> {
  await mkdir(join(root, TRACKER_DOC_PATH, ".."), { recursive: true });
  await writeFile(join(root, TRACKER_DOC_PATH), "# Issue tracker: GitHub\n", "utf8");
}

/** Every secret present, resolved from the environment rather than a file. */
function withSecrets(): void {
  for (const secret of secrets) {
    const [key = "", value = ""] = secret.split("=");
    vi.stubEnv(key, value);
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("runPass", () => {
  it("fails fast when the repo has no config", async () => {
    const empty = await mkdtemp(join(tmpdir(), "relay-pass-"));
    vi.spyOn(process, "cwd").mockReturnValue(empty);
    await expect(runPass("1")).rejects.toThrow(ConfigError);
  });

  it("fails fast when a secret cannot be resolved", async () => {
    await repoWithValidConfig();
    await expect(runPass("1")).rejects.toThrow(/Missing secret/);
  });

  it("fails when the repo commits no tracker doc, before reaching GitHub", async () => {
    await repoWithValidConfig();
    withSecrets();

    await expect(runPass("1")).rejects.toThrow(/issue-tracker\.md/);
  });

  it("rejects an argument that names no issue", async () => {
    const root = await repoWithValidConfig();
    await withTrackerDoc(root);
    withSecrets();

    await expect(runPass("PSD-1")).rejects.toThrow(/does not name a GitHub issue/);
  });
});

const execFileAsync = promisify(execFile);

const issue: GitHubIssue = {
  number: 1,
  labels: ["ready-for-agent"],
  isOpen: true,
  blockedBy: [],
  subIssues: [],
};

const passSecrets: Secrets = {
  githubToken: "gh-token",
  claude: { variable: "CLAUDE_CODE_OAUTH_TOKEN", token: "oauth-token" },
  sources: [
    { variable: "GH_TOKEN", from: "environment" },
    { variable: "CLAUDE_CODE_OAUTH_TOKEN", from: "environment" },
  ],
};

const passConfig = relayConfigSchema.parse({
  defaultBranch: "main",
});

/** A GitHub that records the crash comment and answers nothing else. */
function fakeGitHub() {
  const comments: { number: number; text: string }[] = [];
  const github: GitHubClient = {
    async repository() {
      return "kipu-quantum/relay";
    },
    async frontier() {
      return [];
    },
    async getIssue() {
      return issue;
    },
    async addComment(number, text) {
      comments.push({ number, text });
    },
  };
  return { github, comments };
}

/** A sandbox that records its disposal and never touches docker. */
function fakeSandbox() {
  let closed = false;
  const opened = {
    branch: "agent/1",
    close: async () => {
      closed = true;
    },
  } as unknown as Sandbox;
  return { open: async () => opened, wasClosed: () => closed };
}

async function gitRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "relay-branch-"));
  await execFileAsync("git", ["init", "--initial-branch=main"], { cwd: root });
  return root;
}

/** A first commit, so the repo has a branch a collision can happen on. */
async function commit(root: string): Promise<void> {
  const identity = {
    GIT_AUTHOR_NAME: "relay",
    GIT_AUTHOR_EMAIL: "relay@example.com",
    GIT_COMMITTER_NAME: "relay",
    GIT_COMMITTER_EMAIL: "relay@example.com",
  };
  await execFileAsync("git", ["commit", "--allow-empty", "-m", "root"], {
    cwd: root,
    env: { ...process.env, ...identity },
  });
}

/** Run one pass over the fake item, varying only what a test cares about. */
async function runOnePass(overrides: Partial<PassRun> & { github: GitHubClient }) {
  return await runPassOnItem({
    repoRoot: await gitRepo(),
    config: passConfig,
    secrets: passSecrets,
    issue,
    open: fakeSandbox().open,
    createCrew: () => createStubCrew(),
    ...overrides,
  });
}

/** A crew whose implementer leg dies, standing in for any in-pass crash. */
function crashingCrew(): Crew {
  return {
    ...createStubCrew(),
    async implement() {
      throw new Error("the sandbox died");
    },
  };
}

/** The exit code the CLI ends on for a pass that throws. */
async function exitCodeOf(run: () => Promise<ExitCode>): Promise<ExitCode> {
  vi.spyOn(console, "error").mockImplementation(() => {});
  return await runCli(["1"], {
    runPass: run,
    runDoctor: async () => ExitCode.Success,
    runInit: async () => ExitCode.Success,
  });
}

describe("runPassOnItem", () => {
  it("maps a reviewable pass to exit 0 and disposes of the sandbox", async () => {
    const { github } = fakeGitHub();
    const sandbox = fakeSandbox();

    const code = await runOnePass({ github, open: sandbox.open });

    expect(code).toBe(ExitCode.Success);
    expect(sandbox.wasClosed()).toBe(true);
  });

  it("maps a blocked pass to exit 1", async () => {
    const { github } = fakeGitHub();
    const bailingCrew: Crew = {
      ...createStubCrew(),
      async plan() {
        return { kind: "under-specified", reason: "no acceptance criteria" };
      },
    };

    const code = await runOnePass({ github, createCrew: () => bailingCrew });

    expect(code).toBe(ExitCode.Blocked);
  });

  it("on a crash comments on the item, disposes of the sandbox, and rethrows", async () => {
    const { github, comments } = fakeGitHub();
    const sandbox = fakeSandbox();

    await expect(
      runOnePass({ github, open: sandbox.open, createCrew: crashingCrew }),
    ).rejects.toThrow("the sandbox died");

    expect(sandbox.wasClosed()).toBe(true);
    expect(comments).toHaveLength(1);
    expect(comments[0]?.text).toMatch(/the sandbox died[\s\S]*left labelled `agent-in-progress`/);
  });

  it("tells the human on the item how to lift the hold a crash left behind", async () => {
    const { github, comments } = fakeGitHub();

    await expect(runOnePass({ github, createCrew: crashingCrew })).rejects.toThrow(
      "the sandbox died",
    );

    expect(comments[0]?.text).toContain("git branch -D agent/1");
    expect(comments[0]?.text).toContain("gh issue edit 1 --remove-label agent-in-progress");
  });

  it("comments too when the sandbox never opened", async () => {
    const { github, comments } = fakeGitHub();

    await expect(
      runOnePass({
        github,
        open: async () => {
          throw new SandboxError("docker is not running");
        },
      }),
    ).rejects.toThrow("docker is not running");

    expect(comments[0]?.text).toMatch(/docker is not running/);
  });

  it("keeps a failed pass failing when GitHub will not take the crash comment", async () => {
    const { github } = fakeGitHub();
    github.addComment = async () => {
      throw new Error("gh: HTTP 500");
    };
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(runOnePass({ github, createCrew: crashingCrew })).rejects.toThrow(
      "the sandbox died",
    );
  });

  it("refuses to run when the pass branch already exists, without opening a sandbox", async () => {
    const root = await gitRepo();
    await commit(root);
    await execFileAsync("git", ["branch", "agent/1"], { cwd: root });
    const { github } = fakeGitHub();
    const open = vi.fn();

    await expect(runOnePass({ github, repoRoot: root, open })).rejects.toThrow(
      /agent\/1 already exists/,
    );

    expect(open).not.toHaveBeenCalled();
    // The refusal never touches the branch it refused over.
    const { stdout } = await execFileAsync("git", ["rev-parse", "agent/1"], { cwd: root });
    expect(stdout.trim()).toHaveLength(40);
  });

  it("names the leftover worktree when a crashed pass left the branch checked out", async () => {
    const root = await gitRepo();
    await commit(root);
    const worktree = join(root, ".sandcastle", "worktrees", "agent-1");
    await execFileAsync("git", ["worktree", "add", "-b", "agent/1", worktree], { cwd: root });
    const { github } = fakeGitHub();

    await expect(runOnePass({ github, repoRoot: root, open: vi.fn() })).rejects.toThrow(
      /git worktree remove --force/,
    );
  });

  it("maps a crash to exit 2", async () => {
    const { github } = fakeGitHub();

    const code = await exitCodeOf(() => runOnePass({ github, createCrew: crashingCrew }));

    expect(code).toBe(ExitCode.Error);
  });

  it("maps a branch collision to exit 2", async () => {
    const root = await gitRepo();
    await commit(root);
    await execFileAsync("git", ["branch", "agent/1"], { cwd: root });
    const { github } = fakeGitHub();

    const code = await exitCodeOf(() => runOnePass({ github, repoRoot: root }));

    expect(code).toBe(ExitCode.Error);
  });
});
