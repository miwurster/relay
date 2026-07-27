import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Sandbox, SandboxRunOptions, SandboxRunResult } from "@ai-hero/sandcastle";
import { beforeEach, describe, expect, it } from "vitest";
import { relayConfigSchema } from "../src/config.js";
import { createCrew } from "../src/crew.js";
import { FIX_TAG } from "../src/fixer.js";
import { HANDOVER_TAG } from "../src/handover.js";
import { IMPLEMENT_TAG } from "../src/implementer.js";
import type { GitHubIssue } from "../src/github.js";
import { PLAN_TAG } from "../src/planner.js";
import { FINDINGS_TAG } from "../src/reviewer.js";

const config = relayConfigSchema.parse({
  greenGate: "make test",
  defaultBranch: "main",
});

const issue: GitHubIssue = {
  number: 7,
  labels: ["ready-for-agent"],
  isOpen: true,
  blockedBy: [],
  subIssues: [],
};

const branch = "agent/7";

let outputDir: string;

beforeEach(async () => {
  outputDir = await mkdtemp(join(tmpdir(), "relay-crew-"));
});

describe("createCrew", () => {
  it("plans by running the planner role in the pass's sandbox", async () => {
    const runs: SandboxRunOptions[] = [];
    const sandbox = {
      async run(options: SandboxRunOptions): Promise<SandboxRunResult> {
        runs.push(options);
        return {
          iterations: [],
          commits: [],
          stdout: `<${PLAN_TAG}>{"kind":"plan","tickets":[{"number":8,"summary":"it"}]}</${PLAN_TAG}>`,
        };
      },
    } as unknown as Sandbox;

    const crew = createCrew({ sandbox, config, outputDir, workItem: issue.number, branch });
    const plan = await crew.plan(issue);

    expect(plan).toEqual({ kind: "plan", tickets: [{ number: 8, summary: "it" }] });
    expect(runs.map((run) => run.name)).toEqual(["planner"]);
  });

  it("implements each ticket in its own implementer run", async () => {
    const runs: SandboxRunOptions[] = [];
    const sandbox = {
      async run(options: SandboxRunOptions): Promise<SandboxRunResult> {
        runs.push(options);
        return {
          iterations: [],
          commits: [{ sha: "c0ffee" }],
          stdout: `<${IMPLEMENT_TAG}>{"kind":"done"}</${IMPLEMENT_TAG}>`,
        };
      },
      async exec() {
        return { stdout: "9e4d1a0\n", stderr: "", exitCode: 0 };
      },
    } as unknown as Sandbox;
    const crew = createCrew({ sandbox, config, outputDir, workItem: issue.number, branch });

    await crew.implement({ number: 8, summary: "the schema" });
    const result = await crew.implement({ number: 9, summary: "the endpoint" });

    expect(result).toEqual({ kind: "done", base: "9e4d1a0" });
    expect(runs.map((run) => run.name)).toEqual(["implementer-8", "implementer-9"]);
  });

  it("fixes a scope's merged findings in one fixer run", async () => {
    const runs: SandboxRunOptions[] = [];
    const sandbox = {
      async run(options: SandboxRunOptions): Promise<SandboxRunResult> {
        runs.push(options);
        return {
          iterations: [],
          commits: [{ sha: "c0ffee" }],
          stdout: `<${FIX_TAG}>{"kind":"fixed"}</${FIX_TAG}>`,
        };
      },
    } as unknown as Sandbox;
    const crew = createCrew({ sandbox, config, outputDir, workItem: issue.number, branch });

    await crew.fix([{ source: "fastCodeReview", ticket: 8, summary: "src/a.ts:3 dead" }], {
      kind: "ticket",
      ticket: { number: 8, summary: "the schema" },
    });

    expect(runs.map((run) => run.name)).toEqual(["fixer-8"]);
  });

  it("gates by running the repo's own command in the pass's sandbox", async () => {
    const commands: string[] = [];
    const sandbox = {
      async exec(command: string) {
        commands.push(command);
        return { stdout: "", stderr: "", exitCode: 0 };
      },
    } as unknown as Sandbox;

    const result = await createCrew({
      sandbox,
      config,
      outputDir,
      workItem: issue.number,
      branch,
    }).greenGate(1);

    expect(result.green).toBe(true);
    expect(commands).toEqual([config.greenGate]);
  });

  it("reviews each lens of a scope in its own review run", async () => {
    const runs: SandboxRunOptions[] = [];
    const sandbox = {
      async run(options: SandboxRunOptions): Promise<SandboxRunResult> {
        runs.push(options);
        return {
          iterations: [],
          commits: [],
          stdout: `<${FINDINGS_TAG}>["src/a.ts:3 duplicated parsing"]</${FINDINGS_TAG}>`,
        };
      },
      // The lens is read-only, so its run is followed by a clean-worktree check.
      async exec() {
        return { stdout: "", stderr: "", exitCode: 0 };
      },
    } as unknown as Sandbox;
    const crew = createCrew({ sandbox, config, outputDir, workItem: issue.number, branch });

    const findings = await crew.review("fastCodeReview", {
      kind: "ticket",
      ticket: { number: 8, summary: "the schema" },
      base: "abc1234",
    });

    expect(findings).toEqual([
      { source: "fastCodeReview", ticket: 8, summary: "src/a.ts:3 duplicated parsing" },
    ]);
    expect(runs.map((run) => run.name)).toEqual(["fastCodeReview-8"]);
  });

  it("hands the pass over on the item and branch it ran on", async () => {
    const runs: SandboxRunOptions[] = [];
    const sandbox = {
      async run(options: SandboxRunOptions): Promise<SandboxRunResult> {
        runs.push(options);
        return {
          iterations: [],
          commits: [],
          stdout: `<${HANDOVER_TAG}>{"prUrl":"https://github.com/g/r/pull/1","report":"done"}</${HANDOVER_TAG}>`,
        };
      },
    } as unknown as Sandbox;
    const crew = createCrew({ sandbox, config, outputDir, workItem: issue.number, branch });

    await crew.handover({ kind: "success" }, [{ number: 8, summary: "the one ticket" }]);

    expect(runs.map((run) => run.name)).toEqual(["handover"]);
    expect(runs[0]?.promptArgs).toMatchObject({
      WORK_ITEM: `#${issue.number}`,
      BRANCH: branch,
    });
  });
});
