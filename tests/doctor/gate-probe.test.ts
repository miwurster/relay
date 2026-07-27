import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Sandbox, SandboxRunResult } from "@ai-hero/sandcastle";
import { beforeEach, describe, expect, it } from "vitest";
import { relayConfigSchema } from "../../src/config.js";
import { RoleError } from "../../src/errors.js";
import { probeGate } from "../../src/doctor/gate-probe.js";
import { RESOLVED_GATE_TAG } from "../../src/crew/roles/gate-resolver.js";
import type { Secrets } from "../../src/host/secrets.js";

const config = relayConfigSchema.parse({ defaultBranch: "main" });

const secrets: Secrets = {
  githubToken: "gh-token",
  claude: { variable: "CLAUDE_CODE_OAUTH_TOKEN", token: "oauth-token" },
};

const declaredGate =
  `<${RESOLVED_GATE_TAG}>` +
  '{"command":"npm run verify","provenance":"declared","source":"AGENTS.md"}' +
  `</${RESOLVED_GATE_TAG}>`;

/** A sandbox that answers the resolver run and records that it was closed. */
function fakeSandbox(stdout: string, onClose: () => void = () => {}) {
  const state = { closed: 0 };
  const sandbox = {
    async run(): Promise<SandboxRunResult> {
      return { iterations: [], stdout, commits: [] };
    },
    async close() {
      state.closed += 1;
      onClose();
    },
  } as unknown as Sandbox;
  return { sandbox, state };
}

/**
 * Records every `git` invocation. The existence check answers as though the
 * branch is there, since a probe that opened a sandbox has one.
 */
function fakeGit(onDelete: () => void = () => {}) {
  const calls: string[][] = [];
  const git = async (args: readonly string[]) => {
    calls.push([...args]);
    if (args.includes("-D")) onDelete();
    return "";
  };
  return { git, calls };
}

/** The branch name `open` was asked for, out of the recorded calls. */
function openedBranch(opens: { branch: string }[]): string {
  const branch = opens[0]?.branch;
  if (branch === undefined) throw new Error("the probe never opened a sandbox");
  return branch;
}

/** The `git branch -D` calls, which is all the cleanup assertions care about. */
function deletes(calls: string[][]): string[][] {
  return calls.filter((call) => call.includes("-D"));
}

function probing(
  stdout: string,
  { onClose, onDelete }: { onClose?: () => void; onDelete?: () => void } = {},
) {
  const { sandbox, state } = fakeSandbox(stdout, onClose);
  const { git, calls } = fakeGit(onDelete);
  const opens: { branch: string }[] = [];
  const open = async ({ branch }: { branch: string }) => {
    opens.push({ branch });
    return sandbox;
  };
  return {
    run: () => probeGate({ repoRoot, config, secrets, open, git }),
    state,
    opens,
    gitCalls: calls,
  };
}

const throws = (message: string) => () => {
  throw new Error(message);
};

let repoRoot: string;

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), "relay-gate-probe-"));
});

describe("probeGate", () => {
  it("answers with the gate the resolver read out of the repo's docs", async () => {
    const { run } = probing(declaredGate);

    await expect(run()).resolves.toEqual({
      command: "npm run verify",
      provenance: "declared",
      source: "AGENTS.md",
    });
  });

  it("runs on a branch off the configured prefix that no pass could be using", async () => {
    const { run, opens } = probing(declaredGate);

    await run();

    const branch = openedBranch(opens);
    expect(branch.startsWith(config.branchPrefix)).toBe(true);
    expect(branch.slice(config.branchPrefix.length)).not.toMatch(/^\d+$/);
  });

  it("disposes of its sandbox and deletes its branch, so doctor can run twice", async () => {
    const { run, state, opens, gitCalls } = probing(declaredGate);

    await run();

    expect(state.closed).toBe(1);
    expect(deletes(gitCalls)).toEqual([["-C", repoRoot, "branch", "-D", openedBranch(opens)]]);
  });

  it("cleans up after a resolver that failed, so the next run is not blocked", async () => {
    const { run, state, gitCalls } = probing("no tagged block here");

    await expect(run()).rejects.toThrow(RoleError);

    expect(state.closed).toBe(1);
    expect(deletes(gitCalls)).toHaveLength(1);
  });

  it("still deletes its branch when disposing of the sandbox threw", async () => {
    const { run, gitCalls } = probing(declaredGate, { onClose: throws("container is gone") });

    await expect(run()).resolves.toMatchObject({ command: "npm run verify" });

    expect(deletes(gitCalls)).toHaveLength(1);
  });

  it("lets the resolver's failure stand rather than the cleanup's", async () => {
    const { run } = probing("no tagged block here", { onDelete: throws("branch not found") });

    await expect(run()).rejects.toThrow(RoleError);
  });

  it("leaves a branch it never created alone", async () => {
    const calls: string[][] = [];
    const git = async (args: readonly string[]) => {
      calls.push([...args]);
      if (args.includes("show-ref")) throw new Error("no such ref");
      return "";
    };
    const open = async () => {
      throw new Error("docker daemon is not reachable");
    };

    await expect(probeGate({ repoRoot, config, secrets, open, git })).rejects.toThrow(
      "docker daemon is not reachable",
    );

    expect(deletes(calls)).toEqual([]);
  });
});
