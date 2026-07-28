import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Sandbox, SandboxRunOptions, SandboxRunResult } from "@ai-hero/sandcastle";
import { beforeEach, describe, expect, it } from "vitest";
import { relayConfigSchema } from "../../../src/config.js";
import type { GateResult } from "../../../src/crew/contract.js";
import { GitError, RoleError } from "../../../src/errors.js";
import { createLander, LAND_TAG } from "../../../src/crew/roles/lander.js";
import { readResource } from "../../../src/resources.js";
import { expectPromptParity } from "./prompt-parity.js";

const config = relayConfigSchema.parse({ landing: "merge" });

const repoRoot = "/repo";
const branch = "agent/7";
const baseBranch = "main";

const green: GateResult = { green: true, detail: "`npm run verify` exited 0" };
const red: GateResult = { green: false, detail: "`npm run verify`: two cart tests fail" };

const tagged = (json: string) => `Rebased it.\n<${LAND_TAG}>${json}</${LAND_TAG}>`;

/**
 * A lander over a leg that reported `stdout`, a gate that answered `verdict`,
 * and a host `git` that records what it was asked and fails what `refuse` names.
 */
function landing({
  stdout,
  verdict = green,
  refuse,
}: {
  stdout: string;
  verdict?: GateResult;
  refuse?: "merge" | "push";
}) {
  const runs: SandboxRunOptions[] = [];
  const sandbox = {
    async run(options: SandboxRunOptions): Promise<SandboxRunResult> {
      runs.push(options);
      return { iterations: [], stdout, commits: [] };
    },
  } as unknown as Sandbox;

  const gitCalls: string[][] = [];
  const git = async (args: readonly string[]) => {
    gitCalls.push([...args]);
    if (refuse && args.includes(refuse)) {
      throw new GitError(`git ${args.join(" ")} failed: refused`);
    }
    return "";
  };

  const regates: number[] = [];
  const regate = async (): Promise<GateResult> => {
    regates.push(gitCalls.length);
    return verdict;
  };

  const land = createLander({ sandbox, config, recordDir, repoRoot, branch, baseBranch, git });
  return { land: () => land(regate), runs, gitCalls, regates };
}

let recordDir: string;

beforeEach(async () => {
  recordDir = await mkdtemp(join(tmpdir(), "relay-lander-"));
});

describe("createLander", () => {
  it("lands a clean rebase, on the lander's model", async () => {
    const { land, runs } = landing({ stdout: tagged('{"kind":"rebased"}') });

    const result = await land();

    expect(result).toEqual({
      kind: "landed",
      detail: "agent/7 was rebased onto main, which fast-forwarded onto it and was pushed.",
    });
    expect(runs.map((run) => run.name)).toEqual(["lander"]);
    expect(
      runs[0]?.agent.buildPrintCommand({ prompt: "", dangerouslySkipPermissions: true }).command,
    ).toContain(`--model '${config.models.lander}'`);
  });

  it("tells the leg which branch it lands on which", async () => {
    const { land, runs } = landing({ stdout: tagged('{"kind":"rebased"}') });

    await land();

    expect(runs[0]?.promptArgs).toEqual({ BRANCH: branch, BASE_BRANCH: baseBranch });
    await expectPromptParity(runs[0], "lander.md");
  });

  it("reports the merge a conflict fell back to", async () => {
    const { land } = landing({ stdout: tagged('{"kind":"merged"}') });

    const result = await land();

    expect(result).toMatchObject({ kind: "landed" });
    expect(result).toHaveProperty(
      "detail",
      "agent/7 was merged onto main, which fast-forwarded onto it and was pushed.",
    );
  });

  it("fast-forwards the base branch onto the pass branch and then pushes it, in that order", async () => {
    const { land, gitCalls } = landing({ stdout: tagged('{"kind":"rebased"}') });

    await land();

    expect(gitCalls).toEqual([
      ["-C", repoRoot, "merge", "--ff-only", branch],
      ["-C", repoRoot, "push", "origin", baseBranch],
    ]);
  });

  it("touches the host only after the gate has passed on what will land", async () => {
    const { land, regates } = landing({ stdout: tagged('{"kind":"rebased"}') });

    await land();

    expect(regates).toEqual([0]);
  });

  it("reports a red re-gate and leaves the host alone", async () => {
    const { land, gitCalls } = landing({ stdout: tagged('{"kind":"rebased"}'), verdict: red });

    const result = await land();

    expect(result).toEqual({
      kind: "not-landed",
      reason: "agent/7 is red once main is in it: `npm run verify`: two cart tests fail",
    });
    expect(gitCalls).toEqual([]);
  });

  it("reports a refused fast-forward rather than forcing one", async () => {
    const { land, gitCalls } = landing({
      stdout: tagged('{"kind":"rebased"}'),
      refuse: "merge",
    });

    const result = await land();

    expect(result).toMatchObject({ kind: "not-landed" });
    expect(result).toHaveProperty("reason", expect.stringContaining("never forces one"));
    expect(gitCalls.map(([, , command]) => command)).toEqual(["merge"]);
  });

  it("reports a rejected push rather than retrying it", async () => {
    const { land, gitCalls } = landing({ stdout: tagged('{"kind":"rebased"}'), refuse: "push" });

    const result = await land();

    expect(result).toMatchObject({ kind: "not-landed" });
    expect(result).toHaveProperty("reason", expect.stringContaining("nothing was closed"));
    expect(gitCalls.map(([, , command]) => command)).toEqual(["merge", "push"]);
  });

  it("reports a leg that could not resolve the conflict, without gating or pushing", async () => {
    const { land, gitCalls, regates } = landing({
      stdout: tagged('{"kind":"stuck","reason":"main deleted the port this branch builds on"}'),
    });

    const result = await land();

    expect(result).toEqual({
      kind: "not-landed",
      reason: "main deleted the port this branch builds on",
    });
    expect(regates).toEqual([]);
    expect(gitCalls).toEqual([]);
  });

  it("refuses a leg that said nothing about what it did", async () => {
    const { land } = landing({ stdout: "I had a go at the rebase." });

    await expect(land()).rejects.toThrow(RoleError);
  });

  it("refuses a leg that gave up without saying why", async () => {
    const { land } = landing({ stdout: tagged('{"kind":"stuck"}') });

    await expect(land()).rejects.toThrow(RoleError);
  });

  it("leaves the leg's answer on the host", async () => {
    const { land } = landing({ stdout: tagged('{"kind":"merged"}') });

    await land();

    const written = await readFile(join(recordDir, "lander.status.json"), "utf8");
    expect(JSON.parse(written)).toEqual({
      role: "lander",
      model: config.models.lander,
      answer: { kind: "merged" },
    });
  });
});

/**
 * How the branches are moved lives in the leg's prompt, so what the prompt
 * instructs is the only thing there is to assert about the rebase itself.
 */
describe("the lander prompt", () => {
  let prompt: string;

  beforeEach(async () => {
    prompt = await readResource("lander.md");
  });

  it("rebases onto the host's own base branch, not the remote's", () => {
    expect(prompt).toContain("git rebase {{BASE_BRANCH}}");
    expect(prompt).not.toContain("git rebase origin/");
    expect(prompt).not.toContain("git fetch");
  });

  it("falls back to one merge on conflict rather than resolving commit by commit", () => {
    expect(prompt).toContain("git rebase --abort");
    expect(prompt).toContain("git merge {{BASE_BRANCH}}");
    expect(prompt).toMatch(/not\*\* resolve conflicts commit by commit/);
  });

  it("keeps the leg off the base branch, the tracker and the remote", () => {
    expect(prompt).toMatch(/never touch \{\{BASE_BRANCH\}\} itself/);
    expect(prompt).toMatch(/writes? nothing to the tracker, closes? nothing, and pushe?s? nothing/);
  });
});
