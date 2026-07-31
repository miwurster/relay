import type { Landing } from "../../src/config.js";
import {
  type Crew,
  type GateResult,
  type LandResult,
  NO_LANDING,
  reviewKindOf,
} from "../../src/crew/contract.js";

/**
 * A crew of stubs: the whole topology runs and every exit path is reachable
 * without an agent, a model or a network — which is what lets the harness's own
 * decisions be tested without running one.
 *
 * A stub crew lands exactly where a real one does: under `merge` landing.
 */
export function createStubCrew({ landing = "pull-request" }: { landing?: Landing } = {}): Crew {
  return {
    land: landing === "merge" ? stubLand : () => Promise.resolve(NO_LANDING),

    async resolveGate() {
      log("gateResolver", "would read the repo's docs for its green gate");
      return { command: "true", provenance: "inferred", source: "the stub crew" };
    },

    async plan(issue) {
      log("planner", `would plan #${issue.number}`);
      return { kind: "plan", tickets: [{ number: issue.number, summary: "the work item itself" }] };
    },

    async implement(ticket) {
      log("implementer", `would implement #${ticket.number}`);
      return { kind: "done", base: "HEAD" };
    },

    async review(scope) {
      const target = scope.kind === "ticket" ? `#${scope.ticket.number}` : "the branch";
      log(reviewKindOf(scope), `would review ${target}`);
      return [];
    },

    async fix(findings, target) {
      log("fixer", `would fix ${findings.length} findings in ${target.kind}`);
      // A stub fixes everything: declining is what makes a pass block, and the
      // stub crew is the one that reaches every exit path on its own.
      return { fixed: findings, skipped: [] };
    },

    async greenGate(attempt, gate) {
      log("greenGate", `would run \`${gate.command}\` (attempt ${attempt})`);
      return { green: true, detail: "stub gate is always green" };
    },

    async handover(outcome, committed, _land, unaddressed) {
      log(
        "handover",
        `would hand over: ${outcome.kind}, closing ${committed.length} tickets, ` +
          `with ${unaddressed.length} findings left unaddressed`,
      );
    },
  };
}

/** The lander stub: it re-gates through the harness's gate, as the real one does. */
async function stubLand(regate: () => Promise<GateResult>): Promise<LandResult> {
  log("lander", "would rebase the pass branch onto the base branch");
  const gate = await regate();
  return gate.green
    ? { kind: "landed", detail: "the stub lander landed nothing, on purpose" }
    : { kind: "not-landed", reason: gate.detail };
}

function log(role: string, message: string): void {
  console.log(`relay: [${role} stub] ${message}`);
}
