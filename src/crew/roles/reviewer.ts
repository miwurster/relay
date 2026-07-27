import { z } from "zod";
import type { RelayConfig } from "../../config.js";
import type { Crew, Finding, ReviewLens, ReviewScope } from "../contract.js";
import { writeFindingsFile } from "../leg-record.js";
import { type RoleDeps, runRole } from "../run-role.js";
import { TRACKER_DOC_PATH } from "../../tracker/tracker-doc.js";

/** The block every review lens ends its run with. */
export const FINDINGS_TAG = "relay-findings";

const CODE_REVIEW_PROMPT = "code-review.md";
const SPEC_REVIEW_PROMPT = "spec-review.md";

/**
 * What a lens reports: one line per thing it wants changed, and nothing else.
 * The lens and the ticket are the harness's own facts, so a reviewer is never
 * asked to repeat them — relay stamps them on.
 */
const findingsSchema = z.array(z.string().min(1));

/**
 * The four lenses: which prompt each runs, and the arguments only that prompt
 * takes. The code lenses differ in the depth their skill runs at; the spec
 * lenses need the tracker doc, because their intent comes from the tracker.
 */
const LENSES: Record<ReviewLens, { prompt: string; args: Record<string, string> }> = {
  fastCodeReview: { prompt: CODE_REVIEW_PROMPT, args: { DEPTH: "fast" } },
  inDepthCodeReview: { prompt: CODE_REVIEW_PROMPT, args: { DEPTH: "full" } },
  fastSpecReview: { prompt: SPEC_REVIEW_PROMPT, args: { TRACKER_DOC: TRACKER_DOC_PATH } },
  inDepthSpecReview: { prompt: SPEC_REVIEW_PROMPT, args: { TRACKER_DOC: TRACKER_DOC_PATH } },
};

/** What one scope means to a lens, resolved once per review run. */
interface ReviewTarget {
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
 * The real reviewers: one cold read-only agent run per lens, on that lens's
 * model, reporting the findings the fixer will act on.
 *
 * Ordering is the harness's — it runs a scope's lenses and merges what they
 * return — so a lens here knows nothing about the other three.
 */
export function createReviewer(deps: RoleDeps): Crew["review"] {
  return async function review(lens: ReviewLens, scope: ReviewScope): Promise<Finding[]> {
    const lensRun = LENSES[lens];
    const target = describeScope(scope, deps.config);

    const summaries = await runRole({
      ...deps,
      name: `${lens}-${target.name}`,
      model: deps.config.models[lens],
      prompt: lensRun.prompt,
      promptArgs: { SCOPE: scope.kind, ITEM: target.item, BASE: target.base, ...lensRun.args },
      tag: FINDINGS_TAG,
      schema: findingsSchema,
      // A lens that changed the branch broke the one rule every lens runs
      // under, and its change would reach the human as nobody's work.
      branchRule: () => "read-only",
    });

    const findings = summaries.map((summary) => toFinding(lens, target, summary));
    await writeFindingsFile({ dir: deps.recordDir, name: `${target.name}-${lens}`, findings });
    return findings;
  };
}

/**
 * A ticket is measured against its own brief, from the commit the branch was
 * at before it was implemented; the whole branch is measured against the work
 * item, from the branch it was cut off.
 */
function describeScope(scope: ReviewScope, config: RelayConfig): ReviewTarget {
  return scope.kind === "ticket"
    ? {
        name: String(scope.ticket.number),
        item: `#${scope.ticket.number}`,
        base: scope.base,
        ticket: scope.ticket.number,
      }
    : { name: "branch", item: `#${scope.workItem}`, base: config.defaultBranch };
}

function toFinding(lens: ReviewLens, target: ReviewTarget, summary: string): Finding {
  return { source: lens, ticket: target.ticket, summary };
}
