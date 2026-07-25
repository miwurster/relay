import type { Sandbox, SandboxRunOptions, SandboxRunResult } from "@ai-hero/sandcastle";
import { describe, expect, it } from "vitest";
import { relayConfigSchema } from "../src/config.js";
import { createCrew } from "../src/crew.js";
import { IMPLEMENT_TAG } from "../src/implementer.js";
import type { JiraIssue } from "../src/jira.js";
import { PLAN_TAG } from "../src/planner.js";

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

    const plan = await createCrew({ sandbox, config }).plan(issue);

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
    } as unknown as Sandbox;
    const crew = createCrew({ sandbox, config });

    await crew.implement({ key: "PSD-8", summary: "the schema" });
    const result = await crew.implement({ key: "PSD-9", summary: "the endpoint" });

    expect(result).toEqual({ kind: "done" });
    expect(runs.map((run) => run.name)).toEqual(["implementer-PSD-8", "implementer-PSD-9"]);
  });
});
