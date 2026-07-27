import { z } from "zod";
import type { Crew, ResolvedGate } from "../contract.js";
import { type RoleDeps, runRole } from "../run-role.js";

/** The block the resolver ends its run with, and the prompt it runs from. */
export const RESOLVED_GATE_TAG = "relay-resolved-gate";
const RESOLVER_PROMPT = "gate-resolver.md";

/** The answer the resolver reports: a command, and where it came from. */
const resolvedGateSchema = z.object({
  command: z.string().min(1),
  provenance: z.enum(["declared", "inferred"]),
  source: z.string().min(1),
});

/**
 * The real gate resolver: one cold agent run that reads the repo's own docs and
 * answers with the command every later leg of the pass verifies against.
 *
 * It reads rather than asks, because the repo already tells its contributors how
 * it is verified. What it reads, in which order, and what it falls back to when
 * no doc declares a gate are the prompt's — relay hardcodes nothing about how a
 * repo phrases its own gate.
 */
export function createGateResolver(deps: RoleDeps): Crew["resolveGate"] {
  return async function resolveGate(): Promise<ResolvedGate> {
    return await runRole({
      ...deps,
      name: "gate-resolver",
      model: deps.config.models.gateResolver,
      prompt: RESOLVER_PROMPT,
      promptArgs: {},
      tag: RESOLVED_GATE_TAG,
      schema: resolvedGateSchema,
      // It reads the docs and never changes them. Dirt is not checked because
      // it cannot be the resolver's: this is the pass's first leg, so anything
      // already in the worktree came with the clone or the image.
      branchRule: () => "no-commits",
    });
  };
}
