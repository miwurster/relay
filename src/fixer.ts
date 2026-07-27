import { z } from "zod";
import type { RelayConfig } from "./config.js";
import type { Crew, Finding, FixTarget } from "./crew.js";
import { type RoleDeps, runRole } from "./run-role.js";

/** The block the fixer ends its run with, and the prompt it runs from. */
export const FIX_TAG = "relay-fix";
const FIXER_PROMPT = "fixer.md";

/**
 * How a fixer leg may end. A finding the fixer judges wrong or already handled
 * is not a failure — inventing a change for it would be worse than saying so,
 * and a leg that cannot commit must still leave the pass its own way out.
 */
const fixSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("fixed") }),
  z.object({ kind: z.literal("nothing-to-fix"), reason: z.string().min(1) }),
]);

/** What one fix target means to the run that acts on it, resolved once. */
interface FixLeg {
  /** What the run is called, so the pass's three fixer legs stay apart. */
  name: string;
  /** What the fixer is told it is fixing. */
  scope: string;
  /** The model this leg runs on. */
  model: string;
}

/**
 * The real fixer: one cold agent run that acts on the findings it is handed and
 * commits the result itself.
 *
 * The same role runs all three fixer legs — after a ticket's lenses, after the
 * whole-branch lenses, and inside the gate loop — because all three are the
 * same job: a merged list of findings over the branch as it stands. Only the
 * leg's name, the scope it is told, and its model differ.
 */
export function createFixer(deps: RoleDeps): Crew["fix"] {
  return async function fix(findings: readonly Finding[], target: FixTarget): Promise<void> {
    const leg = describeLeg(target, deps.config);

    const result = await runRole({
      ...deps,
      name: `fixer-${leg.name}`,
      model: leg.model,
      prompt: FIXER_PROMPT,
      promptArgs: {
        SCOPE: leg.scope,
        // The harness's merge, verbatim: the fixer is the only role that can
        // tell two phrasings of one problem apart, so it dedups them itself.
        FINDINGS: JSON.stringify(findings, undefined, 2),
      },
      tag: FIX_TAG,
      schema: fixSchema,
      // The commit is what carries the fix to the lenses and the gate that read
      // the branch next, so a fix nobody committed is a fix that did not happen.
      branchRule: (answer) => (answer.kind === "fixed" ? "must-commit" : "any"),
    });

    if (result.kind === "nothing-to-fix") {
      console.log(`relay: [fixer] left ${leg.scope} unchanged: ${result.reason}`);
    }
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
