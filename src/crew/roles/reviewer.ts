import { z } from "zod";
import type { Axis, Crew, Finding, ReviewScope } from "../contract.js";
import { reviewKindOf } from "../contract.js";
import { writeFindingsFile } from "../leg-record.js";
import { readResource } from "../../resources.js";
import { type RoleDeps, runRole } from "../run-role.js";
import { TRACKER_DOC_PATH } from "../../tracker/tracker-doc.js";

/** The block every review ends its run with. */
export const FINDINGS_TAG = "relay-findings";

const REVIEW_PROMPT = "review.md";
const QUALITY_PROMPT = "quality-review.md";

/** What the branch review's second run is called, so it never overwrites the first. */
const REREVIEW_NAME = "branch-rereview";

/**
 * The vendored rubric the quality scope judges by, inlined into its prompt.
 *
 * Inlined rather than read from the worktree, because the worktree is the target
 * repo's and this file is relay's — nothing relay ships is visible from inside
 * the sandbox unless a prompt carries it in.
 */
const RUBRIC_RESOURCE = ["skills", "thermo-nuclear-code-quality-review.md"];

/** One axis's answer: a line per thing the review wants changed on it. */
const findingLines = z.array(z.string().min(1));

/**
 * What each scope answers with: a key per axis it was asked for, and no other.
 *
 * A schema per scope rather than one schema with an optional key per axis, so an
 * axis a scope was never asked for cannot arrive as an empty array — which would
 * read as "found nothing" from the one scope that was asked and as "not asked"
 * from the others, the same JSON meaning two things
 * ([ADR-0027](../../docs/adr/0027-the-branch-review-splits-into-a-spec-review-and-a-quality-review.md)).
 *
 * The scope and the ticket are the harness's own facts, so a review is never
 * asked to repeat them — relay stamps them on.
 */
const ANSWERS = {
  ticketReview: z.strictObject({ spec: findingLines, standards: findingLines }),
  branchReview: z.strictObject({ spec: findingLines }),
  qualityReview: z.strictObject({ quality: findingLines }),
} as const;

/**
 * Which axes a scope is asked for, and the answer it owes: the prompt's own two
 * instructions, which are the same fact told to the model twice.
 *
 * A ticket is read on both axes; the whole branch is read on `spec` alone,
 * because the quality scope that follows it asks the wider version of the other
 * question.
 */
const REVIEW_AXES = {
  both: {
    asked: "Both axes: translate the report's `## Standards` section and its `## Spec` section.",
    answer:
      "A JSON object with a `spec` array and a `standards` array, each of one-line findings.\n" +
      "Both keys always, even when one is empty — an absent key is not an empty one.\n\n" +
      "<relay-findings>\n" +
      '{"spec": ["src/worker.ts:31 — the retry cap was asked to be configurable; this hardcodes 3"], "standards": ["src/loader.ts:42 — the third parse branch duplicates readConfig; call that instead"]}\n' +
      "</relay-findings>\n\n" +
      "A clean change:\n\n" +
      "<relay-findings>\n" +
      '{"spec": [], "standards": []}\n' +
      "</relay-findings>",
  },
  specOnly: {
    asked:
      "The `spec` axis only: translate the report's `## Spec` section.\n" +
      "Whatever the `## Standards` section says is not yours to pass on — the quality review that runs after you reads this branch's structure, on a rubric stricter than that section's, and a finding raised in both places would reach the fixer twice.",
    answer:
      "A JSON object with a `spec` array of one-line findings, and no other key — a `standards` key is not part of this scope's answer and relay refuses an answer that carries one.\n\n" +
      "<relay-findings>\n" +
      '{"spec": ["src/worker.ts:31 — the retry cap was asked to be configurable; this hardcodes 3"]}\n' +
      "</relay-findings>\n\n" +
      "A clean change:\n\n" +
      "<relay-findings>\n" +
      '{"spec": []}\n' +
      "</relay-findings>",
  },
} as const;

/** What one scope means to a review run, resolved once per run. */
interface ReviewTarget {
  /** What the scope is called in the run's name and its findings file. */
  name: string;
  /** The prompt resource this scope reads from. */
  prompt: string;
  /** The arguments that prompt is written around. */
  promptArgs: Record<string, string>;
  /** The ticket a finding is about; absent for the whole branch. */
  ticket?: number;
}

/** Every axis a review may answer on, in the order the fixer should read them. */
const AXIS_ORDER: readonly Axis[] = ["spec", "standards", "quality"];

/** What one review answered, keyed by axis — every scope's answer, widened. */
type AxisReport = Partial<Record<Axis, readonly string[]>>;

/**
 * The real reviewer: one cold read-only agent run per scope, on that scope's
 * model, reporting the findings the fixer will act on.
 *
 * One role for all three scopes, because a review is the same leg every time —
 * one read-only run over a diff, ending in a finding per thing it wants changed.
 * The prompt it reads from, the fixed point it reviews since, the axes it is
 * asked for and the shape it answers in are all it varies by, and all four are
 * the scope's own facts.
 */
export function createReviewer({
  baseBranch,
  ...deps
}: RoleDeps & { baseBranch: string }): Crew["review"] {
  return async function review(scope: ReviewScope): Promise<Finding[]> {
    const kind = reviewKindOf(scope);
    const target = await describeScope(scope, baseBranch);

    const report: AxisReport = await runRole({
      ...deps,
      name: `${kind}-${target.name}`,
      model: deps.config.models[kind],
      prompt: target.prompt,
      promptArgs: target.promptArgs,
      tag: FINDINGS_TAG,
      schema: ANSWERS[kind],
      // A review that changed the branch broke the one rule it runs under, and
      // its change would reach the human as nobody's work. The quality scope's
      // rubric invites restructuring, which makes it the likeliest to start
      // doing the work it is describing. It still may not.
      branchRule: () => "read-only",
    });

    // Spec first, because it is the binding axis: it is the one the fixer should
    // read before it spends its judgement, and the one whose ids come out first.
    const findings = AXIS_ORDER.flatMap((axis) =>
      (report[axis] ?? []).map((summary): Finding => ({
        source: kind,
        axis,
        ticket: target.ticket,
        summary,
      })),
    );
    await writeFindingsFile({ dir: deps.recordDir, name: `${target.name}-${kind}`, findings });
    return findings;
  };
}

/**
 * A ticket is measured against its own brief, from the commit the branch was at
 * before it was implemented; both whole-branch scopes are measured against the
 * work item, from the branch it was cut off.
 *
 * The re-review is the branch review again, differing only in its name — which
 * it has to differ in, because the two runs write a findings file each and the
 * second must not overwrite the first's.
 */
async function describeScope(scope: ReviewScope, baseBranch: string): Promise<ReviewTarget> {
  switch (scope.kind) {
    case "ticket":
      return {
        name: String(scope.ticket.number),
        prompt: REVIEW_PROMPT,
        promptArgs: reviewArgs("ticket", `#${scope.ticket.number}`, scope.base, REVIEW_AXES.both),
        ticket: scope.ticket.number,
      };
    case "branch":
      return {
        name: scope.rereview ? REREVIEW_NAME : "branch",
        prompt: REVIEW_PROMPT,
        promptArgs: reviewArgs("branch", `#${scope.workItem}`, baseBranch, REVIEW_AXES.specOnly),
      };
    case "quality":
      return {
        name: "branch",
        prompt: QUALITY_PROMPT,
        promptArgs: {
          ITEM: `#${scope.workItem}`,
          BASE: baseBranch,
          RUBRIC: await readResource(...RUBRIC_RESOURCE),
        },
      };
  }
}

function reviewArgs(
  scope: string,
  item: string,
  base: string,
  axes: (typeof REVIEW_AXES)[keyof typeof REVIEW_AXES],
): Record<string, string> {
  return {
    SCOPE: scope,
    ITEM: item,
    BASE: base,
    TRACKER_DOC: TRACKER_DOC_PATH,
    AXES: axes.asked,
    ANSWER: axes.answer,
  };
}
