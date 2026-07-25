import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Sandbox, SandboxRunOptions, SandboxRunResult } from "@ai-hero/sandcastle";
import { beforeEach, describe, expect, it } from "vitest";
import { relayConfigSchema } from "../src/config.js";
import { createCrew } from "../src/crew.js";
import { IMPLEMENT_TAG } from "../src/implementer.js";
import type { JiraIssue } from "../src/jira.js";
import { PLAN_TAG } from "../src/planner.js";
import { FINDINGS_TAG } from "../src/reviewer.js";

const config = relayConfigSchema.parse({
  greenGate: "make test",
  defaultBranch: "main",
  jira: { baseUrl: "https://example.atlassian.net" },
});

const issue: JiraIssue = {
  key: "PSD-7",
  issueType: "Story",
  labels: ["ready-for-agent"],
  isDone: false,
  blockedBy: [],
};

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
          stdout: `<${PLAN_TAG}>{"kind":"plan","tickets":[{"key":"PSD-8","summary":"it"}]}</${PLAN_TAG}>`,
        };
      },
    } as unknown as Sandbox;

    const plan = await createCrew({ sandbox, config, outputDir }).plan(issue);

    expect(plan).toEqual({ kind: "plan", tickets: [{ key: "PSD-8", summary: "it" }] });
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
    const crew = createCrew({ sandbox, config, outputDir });

    await crew.implement({ key: "PSD-8", summary: "the schema" });
    const result = await crew.implement({ key: "PSD-9", summary: "the endpoint" });

    expect(result).toEqual({ kind: "done", base: "9e4d1a0" });
    expect(runs.map((run) => run.name)).toEqual(["implementer-PSD-8", "implementer-PSD-9"]);
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
    } as unknown as Sandbox;
    const crew = createCrew({ sandbox, config, outputDir });

    const findings = await crew.review("fastCodeReview", {
      kind: "ticket",
      ticket: { key: "PSD-8", summary: "the schema" },
    });

    expect(findings).toEqual([
      { source: "fastCodeReview", ticket: "PSD-8", summary: "src/a.ts:3 duplicated parsing" },
    ]);
    expect(runs.map((run) => run.name)).toEqual(["fastCodeReview-PSD-8"]);
  });
});
