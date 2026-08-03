import { describe, expect, it } from "vitest";
import { RoleError } from "../../src/errors.js";
import { ExitCode } from "../../src/exit-codes.js";
import { exitCodeFor } from "../../src/pass/harness.js";
import {
  finding,
  recordingCrew,
  resolvedGate,
  run,
  ticket,
  twoTicketPlan,
} from "./harness-crew.js";

/**
 * A leg that ran and did not deliver a usable answer blocks the pass instead of
 * crashing it: the handover runs, and it is told everything the pass got through
 * ([ADR-0036](../../docs/adr/0036-a-leg-that-fails-to-answer-blocks-the-pass-and-never-on-quality.md)).
 */
describe("runHarness over a leg that fails to answer", () => {
  const slip = new RoleError("the implementer emitted no <relay-implement> block");

  it("turns the failure into a mid-block carrying the error's own sentence", async () => {
    const { crew } = recordingCrew({
      async implement() {
        throw slip;
      },
    });

    expect(await run(crew)).toEqual({ kind: "mid-block", reason: slip.message });
  });

  it("still reaches the handover, and hands it that outcome", async () => {
    const { crew, calls, handover } = recordingCrew({
      async implement(ref) {
        calls.push(`implement:${ref.number}`);
        throw slip;
      },
    });

    await run(crew);

    expect(calls).toEqual(["resolveGate", "plan", "implement:1", "handover:mid-block"]);
    expect(handover()).toEqual({ kind: "mid-block", reason: slip.message });
  });

  it("blocks the pass, since a leg that cannot answer is still a human's problem", async () => {
    const { crew } = recordingCrew({
      async implement() {
        throw slip;
      },
    });

    expect(exitCodeFor(await run(crew))).toBe(ExitCode.Blocked);
  });

  it("hands over what the pass had got through by then, not an empty pass", async () => {
    const wanted = finding("ticket-review", "standards", "inline the second loader", 1);
    const { crew, committed, finished, gate, unaddressed } = recordingCrew({
      ...twoTicketPlan,
      async review(scope) {
        return scope.kind === "ticket" && scope.ticket.number === 1 ? [wanted] : [];
      },
      async fix(findings) {
        return { fixed: [], skipped: findings.map((f) => ({ finding: f, reason: "as designed" })) };
      },
      async implement(ref) {
        if (ref.number === 2) throw slip;
        return { kind: "done", base: "c0ffee" };
      },
    });

    await run(crew);

    expect(committed()).toEqual([ticket(1)]);
    // Built and reviewed before the failure, and its one declined finding is not
    // binding — so the ticket the pass got through still earned its done.
    expect(finished()).toEqual([ticket(1)]);
    expect(unaddressed()).toEqual([{ finding: wanted, reason: "as designed" }]);
    // It never reached its gate, and says so rather than claiming a verdict.
    expect(gate().kind).toBe("not-gated");
  });

  it("hands over the red verdict the gate loop reached when its fixer fails to answer", async () => {
    const { crew, gate } = recordingCrew({
      async greenGate() {
        return { green: false, detail: "npm run verify: 2 failing tests" };
      },
      async fix() {
        throw slip;
      },
    });

    await run(crew);

    // The gate ran and said something, so `not-gated` would be a claim about a
    // gate nobody asked for.
    expect(gate()).toEqual({
      kind: "gated",
      gate: resolvedGate,
      green: false,
      detail: "npm run verify: 2 failing tests",
    });
  });

  it("blocks on a binding stage's reviewer too, rather than crashing the pass", async () => {
    const { crew, calls } = recordingCrew({
      async review() {
        throw slip;
      },
    });

    expect(await run(crew)).toEqual({ kind: "mid-block", reason: slip.message });
    expect(calls).toContain("handover:mid-block");
  });

  it("leaves a genuine crash a crash, so the pass's error path keeps its own cases", async () => {
    const { crew, calls } = recordingCrew({
      async implement() {
        throw new Error("the sandbox died");
      },
    });

    await expect(run(crew)).rejects.toThrow("the sandbox died");
    expect(calls).not.toContain("handover:mid-block");
  });

  /**
   * The one leg outside the rule: it is what would have reported the block, so
   * there is nothing left to hand the work to.
   */
  it("lets a handover that fails to answer through as the crash it is", async () => {
    const { crew } = recordingCrew({
      async handover() {
        throw new RoleError("handover emitted no <relay-handover> block");
      },
    });

    await expect(run(crew)).rejects.toThrow(RoleError);
  });
});
