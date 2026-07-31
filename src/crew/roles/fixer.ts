import { z } from "zod";
import type { RelayConfig } from "../../config.js";
import {
  type Crew,
  type Finding,
  findingLabel,
  type FixReport,
  type FixTarget,
  type Verdict,
} from "../contract.js";
import { RoleError } from "../../errors.js";
import { type FindingVerdict, writeVerdictsFile } from "../leg-record.js";
import { type RoleDeps, runRole } from "../run-role.js";

/** The block the fixer ends its run with, and the prompt it runs from. */
export const FIX_TAG = "relay-fix";
const FIXER_PROMPT = "fixer.md";

/**
 * How a fixer leg answers one finding, under the id relay handed that finding to
 * it by. A decline has to say why: it is the only account of the finding anyone
 * gets, and a binding one blocks the pass on that sentence.
 */
const verdictSchema = z.discriminatedUnion("kind", [
  z.object({ id: z.string().min(1), kind: z.literal("fixed") }),
  z.object({ id: z.string().min(1), kind: z.literal("skipped"), reason: z.string().min(1) }),
]);

/**
 * How a fixer leg may end: one verdict per finding it was handed, and no other
 * way out.
 *
 * A finding the fixer judges wrong or already handled is not a failure —
 * inventing a change for it would be worse than saying so. What declining costs
 * is not the leg's to decide, so it reports and the harness judges.
 */
const fixSchema = z.array(verdictSchema);

/** What one fix target means to the run that acts on it, resolved once. */
interface FixLeg {
  /** What the run is called, so the pass's fixer legs stay apart. */
  name: string;
  /** What the fixer is told it is fixing. */
  scope: string;
  /** The model this leg runs on. */
  model: string;
}

/**
 * The real fixer: one cold agent run that acts on the findings it is handed,
 * commits the result itself, and answers for every finding either way.
 *
 * The same role runs all the fixer legs — after a ticket's review, after the
 * whole-branch review, after the quality review, and inside the gate loop —
 * because all of them are the same job: a list of findings over the branch as it
 * stands. Only the leg's name, the scope it is told, and its model differ.
 */
export function createFixer(deps: RoleDeps): Crew["fix"] {
  return async function fix(findings: readonly Finding[], target: FixTarget): Promise<FixReport> {
    const leg = describeLeg(target, deps.config);
    const name = `fixer-${leg.name}`;
    const identified = identify(findings);

    const answers = await runRole({
      ...deps,
      name,
      model: leg.model,
      prompt: FIXER_PROMPT,
      promptArgs: {
        SCOPE: leg.scope,
        // The harness's merge, verbatim but for the ids: the fixer is the only
        // role that can tell two phrasings of one problem apart, so it dedups
        // them itself — and it still owes a verdict for each of them.
        FINDINGS: JSON.stringify(promptFindings(identified), undefined, 2),
      },
      tag: FIX_TAG,
      schema: fixSchema,
      // The commit is what carries the fix to the reviews and the gate that read
      // the branch next, so a fix nobody committed is a fix that did not happen.
      // A leg that changed nothing has nothing to commit.
      branchRule: (answer) => (answer.some(({ kind }) => kind === "fixed") ? "must-commit" : "any"),
    });

    const records = recordsOf(identified, answers, name);
    await writeVerdictsFile({ dir: deps.recordDir, name, verdicts: records });
    reportSkips(records);
    return reportOf(records);
  };
}

function describeLeg(target: FixTarget, config: RelayConfig): FixLeg {
  const { fixer, fixerEscalated } = config.models;
  switch (target.kind) {
    case "ticket":
      return {
        name: String(target.ticket.number),
        scope: `ticket #${target.ticket.number}`,
        model: fixer,
      };
    case "branch":
      return { name: "branch", scope: "the whole branch", model: fixer };
    case "quality":
      return { name: "quality", scope: "the whole branch's structure", model: fixer };
    case "gate":
      return {
        name: `gate-${target.attempt}`,
        scope: `the green gate, fix attempt ${target.attempt}`,
        // The gate is the pass's one retried leg, so it is the one place a
        // model can be shown to have failed at the job before it is escalated.
        model: target.attempt > 1 ? fixerEscalated : fixer,
      };
  }
}

/**
 * Give each finding the id its verdict has to quote.
 *
 * The ids live here rather than on `Finding` itself: a finding's identity is
 * what this one prompt and this one answer agree to call it, not a fact about
 * the finding. An id carries its label and its place in the list, so a binding
 * one reads as `spec-1` and a fixer that answers the wrong one is visible in its
 * own answer.
 */
function identify(findings: readonly Finding[]): Map<string, Finding> {
  return new Map(
    findings.map((finding, index) => [`${findingLabel(finding)}-${index + 1}`, finding]),
  );
}

function promptFindings(identified: Map<string, Finding>): unknown[] {
  return [...identified].map(([id, finding]) => ({ id, ...finding }));
}

/**
 * Pair each verdict back with the finding it answers, and refuse a leg whose
 * verdicts do not account for exactly the findings it was handed.
 *
 * An id it invented, answered twice, or never answered would leave a finding
 * with nobody's decision recorded against it — which is the one thing a
 * per-finding verdict exists to make impossible.
 */
function recordsOf(
  identified: Map<string, Finding>,
  answers: z.infer<typeof fixSchema>,
  name: string,
): FindingVerdict[] {
  const answered = new Set<string>();
  const records = answers.map((answer) => {
    const finding = identified.get(answer.id);
    if (!finding) {
      throw new RoleError(`${name} reported a verdict for ${answer.id}, which it was not handed.`);
    }
    if (answered.has(answer.id)) {
      throw new RoleError(`${name} reported a verdict for ${answer.id} twice.`);
    }
    answered.add(answer.id);
    return { id: answer.id, finding, verdict: verdictOf(answer) };
  });

  const unanswered = [...identified.keys()].filter((id) => !answered.has(id));
  if (unanswered.length > 0) {
    throw new RoleError(
      `${name} left ${unanswered.join(", ")} unanswered; every finding needs a verdict.`,
    );
  }
  return records;
}

function verdictOf(answer: z.infer<typeof verdictSchema>): Verdict {
  return answer.kind === "fixed" ? { kind: "fixed" } : { kind: "skipped", reason: answer.reason };
}

function reportOf(records: readonly FindingVerdict[]): FixReport {
  return {
    fixed: records.filter(({ verdict }) => verdict.kind === "fixed").map(({ finding }) => finding),
    skipped: records.flatMap(({ finding, verdict }) =>
      verdict.kind === "skipped" ? [{ finding, reason: verdict.reason }] : [],
    ),
  };
}

/**
 * Say what the leg declined, as it declines it.
 *
 * The record file and the handover both carry this too, but an operator watching
 * a pass go by should not have to wait for the handover to learn that a role
 * overrode a call about their repo.
 */
function reportSkips(records: readonly FindingVerdict[]): void {
  for (const { finding, verdict } of records) {
    if (verdict.kind !== "skipped") continue;
    console.log(
      `relay: [fixer] left a ${findingLabel(finding)} finding unfixed — ` +
        `${finding.summary}: ${verdict.reason}`,
    );
  }
}
