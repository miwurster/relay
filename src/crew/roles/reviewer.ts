import { z } from "zod";
import type { Axis, Crew, Finding, ReviewKind, ReviewScope } from "../contract.js";
import { findingLabel, reviewKindOf } from "../contract.js";
import { writeFindingsFile } from "../leg-record.js";
import { readResource } from "../../resources.js";
import { type RoleDeps, runRole } from "../run-role.js";
import { TRACKER_DOC_PATH } from "../../tracker/tracker-doc.js";

/** The block every review ends its run with. */
export const FINDINGS_TAG = "relay-findings";

const REVIEW_PROMPT = "review.md";
const REREVIEW_PROMPT = "rereview.md";
const QUALITY_PROMPT = "quality-review.md";

/** What the branch review's second run adds to its name, so it never overwrites the first. */
const REREVIEW_SUFFIX = "rereview";

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
 * What one axis set asks the review for, and what it owes back: the prompt's two
 * instructions and the schema that holds the answer, in one entry.
 *
 * Together rather than in a table each, because they are the same fact told
 * three times — an axis the prompt does not ask for must not be a key the schema
 * accepts, and a branch review reads whichever set the harness handed it
 * ([ADR-0031](../../docs/adr/0031-the-branch-review-takes-the-standards-axis-when-no-ticket-review-ran.md)).
 *
 * A schema per axis set rather than one schema with an optional key per axis, so
 * an axis a scope was never asked for cannot arrive as an empty array — which
 * would read as "found nothing" from the one scope that was asked and as "not
 * asked" from the others, the same JSON meaning two things
 * ([ADR-0027](../../docs/adr/0027-the-branch-review-splits-into-a-spec-review-and-a-quality-review.md)).
 *
 * The scope and the ticket are the harness's own facts, so a review is never
 * asked to repeat them — relay stamps them on.
 */
const AXIS_SETS = {
  both: {
    schema: z.strictObject({ spec: findingLines, standards: findingLines }),
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
  spec: {
    schema: z.strictObject({ spec: findingLines }),
    asked:
      "The `spec` axis only: translate the report's `## Spec` section.\n" +
      "Whatever the `## Standards` section says is not yours to pass on — every ticket of this plan was already read on that axis by its own review, and a finding raised in both places would reach the fixer twice.",
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

/** The quality scope's own answer, which no axis set of `review.md` describes. */
const QUALITY_ANSWER = z.strictObject({ quality: findingLines });

/** What one scope means to a review run, resolved once per run. */
interface ReviewTarget {
  /**
   * Whether this is the re-review, which shares its kind with the first branch
   * run and so needs a name of its own to keep their findings files apart.
   */
  rereview?: boolean;
  /** The prompt resource this scope reads from. */
  prompt: string;
  /** The arguments that prompt is written around. */
  promptArgs: Record<string, string>;
  /** The shape the answer must hold: the axes this scope was asked for, and no other. */
  schema: z.ZodType<AxisReport>;
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
    const name = runName(kind, target);

    const report: AxisReport = await runRole({
      ...deps,
      name,
      model: deps.config.models[kind],
      prompt: target.prompt,
      promptArgs: target.promptArgs,
      tag: FINDINGS_TAG,
      schema: target.schema,
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
    await writeFindingsFile({
      dir: deps.recordDir,
      name: findingsFile(kind, target, name),
      findings,
    });
    return findings;
  };
}

/**
 * What one review run is called: its kind, plus what the kind does not already
 * say. A ticket's run is named after its ticket and the re-review after itself;
 * the first branch run and the quality run need nothing but their kind.
 */
function runName(kind: ReviewKind, target: ReviewTarget): string {
  const suffix = target.ticket ?? (target.rereview ? REREVIEW_SUFFIX : undefined);
  return suffix === undefined ? kind : `${kind}-${suffix}`;
}

/**
 * A ticket's findings file leads with its number, so a pass's record directory
 * reads ticket by ticket; every other scope's file is named after its run.
 */
function findingsFile(kind: ReviewKind, target: ReviewTarget, name: string): string {
  return target.ticket === undefined ? name : `${target.ticket}-${kind}`;
}

/**
 * A ticket is measured against its own brief, from the commit the branch was at
 * before it was implemented; both whole-branch scopes are measured against the
 * work item, from the branch it was cut off.
 *
 * A ticket is always read on both axes; the branch reads whichever set the
 * harness asked for, which is the axis set's own name.
 *
 * The re-review is its own prompt rather than the branch review again: it is
 * handed the findings the fixer said it fixed and asks only whether the branch
 * now satisfies them
 * ([ADR-0032](../../docs/adr/0032-the-re-review-verifies-the-fix-it-was-handed.md)).
 * It answers in the same shape all the same, so its findings are the same axes
 * downstream — and it keeps a name of its own, because the two runs write a
 * findings file each and the second must not overwrite the first's.
 */
async function describeScope(scope: ReviewScope, baseBranch: string): Promise<ReviewTarget> {
  switch (scope.kind) {
    case "ticket":
      return {
        prompt: REVIEW_PROMPT,
        ...reviewRun("ticket", `#${scope.ticket.number}`, scope.base, AXIS_SETS.both),
        ticket: scope.ticket.number,
      };
    case "branch": {
      const axes = AXIS_SETS[scope.axes];
      if (scope.verifying) return verifyRun(scope.workItem, baseBranch, scope.verifying, axes);

      return {
        prompt: REVIEW_PROMPT,
        ...reviewRun("branch", `#${scope.workItem}`, baseBranch, axes),
      };
    }
    case "quality":
      return {
        prompt: QUALITY_PROMPT,
        schema: QUALITY_ANSWER,
        promptArgs: {
          ITEM: `#${scope.workItem}`,
          BASE: baseBranch,
          RUBRIC: await readResource(...RUBRIC_RESOURCE),
          SETTLED: strippedFindings(scope.settled),
        },
      };
  }
}

/**
 * Findings as a prompt reads them: stripped to their axis and their line,
 * because that is the whole of what the fixer was told, and `source` says
 * nothing a leg reading them does not already know.
 *
 * The same shape for the re-review's claims and for the quality scope's settled
 * list, since both are a leg being shown the sentences a fixer acted on.
 */
function strippedFindings(findings: readonly Finding[]): string {
  const stripped = findings.map((finding) => ({
    axis: findingLabel(finding),
    summary: finding.summary,
  }));
  return JSON.stringify(stripped, undefined, 2);
}

/**
 * The re-review's run: the fixer's own claims, and the same answer shape the
 * review it follows would have used.
 *
 * A run that verifies a fix has to read exactly the sentence the fixer read,
 * which is why its claims travel stripped.
 */
function verifyRun(
  workItem: number,
  baseBranch: string,
  verifying: readonly Finding[],
  axes: (typeof AXIS_SETS)[keyof typeof AXIS_SETS],
): ReviewTarget {
  return {
    rereview: true,
    prompt: REREVIEW_PROMPT,
    schema: axes.schema,
    promptArgs: {
      ITEM: `#${workItem}`,
      BASE: baseBranch,
      TRACKER_DOC: TRACKER_DOC_PATH,
      FIXES: strippedFindings(verifying),
      ANSWER: axes.answer,
    },
  };
}

/** The arguments and the schema one `review.md` run takes from its axis set. */
function reviewRun(
  scope: string,
  item: string,
  base: string,
  axes: (typeof AXIS_SETS)[keyof typeof AXIS_SETS],
): Pick<ReviewTarget, "promptArgs" | "schema"> {
  return {
    schema: axes.schema,
    promptArgs: {
      SCOPE: scope,
      ITEM: item,
      BASE: base,
      TRACKER_DOC: TRACKER_DOC_PATH,
      AXES: axes.asked,
      ANSWER: axes.answer,
    },
  };
}
