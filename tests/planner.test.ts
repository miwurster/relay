import type { Sandbox, SandboxRunOptions, SandboxRunResult } from "@ai-hero/sandcastle";
import { describe, expect, it } from "vitest";
import { relayConfigSchema } from "../src/config.js";
import { RoleError } from "../src/errors.js";
import type { JiraIssue } from "../src/jira.js";
import { createPlanner, PLAN_TAG } from "../src/planner.js";
import { TRACKER_DOC_PATH } from "../src/tracker-doc.js";

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

/** A sandbox whose only real behaviour is the stdout the planner run returns. */
function fakeSandbox(stdout: string) {
  const runs: SandboxRunOptions[] = [];
  const sandbox = {
    async run(options: SandboxRunOptions): Promise<SandboxRunResult> {
      runs.push(options);
      return { iterations: [], stdout, commits: [] };
    },
  } as unknown as Sandbox;
  return { sandbox, runs };
}

const planning = (stdout: string) => {
  const { sandbox, runs } = fakeSandbox(stdout);
  return { plan: createPlanner({ sandbox, config }), runs };
};

const taggedPlan = (json: string) => `Had a look.\n<${PLAN_TAG}>${json}</${PLAN_TAG}>`;

describe("createPlanner", () => {
  it("returns the tickets the planner ordered", async () => {
    const { plan } = planning(
      taggedPlan(
        '{"kind":"plan","tickets":[{"key":"PSD-8","summary":"the schema"},' +
          '{"key":"PSD-9","summary":"the endpoint"}]}',
      ),
    );

    await expect(plan(issue)).resolves.toEqual({
      kind: "plan",
      tickets: [
        { key: "PSD-8", summary: "the schema" },
        { key: "PSD-9", summary: "the endpoint" },
      ],
    });
  });

  it("passes a bail to a human straight through", async () => {
    const { plan } = planning(
      taggedPlan('{"kind":"under-specified","reason":"PSD-8 says nothing about the change"}'),
    );

    await expect(plan(issue)).resolves.toEqual({
      kind: "under-specified",
      reason: "PSD-8 says nothing about the change",
    });
  });

  it("refuses a plan with no tickets in it", async () => {
    const { plan } = planning(taggedPlan('{"kind":"plan","tickets":[]}'));

    await expect(plan(issue)).rejects.toThrow(RoleError);
  });

  it("refuses a run that emitted no plan", async () => {
    const { plan } = planning("I thought about it for a while.");

    await expect(plan(issue)).rejects.toThrow(RoleError);
  });

  it("runs one-shot on the planner's model, over the work item and the tracker doc", async () => {
    const { plan, runs } = planning(
      taggedPlan('{"kind":"plan","tickets":[{"key":"PSD-7","summary":"the item itself"}]}'),
    );

    await plan(issue);

    expect(runs).toHaveLength(1);
    const [run] = runs;
    expect(run?.maxIterations).toBe(1);
    expect(run?.agent.buildPrintCommand({ prompt: "", dangerouslySkipPermissions: true }).command)
      .toContain(`--model '${config.models.planner}'`);
    expect(run?.promptArgs).toEqual({ WORK_ITEM_KEY: issue.key, TRACKER_DOC: TRACKER_DOC_PATH });
    expect(run?.prompt).toContain("{{WORK_ITEM_KEY}}");
    expect(run?.prompt).toContain("{{TRACKER_DOC}}");
    expect(run?.prompt).toContain(`<${PLAN_TAG}>`);
  });
});
