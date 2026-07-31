import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Sandbox, SandboxRunOptions, SandboxRunResult } from "@ai-hero/sandcastle";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { relayConfigSchema } from "../../../src/config.js";
import type { Finding, FixTarget } from "../../../src/crew/contract.js";
import { RoleError } from "../../../src/errors.js";
import { createFixer, FIX_TAG } from "../../../src/crew/roles/fixer.js";
import { readResource } from "../../../src/resources.js";
import { expectPromptParity } from "./prompt-parity.js";

const config = relayConfigSchema.parse({ landing: "pull-request" });

const ticketTarget: FixTarget = { kind: "ticket", ticket: { number: 8, summary: "the schema" } };
const branchTarget: FixTarget = { kind: "branch" };

const oneFinding: Finding = {
  source: "ticketReview",
  axis: "standards",
  ticket: 8,
  summary: "src/a.ts:3 duplicated parsing",
};

const findings: Finding[] = [
  oneFinding,
  { source: "ticketReview", axis: "standards", ticket: 8, summary: "src/a.ts:3 parses twice" },
];

/** One of each label, to say how a label and a place in the list make an id. */
const mixedFindings: Finding[] = [
  { source: "branchReview", axis: "spec", summary: "#7 asks for a configurable cap" },
  { source: "branchReview", axis: "standards", summary: "src/a.ts:3 duplicated parsing" },
  { source: "branchReview", axis: "standards", summary: "src/b.ts:9 dead branch" },
];

const fixedAll = (ids: string[]) =>
  taggedFix(JSON.stringify(ids.map((id) => ({ id, kind: "fixed" }))));

/** A sandbox whose only real behaviour is the stdout one fixer run returns. */
function fakeSandbox(stdout: string, commits: { sha: string }[]) {
  const runs: SandboxRunOptions[] = [];
  const sandbox = {
    async run(options: SandboxRunOptions): Promise<SandboxRunResult> {
      runs.push(options);
      return { iterations: [], stdout, commits };
    },
  } as unknown as Sandbox;
  return { sandbox, runs };
}

const fixing = (stdout: string, commits: { sha: string }[] = [{ sha: "c0ffee" }]) => {
  const { sandbox, runs } = fakeSandbox(stdout, commits);
  return { fix: createFixer({ sandbox, config, recordDir }), runs };
};

const taggedFix = (json: string) => `Fixed them.\n<${FIX_TAG}>${json}</${FIX_TAG}>`;

const commandOf = (run: SandboxRunOptions | undefined) =>
  run?.agent.buildPrintCommand({ prompt: "", dangerouslySkipPermissions: true }).command;

const verdictsFile = (name: string) =>
  readFile(join(recordDir, name), "utf8").then((text) => JSON.parse(text) as unknown);

const promptFindings = (run: SandboxRunOptions | undefined) =>
  JSON.parse(String(run?.promptArgs?.FINDINGS)) as { id: string }[];

let recordDir: string;

beforeEach(async () => {
  recordDir = await mkdtemp(join(tmpdir(), "relay-fixer-"));
});

describe("createFixer", () => {
  it("hands the merged findings to the run that fixes them, each under its own id", async () => {
    const { fix, runs } = fixing(fixedAll(["standards-1", "standards-2"]));

    await fix(findings, ticketTarget);

    expect(runs).toHaveLength(1);
    expect(runs[0]?.promptArgs?.SCOPE).toBe("ticket #8");
    expect(promptFindings(runs[0])).toEqual([
      { id: "standards-1", ...findings[0] },
      { id: "standards-2", ...findings[1] },
    ]);
    await expectPromptParity(runs[0], "fixer.md");
  });

  it("labels each id with its axis, so a binding finding reads as one", async () => {
    const { fix, runs } = fixing(fixedAll(["spec-1", "standards-2", "standards-3"]));

    await fix(mixedFindings, branchTarget);

    expect(promptFindings(runs[0]).map(({ id }) => id)).toEqual([
      "spec-1",
      "standards-2",
      "standards-3",
    ]);
  });

  it("numbers a gate finding under its own label", async () => {
    const { fix, runs } = fixing(fixedAll(["gate-1"]));

    await fix([{ source: "greenGate", summary: "one test red" }], { kind: "gate", attempt: 1 });

    expect(promptFindings(runs[0])).toEqual([
      { id: "gate-1", source: "greenGate", summary: "one test red" },
    ]);
  });

  it("reports which findings it fixed and which it declined, with the reason", async () => {
    const { fix } = fixing(
      taggedFix(
        '[{"id":"spec-1","kind":"fixed"},' +
          '{"id":"standards-2","kind":"skipped","reason":"one caller only"},' +
          '{"id":"standards-3","kind":"fixed"}]',
      ),
    );

    await expect(fix(mixedFindings, branchTarget)).resolves.toEqual({
      fixed: [mixedFindings[0], mixedFindings[2]],
      skipped: [{ finding: mixedFindings[1], reason: "one caller only" }],
    });
  });

  it("writes its verdicts to its own file, so a decline is on the record", async () => {
    const { fix } = fixing(
      taggedFix('[{"id":"standards-1","kind":"skipped","reason":"one caller only"}]'),
      [],
    );

    await fix([oneFinding], ticketTarget);

    await expect(verdictsFile("fixer-8.verdicts.json")).resolves.toEqual([
      {
        id: "standards-1",
        finding: oneFinding,
        verdict: { kind: "skipped", reason: "one caller only" },
      },
    ]);
  });

  it("says what it declined as it declines it, rather than only on the record", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { fix } = fixing(
      taggedFix('[{"id":"standards-1","kind":"skipped","reason":"one caller only"}]'),
      [],
    );

    await fix([oneFinding], ticketTarget);

    expect(log).toHaveBeenCalledWith(expect.stringContaining("one caller only"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("standards"));
    log.mockRestore();
  });

  it("tells the fixer to collapse overlapping findings", async () => {
    expect(await readResource("fixer.md")).toContain("more than once");
  });

  it("names the one skill it works under, and commits without one", async () => {
    const prompt = await readResource("fixer.md");
    expect(prompt).toContain("mattpocock-skills:tdd");
    expect(prompt).toContain("Commit your work to the current branch, as one commit");
  });

  it("tells the fixer that leaving a spec finding unfixed stops the pass", async () => {
    expect(await readResource("fixer.md")).toContain("Leaving one of these unfixed stops the pass");
  });

  it("tells the fixer a quality finding may reach past the diff and is its to decline", async () => {
    const prompt = await readResource("fixer.md");
    expect(prompt).toContain("- `quality` —");
    expect(prompt).toContain("may ask you to change code the branch never touched");
    expect(prompt).toContain("this repo's own documented conventions win over it");
  });

  it("tells the fixer it owes a verdict for every finding, collapsed ones included", async () => {
    const prompt = await readResource("fixer.md");
    expect(prompt).toContain("one verdict per finding");
    expect(prompt).toContain("Collapsing two findings into one fix still means a verdict for each");
  });

  it("accepts a run that declined everything and committed nothing", async () => {
    const { fix } = fixing(
      taggedFix(
        '[{"id":"standards-1","kind":"skipped","reason":"already handled"},' +
          '{"id":"standards-2","kind":"skipped","reason":"already handled"}]',
      ),
      [],
    );

    await expect(fix(findings, branchTarget)).resolves.toEqual({
      fixed: [],
      skipped: [
        { finding: findings[0], reason: "already handled" },
        { finding: findings[1], reason: "already handled" },
      ],
    });
  });

  it("refuses a run that reported a fix but committed nothing", async () => {
    const { fix } = fixing(fixedAll(["standards-1", "standards-2"]), []);

    await expect(fix(findings, ticketTarget)).rejects.toThrow(RoleError);
  });

  it("refuses a run that reported no fix block", async () => {
    const { fix } = fixing("I had a look at the findings.");

    await expect(fix(findings, ticketTarget)).rejects.toThrow(RoleError);
  });

  it("refuses a run that declined without saying why", async () => {
    const { fix } = fixing(taggedFix('[{"id":"standards-1","kind":"skipped"}]'));

    await expect(fix(findings, ticketTarget)).rejects.toThrow(RoleError);
  });

  it("refuses the one verdict per leg a fixer used to report", async () => {
    const { fix } = fixing(taggedFix('{"kind":"fixed"}'));

    await expect(fix(findings, ticketTarget)).rejects.toThrow(RoleError);
  });

  it("refuses a run that left a finding unanswered, so no finding goes undecided", async () => {
    const { fix } = fixing(fixedAll(["standards-1"]));

    await expect(fix(findings, ticketTarget)).rejects.toThrow(/standards-2 unanswered/);
  });

  it("refuses a verdict for a finding it was never handed", async () => {
    const { fix } = fixing(fixedAll(["standards-1", "standards-2", "spec-1"]));

    await expect(fix(findings, ticketTarget)).rejects.toThrow(/spec-1, which it was not handed/);
  });

  it("refuses a finding answered twice, since the second verdict would be unrecorded", async () => {
    const { fix } = fixing(fixedAll(["standards-1", "standards-1"]));

    await expect(fix(findings, ticketTarget)).rejects.toThrow(/standards-1 twice/);
  });

  it("names each run for what it is fixing, so the fixer legs stay apart", async () => {
    const { fix, runs } = fixing(fixedAll(["standards-1", "standards-2"]));

    await fix(findings, ticketTarget);
    await fix(findings, branchTarget);
    await fix(findings, { kind: "quality" });
    await fix(findings, { kind: "gate", attempt: 2 });

    expect(runs.map((run) => run.name)).toEqual([
      "fixer-8",
      "fixer-branch",
      "fixer-quality",
      "fixer-gate-2",
    ]);
    expect(runs[1]?.promptArgs?.SCOPE).toBe("the whole branch");
    expect(runs[2]?.promptArgs?.SCOPE).toBe("the whole branch's structure");
    expect(runs[3]?.promptArgs?.SCOPE).toBe("the green gate, fix attempt 2");
  });

  it("runs a quality fix on the fixer's own model, never the escalated one", async () => {
    const { fix, runs } = fixing(fixedAll(["standards-1", "standards-2"]));

    await fix(findings, { kind: "quality" });

    expect(commandOf(runs[0])).toContain(`--model '${config.models.fixer}'`);
  });

  it("runs on the fixer's model", async () => {
    const { fix, runs } = fixing(fixedAll(["standards-1", "standards-2"]));

    await fix(findings, ticketTarget);

    expect(commandOf(runs[0])).toContain(`--model '${config.models.fixer}'`);
  });

  it("escalates to the stronger model once its first gate fix did not take", async () => {
    const { fix, runs } = fixing(fixedAll(["standards-1", "standards-2"]));

    await fix(findings, { kind: "gate", attempt: 1 });
    await fix(findings, { kind: "gate", attempt: 2 });

    expect(commandOf(runs[0])).toContain(`--model '${config.models.fixer}'`);
    expect(commandOf(runs[1])).toContain(`--model '${config.models.fixerEscalated}'`);
  });
});
