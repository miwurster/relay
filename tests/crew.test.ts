import type { Sandbox, SandboxRunOptions, SandboxRunResult } from "@ai-hero/sandcastle";
import { describe, expect, it } from "vitest";
import { relayConfigSchema } from "../src/config.js";
import { createCrew } from "../src/crew.js";
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
});
