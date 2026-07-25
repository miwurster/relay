import type { Crew } from "./crew.js";

/**
 * A crew of stubs: the whole topology runs and every exit path is reachable
 * without an agent, a model or a network. Each real role replaces one method
 * of this in a later ticket.
 */
export function createStubCrew(): Crew {
  return {
    async plan(issue) {
      log("planner", `would plan ${issue.key}`);
      return { kind: "plan", tickets: [{ key: issue.key, summary: "the work item itself" }] };
    },

    async implement(ticket) {
      log("implementer", `would implement ${ticket.key}`);
      return { kind: "done", base: "HEAD" };
    },

    async review(lens, scope) {
      const target = scope.kind === "ticket" ? scope.ticket.key : "the branch";
      log(lens, `would review ${target}`);
      return [];
    },

    async fix(findings, target) {
      log("fixer", `would fix ${findings.length} findings in ${target.kind}`);
    },

    async qualityGate() {
      log("qualityGate", "would run the green gate");
      return { green: true, detail: "stub gate is always green" };
    },

    async handover(outcome) {
      log("handover", `would hand over: ${outcome.kind}`);
    },
  };
}

function log(role: string, message: string): void {
  console.log(`relay: [${role} stub] ${message}`);
}
