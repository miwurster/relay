import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Sandbox, SandboxRunOptions, SandboxRunResult } from "@ai-hero/sandcastle";
import { beforeEach, describe, expect, it } from "vitest";
import { relayConfigSchema } from "../../../src/config.js";
import { RoleError } from "../../../src/errors.js";
import type { GitHubIssue } from "../../../src/tracker/github.js";
import { createPlanner, PLAN_TAG } from "../../../src/crew/roles/planner.js";
import { readResource } from "../../../src/resources.js";
import { TRACKER_DOC_PATH } from "../../../src/tracker/tracker-doc.js";
import { expectPromptParity } from "./prompt-parity.js";

const config = relayConfigSchema.parse({ landing: "pull-request" });

const workItem: GitHubIssue = {
  number: 7,
  labels: ["ready-for-agent"],
  isOpen: true,
  blockedBy: [],
  subIssues: [],
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
  return { plan: createPlanner({ sandbox, config, recordDir }), runs };
};

const taggedPlan = (json: string) => `Had a look.\n<${PLAN_TAG}>${json}</${PLAN_TAG}>`;

let recordDir: string;

beforeEach(async () => {
  recordDir = await mkdtemp(join(tmpdir(), "relay-planner-"));
});

describe("createPlanner", () => {
  it("returns the tickets the planner ordered", async () => {
    const { plan } = planning(
      taggedPlan(
        '{"kind":"plan","tickets":[{"number":8,"summary":"the schema"},' +
          '{"number":9,"summary":"the endpoint"}]}',
      ),
    );

    await expect(plan(workItem)).resolves.toEqual({
      kind: "plan",
      tickets: [
        { number: 8, summary: "the schema" },
        { number: 9, summary: "the endpoint" },
      ],
    });
  });

  it("passes a bail to a human straight through", async () => {
    const { plan } = planning(
      taggedPlan('{"kind":"under-specified","reason":"#8 says nothing about the change"}'),
    );

    await expect(plan(workItem)).resolves.toEqual({
      kind: "under-specified",
      reason: "#8 says nothing about the change",
    });
  });

  it("refuses a plan with no tickets in it", async () => {
    const { plan } = planning(taggedPlan('{"kind":"plan","tickets":[]}'));

    await expect(plan(workItem)).rejects.toThrow(RoleError);
  });

  it("refuses a run that emitted no plan", async () => {
    const { plan } = planning("I thought about it for a while.");

    await expect(plan(workItem)).rejects.toThrow(RoleError);
  });

  it("runs one-shot on the planner's model, over the work item and the tracker doc", async () => {
    const { plan, runs } = planning(
      taggedPlan('{"kind":"plan","tickets":[{"number":7,"summary":"the item itself"}]}'),
    );

    await plan(workItem);

    expect(runs).toHaveLength(1);
    const [run] = runs;
    expect(run?.maxIterations).toBe(1);
    expect(
      run?.agent.buildPrintCommand({ prompt: "", dangerouslySkipPermissions: true }).command,
    ).toContain(`--model '${config.models.planner}'`);
    expect(run?.promptArgs).toEqual({
      WORK_ITEM: `#${workItem.number}`,
      TRACKER_DOC: TRACKER_DOC_PATH,
    });
    await expectPromptParity(run, "planner.md");
  });
});

/**
 * The planner's behaviour lives in its prompt, so what the prompt instructs is
 * the only thing there is to assert about the plan's shape.
 */
describe("the planner prompt", () => {
  let prompt: string;

  beforeEach(async () => {
    prompt = await readResource("planner.md");
  });

  it("ends the run with the block relay reads the plan out of", () => {
    expect(prompt).toContain(`<${PLAN_TAG}>`);
  });

  it("sends the planner to the tracker doc first, assuming none of it", () => {
    expect(prompt).toMatch(/Read `\{\{TRACKER_DOC\}\}`[\s\S]*before you touch the tracker/);
    expect(prompt).toContain("Assume none of it.");
  });

  it("makes the item's sub-issues the tickets, in dependency order", () => {
    expect(prompt).toMatch(/sub-issues[\s\S]*ordered so that every ticket comes after/);
  });

  it("keeps the graph relay's own, whatever the tracker doc calls a relation", () => {
    expect(prompt).toContain("never what the graph is");
    expect(prompt).toContain("A task list in a body");
    expect(prompt).not.toContain("Relation model");
  });

  it("plans a childless item as its own single ticket", () => {
    expect(prompt).toMatch(/No sub-issues[\s\S]*as a single ticket/);
  });

  it("leaves closed sub-issues out of the plan", () => {
    expect(prompt).toMatch(/Leave out the closed ones/);
  });

  it("makes the one tracker write an idempotent `agent-in-progress` label", () => {
    expect(prompt).toMatch(/Label \{\{WORK_ITEM\}\} `agent-in-progress`/);
    expect(prompt).toMatch(/already[\s\S]*is normal and is not an error/);
    expect(prompt).toContain("This label is the only tracker write you make.");
  });

  it("still bails, naming the ticket and what is missing", () => {
    expect(prompt).toContain("Name the ticket and what is missing.");
  });

  it("has no issue-type mapping and no transitions left in it", () => {
    expect(prompt).not.toMatch(/issue.type/i);
    expect(prompt).not.toMatch(/transition/i);
    expect(prompt).not.toMatch(/In Progress/);
  });
});
