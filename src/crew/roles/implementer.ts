import type { Sandbox } from "@ai-hero/sandcastle";
import { z } from "zod";
import type { Crew, ImplementResult, TicketRef } from "../contract.js";
import { RoleError } from "../../errors.js";
import { type RoleDeps, runRole } from "../run-role.js";
import { TRACKER_DOC_PATH } from "../../tracker/tracker-doc.js";

/** The block the implementer ends its run with, and the prompt it runs from. */
export const IMPLEMENT_TAG = "relay-implement";
const IMPLEMENTER_PROMPT = "implementer.md";

/**
 * How an implementer leg may end. There is no "failed" arm: an implementer
 * that cannot finish names what it needs from a human, and the harness turns
 * that into a mid-block handover.
 */
const implementSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("done") }),
  z.object({ kind: z.literal("needs-input"), reason: z.string().min(1) }),
]);

/** What the branch is at, so the ticket's own change has a base to diff from. */
async function headSha(sandbox: Sandbox): Promise<string> {
  const { stdout, stderr, exitCode } = await sandbox.exec("git rev-parse HEAD");
  if (exitCode !== 0) {
    throw new RoleError(`Could not read the branch's HEAD before implementing: ${stderr.trim()}`);
  }
  return stdout.trim();
}

/**
 * The tickets of this pass that are already on the branch, one line each.
 *
 * Empty for the pass's first ticket, which is not an error: there is nothing
 * behind it to build on.
 */
async function passCommits(sandbox: Sandbox, baseBranch: string): Promise<string> {
  const { stdout, stderr, exitCode } = await sandbox.exec(`git log --oneline ${baseBranch}..HEAD`);
  if (exitCode !== 0) {
    throw new RoleError(`Could not read the pass's commits before implementing: ${stderr.trim()}`);
  }
  return stdout.trim();
}

/**
 * The real implementer: one fresh cold agent per ticket that builds it under
 * TDD and commits it itself.
 *
 * The commit is the implementer's own leg rather than a role of its own —
 * only the agent that wrote the change knows what the commit says, and a
 * separate cold session would have to rediscover it from the diff.
 */
export function createImplementer({
  baseBranch,
  ...deps
}: RoleDeps & {
  /** The branch the pass was cut from, so its own commits can be told apart. */
  baseBranch: string;
}): Crew["implement"] {
  return async function implement(ticket: TicketRef): Promise<ImplementResult> {
    // Read before the run: afterwards the ticket's own commits are in the way,
    // and this is what the reviewers diff the ticket's change from.
    const base = await headSha(deps.sandbox);
    const earlierCommits = await passCommits(deps.sandbox, baseBranch);

    const result = await runRole({
      ...deps,
      name: `implementer-${ticket.number}`,
      model: deps.config.models.implementer,
      prompt: IMPLEMENTER_PROMPT,
      promptArgs: {
        TICKET: `#${ticket.number}`,
        TICKET_SUMMARY: ticket.summary,
        TRACKER_DOC: TRACKER_DOC_PATH,
        // What the pass has already built, so the prompt's promise that earlier
        // tickets are on the branch is one the leg can actually act on.
        PASS_COMMITS: earlierCommits,
      },
      tag: IMPLEMENT_TAG,
      schema: implementSchema,
      // The implementer's own commit is what hands the ticket on: the reviewers
      // read it, and nothing else in the pass would commit the work for it.
      branchRule: (answer) => (answer.kind === "done" ? "must-commit" : "any"),
    });

    return result.kind === "done" ? { ...result, base } : result;
  };
}
