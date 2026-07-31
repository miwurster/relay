import { z } from "zod";
import type { Crew, PlanResult } from "../contract.js";
import type { GitHubIssue } from "../../tracker/github.js";
import { type RoleDeps, runRole } from "../run-role.js";
import { TRACKER_DOC_PATH } from "../../tracker/tracker-doc.js";

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
    tickets: z
      .array(z.object({ number: z.number().int().positive(), summary: z.string().min(1) }))
      .min(1),
  }),
  z.object({ kind: z.literal("under-specified"), reason: z.string().min(1) }),
]);

/**
 * The real planner: one cold agent run that labels the item `agent-in-progress`
 * and resolves it into the ordered tickets the rest of the pass implements —
 * its open sub-issues, or the item itself when it has none.
 *
 * Tracker access — the tool, and how each operation is run — comes from
 * `docs/agents/issue-tracker.md`, which the prompt sends the planner to read
 * first, so relay hardcodes nothing about how this repo reaches its tracker.
 * The graph itself is relay's: sub-issues and issue dependencies as GitHub
 * records them, never a convention a doc describes
 * ([ADR-0028](../../../docs/adr/0028-the-tracker-doc-owns-invocation-relay-owns-the-graph.md)).
 */
export function createPlanner(deps: RoleDeps): Crew["plan"] {
  return async function plan(workItem: GitHubIssue): Promise<PlanResult> {
    return await runRole({
      ...deps,
      name: "planner",
      model: deps.config.models.planner,
      prompt: PLANNER_PROMPT,
      promptArgs: { WORK_ITEM: `#${workItem.number}`, TRACKER_DOC: TRACKER_DOC_PATH },
      tag: PLAN_TAG,
      schema: planSchema,
    });
  };
}
