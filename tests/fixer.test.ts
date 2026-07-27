import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Sandbox, SandboxRunOptions, SandboxRunResult } from "@ai-hero/sandcastle";
import { beforeEach, describe, expect, it } from "vitest";
import { relayConfigSchema } from "../src/config.js";
import type { Finding, FixTarget } from "../src/crew.js";
import { RoleError } from "../src/errors.js";
import { createFixer, FIX_TAG } from "../src/fixer.js";

const config = relayConfigSchema.parse({
  greenGate: "make test",
  defaultBranch: "main",
});

const ticketTarget: FixTarget = { kind: "ticket", ticket: { key: "PSD-8", summary: "the schema" } };
const branchTarget: FixTarget = { kind: "branch" };

const findings: Finding[] = [
  { source: "fastCodeReview", ticket: "PSD-8", summary: "src/a.ts:3 duplicated parsing" },
  { source: "fastSpecReview", ticket: "PSD-8", summary: "src/a.ts:3 parses twice" },
];

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
  return { fix: createFixer({ sandbox, config, outputDir }), runs };
};

const taggedFix = (json: string) => `Fixed them.\n<${FIX_TAG}>${json}</${FIX_TAG}>`;

const commandOf = (run: SandboxRunOptions | undefined) =>
  run?.agent.buildPrintCommand({ prompt: "", dangerouslySkipPermissions: true }).command;

let outputDir: string;

beforeEach(async () => {
  outputDir = await mkdtemp(join(tmpdir(), "relay-fixer-"));
});

describe("createFixer", () => {
  it("hands the merged findings to the run that fixes them", async () => {
    const { fix, runs } = fixing(taggedFix('{"kind":"fixed"}'));

    await fix(findings, ticketTarget);

    expect(runs).toHaveLength(1);
    expect(runs[0]?.promptArgs).toEqual({
      SCOPE: "ticket PSD-8",
      FINDINGS: JSON.stringify(findings, undefined, 2),
    });
  });

  it("tells the fixer to collapse the lenses' overlapping findings", async () => {
    const { fix, runs } = fixing(taggedFix('{"kind":"fixed"}'));

    await fix(findings, ticketTarget);

    expect(runs[0]?.prompt).toContain("more than once");
  });

  it("accepts a run that judged there was nothing to fix and committed nothing", async () => {
    const { fix } = fixing(taggedFix('{"kind":"nothing-to-fix","reason":"already handled"}'), []);

    await expect(fix(findings, branchTarget)).resolves.toBeUndefined();
  });

  it("refuses a run that reported fixes but committed nothing", async () => {
    const { fix } = fixing(taggedFix('{"kind":"fixed"}'), []);

    await expect(fix(findings, ticketTarget)).rejects.toThrow(RoleError);
  });

  it("refuses a run that reported no fix block", async () => {
    const { fix } = fixing("I had a look at the findings.");

    await expect(fix(findings, ticketTarget)).rejects.toThrow(RoleError);
  });

  it("refuses a run that declined without saying why", async () => {
    const { fix } = fixing(taggedFix('{"kind":"nothing-to-fix"}'));

    await expect(fix(findings, ticketTarget)).rejects.toThrow(RoleError);
  });

  it("names each run for what it is fixing, so the three fixer legs stay apart", async () => {
    const { fix, runs } = fixing(taggedFix('{"kind":"fixed"}'));

    await fix(findings, ticketTarget);
    await fix(findings, branchTarget);
    await fix(findings, { kind: "gate", attempt: 2 });

    expect(runs.map((run) => run.name)).toEqual(["fixer-PSD-8", "fixer-branch", "fixer-gate-2"]);
    expect(runs[1]?.promptArgs?.SCOPE).toBe("the whole branch");
    expect(runs[2]?.promptArgs?.SCOPE).toBe("the green gate, fix attempt 2");
  });

  it("runs on the fixer's model", async () => {
    const { fix, runs } = fixing(taggedFix('{"kind":"fixed"}'));

    await fix(findings, ticketTarget);

    expect(commandOf(runs[0])).toContain(`--model '${config.models.fixer}'`);
  });

  it("escalates to the stronger model once its first gate fix did not take", async () => {
    const { fix, runs } = fixing(taggedFix('{"kind":"fixed"}'));

    await fix(findings, { kind: "gate", attempt: 1 });
    await fix(findings, { kind: "gate", attempt: 2 });

    expect(commandOf(runs[0])).toContain(`--model '${config.models.fixer}'`);
    expect(commandOf(runs[1])).toContain(`--model '${config.models.fixerEscalated}'`);
  });
});
