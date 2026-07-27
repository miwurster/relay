import type { Sandbox } from "@ai-hero/sandcastle";
import { z } from "zod";
import type { RelayConfig } from "./config.js";
import type { Crew, Outcome, TicketRef } from "./crew.js";
import { RoleError } from "./errors.js";
import { runRole } from "./run-role.js";
import { TRACKER_DOC_PATH } from "./tracker-doc.js";

/** The block the handover ends its run with, and the prompt it runs from. */
export const HANDOVER_TAG = "relay-handover";
const HANDOVER_PROMPT = "handover.md";

/**
 * What the handover leg reports back: the pull request it opened, if the
 * outcome is one that gets one, and the report the operator reads.
 */
const handoverSchema = z.object({
  prUrl: z.url().optional(),
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
  outputDir,
  workItem,
  branch,
}: {
  sandbox: Sandbox;
  config: RelayConfig;
  outputDir: string;
  workItem: number;
  branch: string;
}): Crew["handover"] {
  return async function handover(outcome: Outcome, committed: readonly TicketRef[]): Promise<void> {
    const leg = describeLeg(outcome, committed);

    const { prUrl, report } = await runRole({
      sandbox,
      config,
      name: "handover",
      outputDir,
      model: config.models.handover,
      prompt: HANDOVER_PROMPT,
      promptArgs: {
        OUTCOME: outcome.kind,
        REASON: leg.cause,
        // Told, never inferred: relay holds the leg to this below, so the leg
        // has to be reading the same verdict relay is about to judge it on.
        PULL_REQUEST: leg.pullRequest,
        // Told too: the leg cannot read the ticket numbers back out of the
        // commits, which carry no issue reference of their own.
        COMMITTED_TICKETS: leg.committed,
        WORK_ITEM: `#${workItem}`,
        BRANCH: branch,
        DEFAULT_BRANCH: config.defaultBranch,
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
    enforcePullRequestRule(leg, outcome.kind, prUrl);
  };
}

/** What one outcome means to the leg that hands it over, resolved once. */
interface HandoverLeg {
  /** Why the pass ended where it did, in the words the tracker comment carries. */
  cause: string;
  /**
   * Whether the outcome gets a pull request. A branch carrying committed
   * tickets owes the human one; an empty branch — an early bail, or a block on
   * the first ticket — has nothing to publish and opening one is an error.
   *
   * The leg is told this rather than working it out from the branch, so the
   * instruction it followed and the rule it is judged by are the same fact.
   */
  pullRequest: "required" | "forbidden";
  /** The tickets the pull request closes, as the prompt names them. */
  committed: string;
}

function describeLeg(outcome: Outcome, committed: readonly TicketRef[]): HandoverLeg {
  return {
    cause: outcome.kind === "success" ? outcome.detail : outcome.reason,
    pullRequest: committed.length > 0 ? "required" : "forbidden",
    committed: committed.map((ticket) => `#${ticket.number}`).join(", ") || "nothing",
  };
}

function enforcePullRequestRule(
  leg: HandoverLeg,
  kind: Outcome["kind"],
  prUrl: string | undefined,
): void {
  if (leg.pullRequest === "required" && !prUrl) {
    throw new RoleError(
      `handover reported a ${kind} pass with committed work but no pull request.`,
    );
  }
  if (leg.pullRequest === "forbidden" && prUrl) {
    throw new RoleError(
      `handover opened ${prUrl} for a ${kind} pass on an empty branch, which gets no pull request.`,
    );
  }
}
