import type { Sandbox } from "@ai-hero/sandcastle";
import { z } from "zod";
import type { RelayConfig } from "./config.js";
import type { Crew, PlanResult } from "./crew.js";
import type { JiraIssue } from "./jira.js";
import { readResource } from "./resources.js";
import { roleAgent } from "./role-agent.js";
import { readTaggedOutput } from "./tagged-output.js";
import { TRACKER_DOC_PATH } from "./tracker-doc.js";

/** The block the planner ends its run with, and the prompt it runs from. */
export const PLAN_TAG = "relay-plan";
const PLANNER_PROMPT = "planner.md";

/**
 * The plan the planner may return. It is ephemeral — the ordered tickets live
 * in this run only, and nothing about them is written back to the tracker.
 */
const planSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("plan"),
    // A plan with no tickets is not a plan: an item with no related tickets is
    // its own singleton, which the planner is told to return instead.
    tickets: z.array(z.object({ key: z.string().min(1), summary: z.string().min(1) })).min(1),
  }),
  z.object({ kind: z.literal("under-specified"), reason: z.string().min(1) }),
]);

/**
 * The real planner: one cold agent run that ensures the item is In Progress and
 * resolves it into the ordered tickets the rest of the pass implements.
 *
 * Everything tracker-shaped — access, repo label, relation model, issue types —
 * comes from the repo's own `docs/agents/issue-tracker.md`, which the prompt
 * sends the planner to read first, so relay hardcodes no tracker assumptions.
 */
export function createPlanner({
  sandbox,
  config,
}: {
  sandbox: Sandbox;
  config: RelayConfig;
}): Crew["plan"] {
  return async function plan(issue: JiraIssue): Promise<PlanResult> {
    const { stdout } = await sandbox.run({
      name: "planner",
      agent: roleAgent(config.models.planner),
      maxIterations: 1,
      prompt: await readResource(PLANNER_PROMPT),
      promptArgs: { WORK_ITEM_KEY: issue.key, TRACKER_DOC: TRACKER_DOC_PATH },
      signal: AbortSignal.timeout(config.roleTimeoutMs),
    });

    return readTaggedOutput({ stdout, tag: PLAN_TAG, schema: planSchema, role: "planner" });
  };
}
