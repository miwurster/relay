import { z } from "zod";
import { type Landing, RELAY_DIR } from "../../config.js";
import {
  type Crew,
  findingLabel,
  type GateVerdict,
  type LandResult,
  type Outcome,
  type TicketRef,
  type UnaddressedFinding,
} from "../contract.js";
import { RoleError } from "../../errors.js";
import { type RoleDeps, runRole } from "../run-role.js";
import { TRACKER_DOC_PATH } from "../../tracker/tracker-doc.js";

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
  workItem,
  branch,
  baseBranch,
  ...deps
}: RoleDeps & { workItem: number; branch: string; baseBranch: string }): Crew["handover"] {
  return async function handover(
    outcome: Outcome,
    committed: readonly TicketRef[],
    finished: readonly TicketRef[],
    blocked: readonly TicketRef[],
    land: LandResult,
    gate: GateVerdict,
    unaddressed: readonly UnaddressedFinding[],
  ): Promise<void> {
    const leg = describeLeg(outcome, committed, finished, blocked, deps.config.landing, land);

    const { prUrl, report } = await runRole({
      ...deps,
      name: "handover",
      model: deps.config.models.handover,
      prompt: HANDOVER_PROMPT,
      promptArgs: {
        OUTCOME: outcome.kind,
        REASON: leg.cause,
        // Told, never inferred: relay holds the leg to this below, so the leg
        // has to be reading the same verdict relay is about to judge it on.
        PULL_REQUEST: leg.pullRequest,
        // What this repo's landing owes the operator, and whether the pass paid
        // it — the leg publishes against these rather than reading the branches.
        LANDING: deps.config.landing,
        LANDED: leg.landed,
        LANDED_DETAIL: leg.landedDetail,
        // The one sentence the report and the tracker comment both say about the
        // gate. Told rather than read off the repo's docs or the worktree: a leg
        // that has to work out what verified this branch can only run the gate
        // itself or guess, and a pass that blocked before the gate has no verdict
        // to find either way.
        GATE: describeGate(gate),
        // Told too: the leg cannot read the ticket numbers back out of the
        // commits, which carry no issue reference of their own.
        COMMITTED_TICKETS: leg.committed,
        // Derived by relay from what the reviews left unaddressed, which the leg
        // cannot see either — and the only list it may record as done.
        FINISHED_TICKETS: leg.finished,
        // Derived by relay too, and not the committed tickets minus the finished
        // ones: a ticket an implementer asked for a human over never reached the
        // committed list, and a finding about the branch names no ticket at all.
        BLOCKED_TICKETS: leg.blocked,
        // What a review wanted and nobody did. Told, because the leg cannot see
        // it: the records live on the host, outside this worktree.
        UNADDRESSED: describeUnaddressed(unaddressed),
        RECORD_PATH: `${RELAY_DIR}/${workItem}`,
        WORK_ITEM: `#${workItem}`,
        BRANCH: branch,
        BASE_BRANCH: baseBranch,
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
   * Whether the outcome gets a pull request. Under `pull-request` landing a
   * branch carrying committed tickets owes the human one, and an empty branch —
   * an early bail, or a block on the first ticket — has nothing to publish. A
   * `merge` repo opens none on any path, and the rule stays enforced there as a
   * guard against a leg inventing one.
   *
   * The leg is told this rather than working it out from the branch, so the
   * instruction it followed and the rule it is judged by are the same fact.
   */
  pullRequest: "required" | "forbidden";
  /** Why the outcome gets no pull request, for the error a leg that opened one gets. */
  noPullRequestBecause: string;
  /** Whether the base branch was landed on: `merge` landing's own question. */
  landed: "yes" | "no";
  /** What the lander did to get there, or that nothing landed. */
  landedDetail: string;
  /** The tickets the pull request closes, as the prompt names them. */
  committed: string;
  /** The tickets the leg may record as done, as the prompt names them. */
  finished: string;
  /** The tickets a block left unfinished, as the prompt names them. */
  blocked: string;
}

function describeLeg(
  outcome: Outcome,
  committed: readonly TicketRef[],
  finished: readonly TicketRef[],
  blocked: readonly TicketRef[],
  landing: Landing,
  land: LandResult,
): HandoverLeg {
  return {
    cause: outcome.kind === "success" ? outcome.detail : outcome.reason,
    pullRequest: landing === "pull-request" && committed.length > 0 ? "required" : "forbidden",
    noPullRequestBecause:
      landing === "merge"
        ? "this repo's landing is `merge`, which opens none on any path"
        : "the branch carries nothing worth publishing",
    // The lander's own verdict, never the landing and the outcome read together:
    // a lander that had nothing to land landed nothing, and one that reported
    // `not-landed` left the base branch where it was.
    landed: land.kind === "landed" ? "yes" : "no",
    landedDetail: land.kind === "landed" ? land.detail : "nothing was landed",
    committed: listTickets(committed),
    finished: listTickets(finished),
    blocked: listTickets(blocked),
  };
}

/** How a list of tickets reads in the prompt, empty included. */
function listTickets(tickets: readonly TicketRef[]): string {
  return tickets.map((ticket) => `#${ticket.number}`).join(", ") || "nothing";
}

/**
 * The findings nobody acted on, one per line, under the label that says whether
 * one of them is why the pass blocked.
 *
 * `none` rather than an empty block: a leg handed nothing has to be able to tell
 * "no findings were left" from "relay forgot to tell me".
 */
function describeUnaddressed(unaddressed: readonly UnaddressedFinding[]): string {
  if (unaddressed.length === 0) return "none";

  return unaddressed
    .map(({ finding, reason }) => `[${findingLabel(finding)}] ${finding.summary} — left: ${reason}`)
    .join("\n");
}

/**
 * The gate's one line, as the report and the tracker comment carry it.
 *
 * A pass that never reached the gate still names the command, because the gate
 * resolver ran first and "what this pass would have verified with" is what tells
 * an operator the branch is unverified rather than unverifiable.
 *
 * The provenance rides along wherever the verdict does not already carry it: an
 * inferred gate is a command no human chose ([CONTEXT.md](../../../CONTEXT.md),
 * _provenance_), and a green run's own detail names it while a red run's names
 * the failure instead.
 */
function describeGate(verdict: GateVerdict): string {
  const provenance =
    verdict.gate.provenance === "declared"
      ? `declared in ${verdict.gate.source}`
      : `inferred from ${verdict.gate.source}`;

  if (verdict.kind === "not-gated") {
    return `\`${verdict.gate.command}\` never ran — the pass blocked before the green gate (${provenance}).`;
  }
  return verdict.green ? verdict.detail : `${verdict.detail} (${provenance})`;
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
      `handover opened ${prUrl} for a ${kind} pass that gets no pull request: ` +
        `${leg.noPullRequestBecause}.`,
    );
  }
}
