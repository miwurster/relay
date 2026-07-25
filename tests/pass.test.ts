import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Sandbox } from "@ai-hero/sandcastle";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli.js";
import { relayConfigSchema } from "../src/config.js";
import type { Crew } from "../src/crew.js";
import { ConfigError, SandboxError } from "../src/errors.js";
import { ExitCode } from "../src/exit-codes.js";
import type { JiraClient, JiraIssue } from "../src/jira.js";
import { type PassRun, runPass, runPassOnItem } from "../src/pass.js";
import type { RelaySandbox } from "../src/sandbox.js";
import { createStubCrew } from "../src/stub-crew.js";
import type { Secrets } from "../src/secrets.js";
import { TRACKER_DOC_PATH } from "../src/tracker-doc.js";

const validConfig = `export default {
  greenGate: "make test",
  defaultBranch: "main",
  jira: { baseUrl: "https://example.atlassian.net" },
};`;

const trackerDoc = `# Issue tracker: Jira

## Setup constants

- **Jira project key:** \`PSD\`
- **Repo label:** \`repo:qc-catalog\`
`;

const secrets = [
  "ATLASSIAN_SA_EMAIL=relay@kipu-quantum.com",
  "ATLASSIAN_SA_TOKEN=sa-token",
  "GITLAB_TOKEN=gl-token",
  "CLAUDE_CODE_OAUTH_TOKEN=oauth-token",
];

/** A repo root with a valid config, made the process's working directory. */
async function repoWithValidConfig(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "relay-pass-"));
  await writeFile(join(root, "relay.config.ts"), validConfig, "utf8");
  vi.spyOn(process, "cwd").mockReturnValue(root);
  return root;
}

/** Every secret present, resolved from the environment rather than a file. */
async function withSecrets(): Promise<void> {
  vi.stubEnv("XDG_CONFIG_HOME", await mkdtemp(join(tmpdir(), "relay-home-")));
  for (const secret of secrets) {
    const [key, value] = secret.split("=");
    vi.stubEnv(key!, value!);
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
    await expect(runPass("PSD-1")).rejects.toThrow(ConfigError);
  });

  it("fails fast when a secret cannot be resolved", async () => {
    await repoWithValidConfig();
    vi.stubEnv("XDG_CONFIG_HOME", await mkdtemp(join(tmpdir(), "relay-empty-home-")));
    await expect(runPass("PSD-1")).rejects.toThrow(/Missing secret/);
  });

  it("fails when the repo has no tracker doc to scope selection with", async () => {
    await repoWithValidConfig();
    await withSecrets();

    await expect(runPass("PSD-1")).rejects.toThrow(/issue-tracker\.md/);
  });

  it("resolves the tracker scope before reaching Jira", async () => {
    const root = await repoWithValidConfig();
    await mkdir(join(root, TRACKER_DOC_PATH, ".."), { recursive: true });
    await writeFile(join(root, TRACKER_DOC_PATH), trackerDoc, "utf8");
    await withSecrets();
    // No network in tests: the pass gets as far as its first Jira call.
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 401 })));

    await expect(runPass("PSD-1")).rejects.toThrow(/Jira 401/);
  });
});

const execFileAsync = promisify(execFile);

const issue: JiraIssue = {
  key: "PSD-1",
  issueType: "Story",
  labels: ["ready-for-agent"],
  isDone: false,
  blockedBy: [],
};

const passSecrets: Secrets = {
  atlassian: { email: "relay@kipu-quantum.com", token: "sa-token" },
  gitlabToken: "gl-token",
  claude: { variable: "CLAUDE_CODE_OAUTH_TOKEN", token: "oauth-token" },
};

const passConfig = relayConfigSchema.parse({
  greenGate: "make test",
  defaultBranch: "main",
  jira: { baseUrl: "https://example.atlassian.net" },
});

/** A Jira that records the crash comment and answers nothing else. */
function fakeJira() {
  const comments: { key: string; text: string }[] = [];
  const jira: JiraClient = {
    async search() {
      return [];
    },
    async getIssue() {
      return issue;
    },
    async addComment(key, text) {
      comments.push({ key, text });
    },
  };
  return { jira, comments };
}

/** A sandbox that records its disposal and never touches docker. */
function fakeSandbox() {
  let closed = false;
  const opened: RelaySandbox = {
    sandbox: { branch: "agent/PSD-1" } as Sandbox,
    close: async () => {
      closed = true;
    },
  };
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
async function runOnePass(overrides: Partial<PassRun> & { jira: JiraClient }) {
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
  return await runCli(["PSD-1"], { runPass: run, runDoctor: async () => ExitCode.Success });
}

describe("runPassOnItem", () => {
  it("maps a reviewable pass to exit 0 and disposes of the sandbox", async () => {
    const { jira } = fakeJira();
    const sandbox = fakeSandbox();

    const code = await runOnePass({ jira, open: sandbox.open });

    expect(code).toBe(ExitCode.Success);
    expect(sandbox.wasClosed()).toBe(true);
  });

  it("maps a blocked pass to exit 1", async () => {
    const { jira } = fakeJira();
    const bailingCrew: Crew = {
      ...createStubCrew(),
      async plan() {
        return { kind: "under-specified", reason: "no acceptance criteria" };
      },
    };

    const code = await runOnePass({ jira, createCrew: () => bailingCrew });

    expect(code).toBe(ExitCode.Blocked);
  });

  it("on a crash comments on the item, disposes of the sandbox, and rethrows", async () => {
    const { jira, comments } = fakeJira();
    const sandbox = fakeSandbox();

    await expect(
      runOnePass({ jira, open: sandbox.open, createCrew: crashingCrew }),
    ).rejects.toThrow("the sandbox died");

    expect(sandbox.wasClosed()).toBe(true);
    expect(comments).toHaveLength(1);
    expect(comments[0]?.text).toMatch(/the sandbox died[\s\S]*left In Progress/);
  });

  it("comments too when the sandbox never opened", async () => {
    const { jira, comments } = fakeJira();

    await expect(
      runOnePass({
        jira,
        open: async () => {
          throw new SandboxError("docker is not running");
        },
      }),
    ).rejects.toThrow("docker is not running");

    expect(comments[0]?.text).toMatch(/docker is not running/);
  });

  it("keeps a failed pass failing when Jira will not take the crash comment", async () => {
    const { jira } = fakeJira();
    jira.addComment = async () => {
      throw new Error("Jira 500");
    };
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(runOnePass({ jira, createCrew: crashingCrew })).rejects.toThrow(
      "the sandbox died",
    );
  });

  it("refuses to run when the pass branch already exists, without opening a sandbox", async () => {
    const root = await gitRepo();
    await commit(root);
    await execFileAsync("git", ["branch", "agent/PSD-1"], { cwd: root });
    const { jira } = fakeJira();
    const open = vi.fn();

    await expect(runOnePass({ jira, repoRoot: root, open })).rejects.toThrow(
      /agent\/PSD-1 already exists/,
    );

    expect(open).not.toHaveBeenCalled();
    // The refusal never touches the branch it refused over.
    const { stdout } = await execFileAsync("git", ["rev-parse", "agent/PSD-1"], { cwd: root });
    expect(stdout.trim()).toHaveLength(40);
  });

  it("maps a crash to exit 2", async () => {
    const { jira } = fakeJira();

    const code = await exitCodeOf(() => runOnePass({ jira, createCrew: crashingCrew }));

    expect(code).toBe(ExitCode.Error);
  });

  it("maps a branch collision to exit 2", async () => {
    const root = await gitRepo();
    await commit(root);
    await execFileAsync("git", ["branch", "agent/PSD-1"], { cwd: root });
    const { jira } = fakeJira();

    const code = await exitCodeOf(() => runOnePass({ jira, repoRoot: root }));

    expect(code).toBe(ExitCode.Error);
  });
});
