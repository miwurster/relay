import type { Sandbox } from "@ai-hero/sandcastle";
import { z } from "zod";
import type { RelayConfig } from "./config.js";
import type { Crew, Outcome } from "./crew.js";
import { RoleError } from "./errors.js";
import { runRole } from "./run-role.js";
import { TRACKER_DOC_PATH } from "./tracker-doc.js";

/** The block the handover ends its run with, and the prompt it runs from. */
export const HANDOVER_TAG = "relay-handover";
const HANDOVER_PROMPT = "handover.md";

/**
 * What the handover leg reports back: the merge request it opened, if the
 * outcome is one that gets one, and the report the operator reads.
 */
const handoverSchema = z.object({
  mrUrl: z.url().optional(),
  report: z.string().min(1),
});

/**
 * The pass's last leg: publish what the pass produced and tell both the tracker
 * and the human what state the work is in.
 *
 * One role serves all three outcomes, because all three are the same job with
 * a different verdict — the prompt says what each one publishes, and relay
 * holds the leg to having done it.
 */
export function createHandover({
  sandbox,
  config,
  workItem,
  branch,
}: {
  sandbox: Sandbox;
  config: RelayConfig;
  workItem: string;
  branch: string;
}): Crew["handover"] {
  return async function handover(outcome: Outcome): Promise<void> {
    const leg = describeLeg(outcome);

    const { mrUrl, report } = await runRole({
      sandbox,
      config,
      name: "handover",
      model: config.models.handover,
      prompt: HANDOVER_PROMPT,
      promptArgs: {
        OUTCOME: outcome.kind,
        REASON: leg.cause,
        WORK_ITEM_KEY: workItem,
        BRANCH: branch,
        TRACKER_DOC: TRACKER_DOC_PATH,
      },
      tag: HANDOVER_TAG,
      schema: handoverSchema,
      // The handover publishes what the earlier legs committed; a commit of its
      // own would reach the human as work no role reviewed. Dirt is not checked,
      // because the green gate's build artefacts are already in the worktree.
      branchRule: () => "no-commits",
    });

    // Printed before the leg is judged: by now it has already pushed, labelled
    // and commented, and the report is how the human finds out what it did.
    console.log(`relay: [handover] ${outcome.kind} on ${branch}\n${report}`);
    enforceMergeRequestRule(leg, mrUrl);
  };
}

/** What one outcome means to the leg that hands it over, resolved once. */
interface HandoverLeg {
  /** Why the pass ended where it did, in the words the tracker comment carries. */
  cause: string;
  /**
   * Whether the outcome gets a merge request. A success always has commits to
   * publish; an early bail never does. A mid-block is neither: work that
   * blocked on its first ticket has an empty branch, and pushing that would
   * open the same empty merge request an early bail is spared.
   */
  mergeRequest: "required" | "forbidden" | "if-there-is-work";
}

function describeLeg(outcome: Outcome): HandoverLeg {
  switch (outcome.kind) {
    case "success":
      return { cause: "The green gate is green.", mergeRequest: "required" };
    case "mid-block":
      return { cause: outcome.reason, mergeRequest: "if-there-is-work" };
    case "early-bail":
      return { cause: outcome.reason, mergeRequest: "forbidden" };
  }
}

function enforceMergeRequestRule(leg: HandoverLeg, mrUrl: string | undefined): void {
  if (leg.mergeRequest === "required" && !mrUrl) {
    throw new RoleError("handover reported a green pass but no merge request.");
  }
  if (leg.mergeRequest === "forbidden" && mrUrl) {
    throw new RoleError(`handover opened ${mrUrl} for an early bail, which gets no merge request.`);
  }
}
