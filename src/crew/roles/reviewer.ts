import { z } from "zod";
import type { Axis, Crew, Finding, ReviewKind, ReviewScope } from "../contract.js";
import { writeFindingsFile } from "../leg-record.js";
import { type RoleDeps, runRole } from "../run-role.js";
import { TRACKER_DOC_PATH } from "../../tracker/tracker-doc.js";

/** The block every review ends its run with. */
export const FINDINGS_TAG = "relay-findings";

const REVIEW_PROMPT = "review.md";

/** What the branch review's second run is called, so it never overwrites the first. */
const REREVIEW_NAME = "branch-rereview";

/**
 * What a review reports: one line per thing it wants changed, under the axis it
 * came from, and nothing else.
 *
 * Both keys always, so a review that found nothing on one axis says so rather
 * than leaving relay to read a missing key as either answer. The scope and the
 * ticket are the harness's own facts, so a reviewer is never asked to repeat
 * them — relay stamps them on.
 */
const findingsSchema = z.object({
  standards: z.array(z.string().min(1)),
  spec: z.array(z.string().min(1)),
});

/** What one scope means to a review run, resolved once per run. */
interface ReviewTarget {
  /** Which review this is, in the model map and on every finding it reports. */
  kind: ReviewKind;
  /** What the scope is called in the run's name and its findings file. */
  name: string;
  /** The issue whose intent the change is measured against, as the prompt names it. */
  item: string;
  /** What the reviewed diff starts at. */
  base: string;
  /** The ticket a finding is about; absent for the whole branch. */
  ticket?: number;
}

/**
 * The real reviewer: one cold read-only agent run per scope, on that scope's
 * model, reporting the findings the fixer will act on.
 *
 * One prompt for both scopes, because the review itself is the same two-axis
 * skill either way — only the fixed point it reviews since, and the issue it
 * measures against, differ.
 */
export function createReviewer({
  baseBranch,
  ...deps
}: RoleDeps & { baseBranch: string }): Crew["review"] {
  return async function review(scope: ReviewScope): Promise<Finding[]> {
    const target = describeScope(scope, baseBranch);

    const report = await runRole({
      ...deps,
      name: `${target.kind}-${target.name}`,
      model: deps.config.models[target.kind],
      prompt: REVIEW_PROMPT,
      promptArgs: {
        SCOPE: scope.kind,
        ITEM: target.item,
        BASE: target.base,
        TRACKER_DOC: TRACKER_DOC_PATH,
      },
      tag: FINDINGS_TAG,
      schema: findingsSchema,
      // A review that changed the branch broke the one rule it runs under, and
      // its change would reach the human as nobody's work.
      branchRule: () => "read-only",
    });

    // Spec first, because it is the binding axis: it is the one the fixer should
    // read before it spends its judgement, and the one whose ids come out first.
    const findings = [
      ...report.spec.map((summary) => toFinding(target, "spec", summary)),
      ...report.standards.map((summary) => toFinding(target, "standards", summary)),
    ];
    await writeFindingsFile({
      dir: deps.recordDir,
      name: `${target.name}-${target.kind}`,
      findings,
    });
    return findings;
  };
}

/**
 * A ticket is measured against its own brief, from the commit the branch was
 * at before it was implemented; the whole branch is measured against the work
 * item, from the branch it was cut off.
 *
 * The re-review is the branch review again, differing only in its name — which
 * it has to differ in, because the two runs write a findings file each and the
 * second must not overwrite the first's.
 */
function describeScope(scope: ReviewScope, baseBranch: string): ReviewTarget {
  return scope.kind === "ticket"
    ? {
        kind: "ticketReview",
        name: String(scope.ticket.number),
        item: `#${scope.ticket.number}`,
        base: scope.base,
        ticket: scope.ticket.number,
      }
    : {
        kind: "branchReview",
        name: scope.rereview ? REREVIEW_NAME : "branch",
        item: `#${scope.workItem}`,
        base: baseBranch,
      };
}

function toFinding(target: ReviewTarget, axis: Axis, summary: string): Finding {
  return { source: target.kind, axis, ticket: target.ticket, summary };
}
