import type { Sandbox } from "@ai-hero/sandcastle";
import { z } from "zod";
import type { RelayConfig } from "./config.js";
import type { Crew, ImplementResult, TicketRef } from "./crew.js";
import { RoleError } from "./errors.js";
import { readResource } from "./resources.js";
import { roleAgent } from "./role-agent.js";
import { readTaggedOutput } from "./tagged-output.js";
import { TRACKER_DOC_PATH } from "./tracker-doc.js";

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

/**
 * The real implementer: one fresh cold agent per ticket that builds it under
 * TDD and commits it itself.
 *
 * The commit is the implementer's own leg rather than a role of its own —
 * only the agent that wrote the change knows what the commit says, and a
 * separate cold session would have to rediscover it from the diff.
 */
export function createImplementer({
  sandbox,
  config,
}: {
  sandbox: Sandbox;
  config: RelayConfig;
}): Crew["implement"] {
  return async function implement(ticket: TicketRef): Promise<ImplementResult> {
    const { stdout, commits } = await sandbox.run({
      name: `implementer-${ticket.key}`,
      agent: roleAgent(config.models.implementer),
      prompt: await readResource(IMPLEMENTER_PROMPT),
      promptArgs: {
        TICKET_KEY: ticket.key,
        TICKET_SUMMARY: ticket.summary,
        TRACKER_DOC: TRACKER_DOC_PATH,
      },
      signal: AbortSignal.timeout(config.roleTimeoutMs),
    });

    const result = readTaggedOutput({
      stdout,
      tag: IMPLEMENT_TAG,
      schema: implementSchema,
      role: "implementer",
    });

    // The implementer's own commit is what hands the ticket on: the reviewers
    // read it, and nothing else in the pass would commit the work for it.
    if (result.kind === "done" && commits.length === 0) {
      throw new RoleError(`The implementer reported ${ticket.key} done but committed nothing.`);
    }
    return result;
  };
}
