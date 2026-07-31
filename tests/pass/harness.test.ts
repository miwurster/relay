import { describe, expect, it } from "vitest";
import type {
  GateResult,
  ImplementResult,
  PlanResult,
  ResolvedGate,
  TicketRef,
} from "../../src/crew/contract.js";
import { ExitCode } from "../../src/exit-codes.js";
import { exitCodeFor, MAX_GATE_FIX_ATTEMPTS, runHarness } from "../../src/pass/harness.js";
import { createStubCrew } from "../crew/stub-crew.js";
import {
  finding,
  gateFinding,
  issue,
  recordingCrew,
  resolvedGate,
  run,
  skippedAll,
  ticket,
  twoTicketPlan,
} from "./harness-crew.js";

/** A two-ticket plan whose second implementer asks for a human before it commits. */
const bailsOnTicketTwo = {
  async plan(): Promise<PlanResult> {
    return { kind: "plan", tickets: [ticket(1), ticket(2)] };
  },
  async implement(ref: TicketRef): Promise<ImplementResult> {
    return ref.number === 2
      ? { kind: "needs-input", reason: "which queue does this drain?" }
      : { kind: "done", base: "c0ffee" };
  },
};

describe("runHarness", () => {
  it("runs the full topology in order: plan, per-ticket loop, branch review, quality review, gate, land, handover", async () => {
    const { crew, calls } = recordingCrew({
      async plan() {
        calls.push("plan");
        return { kind: "plan", tickets: [ticket(1), ticket(2)] };
      },
    });

    const outcome = await run(crew);

    expect(outcome).toEqual({ kind: "success", detail: "green" });
    expect(calls).toEqual([
      "resolveGate",
      "plan",
      "implement:1",
      "review:1",
      "implement:2",
      "review:2",
      "review:branch",
      "review:quality",
      "gate",
      "land",
      "handover:success",
    ]);
  });

  it("hands a scope's findings to the fixer as the review reported them", async () => {
    const { crew, fixed } = recordingCrew({
      ...twoTicketPlan,
      async review(scope) {
        if (scope.kind !== "ticket") return [];
        return [finding("ticketReview", "standards", "same problem", scope.ticket.number)];
      },
    });

    await run(crew);

    expect(fixed[0]).toEqual([finding("ticketReview", "standards", "same problem", 1)]);
  });

  it("tells each fixer leg what it is fixing", async () => {
    const { crew, fixTargets } = recordingCrew({
      ...twoTicketPlan,
      async review(scope) {
        // The re-review's findings reach no fixer, so it reports nothing here.
        if (scope.kind === "branch" && scope.rereview) return [];
        const ticketNumber = scope.kind === "ticket" ? scope.ticket.number : undefined;
        return [finding("ticketReview", "standards", "same problem", ticketNumber)];
      },
      async greenGate() {
        return { green: false, detail: "still red" };
      },
    });

    await run(crew);

    expect(fixTargets).toEqual([
      { kind: "ticket", ticket: ticket(1) },
      { kind: "ticket", ticket: ticket(2) },
      { kind: "branch" },
      { kind: "quality" },
      { kind: "gate", attempt: 1 },
      { kind: "gate", attempt: 2 },
    ]);
  });

  it("reviews a single-ticket plan once, at branch scope, not twice", async () => {
    const { crew, calls } = recordingCrew();

    await run(crew);

    expect(calls).toEqual([
      "resolveGate",
      "plan",
      "implement:1",
      "review:branch",
      "review:quality",
      "gate",
      "land",
      "handover:success",
    ]);
  });

  it("does not call the fixer when the review found nothing", async () => {
    const { crew, calls } = recordingCrew();

    await run(crew);

    expect(calls).not.toContain("fix");
  });

  it("loops gate and fixer until green", async () => {
    const verdicts: GateResult[] = [
      { green: false, detail: "one test red" },
      { green: true, detail: "green" },
    ];
    const { crew, calls, fixed } = recordingCrew({
      async greenGate() {
        calls.push("gate");
        return verdicts.shift() ?? { green: true, detail: "green" };
      },
    });

    const outcome = await run(crew);

    expect(outcome).toEqual({ kind: "success", detail: "green" });
    expect(calls.filter((call) => call === "gate")).toHaveLength(2);
    expect(fixed.at(-1)).toEqual([gateFinding("one test red")]);
  });

  it("numbers each gate run, so the loop's legs stay apart", async () => {
    const attempts: number[] = [];
    const { crew } = recordingCrew({
      async greenGate(attempt) {
        attempts.push(attempt);
        return { green: false, detail: "still red" };
      },
    });

    await run(crew);

    expect(attempts).toEqual([1, 2, 3]);
  });

  it("resolves the gate once and hands that same one to every attempt of the loop", async () => {
    const gates: ResolvedGate[] = [];
    const { crew, calls } = recordingCrew({
      async greenGate(_attempt, gate) {
        gates.push(gate);
        return { green: false, detail: "still red" };
      },
    });

    await run(crew);

    expect(gates).toHaveLength(3);
    expect(new Set(gates)).toEqual(new Set([gates[0]]));
    expect(gates[0]).toEqual(resolvedGate);
    expect(calls.filter((call) => call === "resolveGate")).toHaveLength(1);
  });

  it("gives up after two fixer attempts and mid-blocks on a red gate", async () => {
    const { crew, calls } = recordingCrew({
      async greenGate() {
        calls.push("gate");
        return { green: false, detail: "still red" };
      },
    });

    const outcome = await run(crew);

    expect(outcome).toEqual({ kind: "mid-block", reason: "still red" });
    expect(calls.filter((call) => call === "fix")).toHaveLength(MAX_GATE_FIX_ATTEMPTS);
    expect(calls.at(-1)).toBe("handover:mid-block");
  });

  it("bails early on an under-specified item without implementing anything", async () => {
    const { crew, calls } = recordingCrew({
      async plan() {
        calls.push("plan");
        return { kind: "under-specified", reason: "no acceptance criteria" };
      },
    });

    const outcome = await run(crew);

    expect(outcome).toEqual({ kind: "early-bail", reason: "no acceptance criteria" });
    expect(calls).toEqual(["resolveGate", "plan", "handover:early-bail"]);
  });

  it("collapses a role that needs input into a mid-block handover, never a pause", async () => {
    const { crew, calls, committed } = recordingCrew({
      async plan() {
        calls.push("plan");
        return { kind: "plan", tickets: [ticket(1), ticket(2)] };
      },
      async implement(ref) {
        calls.push(`implement:${ref.number}`);
        return { kind: "needs-input", reason: "which queue does this drain?" };
      },
    });

    const outcome = await run(crew);

    expect(outcome).toEqual({ kind: "mid-block", reason: "which queue does this drain?" });
    expect(committed()).toEqual([]);
    expect(calls).toEqual(["resolveGate", "plan", "implement:1", "handover:mid-block"]);
  });

  it("hands the handover the tickets committed before a block, and no more", async () => {
    const { crew, committed } = recordingCrew(bailsOnTicketTwo);

    const outcome = await run(crew);

    expect(outcome).toEqual({ kind: "mid-block", reason: "which queue does this drain?" });
    expect(committed()).toEqual([ticket(1)]);
  });

  it("blocks on the ticket an implementer asked for a human over, which it never committed", async () => {
    const { crew, finished, blocked } = recordingCrew(bailsOnTicketTwo);

    await run(crew);

    // Its implementer applied the hold before it asked, so the handover has to be
    // told which ticket is carrying it — the committed list never names it.
    expect(finished()).toEqual([ticket(1)]);
    expect(blocked()).toEqual([ticket(2)]);
  });

  it("hands the handover every ticket of a pass that finished", async () => {
    const { crew, committed } = recordingCrew({
      async plan() {
        return { kind: "plan", tickets: [ticket(1), ticket(2)] };
      },
    });

    await run(crew);

    expect(committed()).toEqual([ticket(1), ticket(2)]);
  });

  it("finishes every committed ticket of a successful pass, since nothing was left unaddressed", async () => {
    const { crew, committed, finished } = recordingCrew({
      async plan() {
        return { kind: "plan", tickets: [ticket(1), ticket(2)] };
      },
    });

    await run(crew);

    expect(finished()).toEqual(committed());
  });

  it("hands an early bail over with no committed tickets", async () => {
    const { crew, committed } = recordingCrew({
      async plan() {
        return { kind: "under-specified", reason: "no acceptance criteria" };
      },
    });

    await run(crew);

    expect(committed()).toEqual([]);
  });

  it("hands the handover every finding nobody addressed", async () => {
    const { crew, unaddressed } = recordingCrew({
      async review(scope) {
        if (scope.kind !== "branch" || scope.rereview) return [];
        return [finding("branchReview", "standards", "the two loaders should be one")];
      },
      async fix(findings) {
        return skippedAll(findings, "AGENTS.md prefers one file until a second caller exists");
      },
    });

    const outcome = await run(crew);

    expect(outcome.kind).toBe("success");
    expect(unaddressed()).toEqual([
      {
        finding: finding("branchReview", "standards", "the two loaders should be one"),
        reason: "AGENTS.md prefers one file until a second caller exists",
      },
    ]);
  });

  it("hands the handover nothing when every finding was fixed", async () => {
    const { crew, unaddressed } = recordingCrew({
      async review(scope) {
        if (scope.kind !== "branch" || scope.rereview) return [];
        return [finding("branchReview", "spec", "the retry cap is still hardcoded")];
      },
    });

    await run(crew);

    expect(unaddressed()).toEqual([]);
  });

  it("reports a gate finding the fixer declined without blocking on it", async () => {
    const verdicts: GateResult[] = [
      { green: false, detail: "one test red" },
      { green: true, detail: "green" },
    ];
    const { crew, unaddressed } = recordingCrew({
      async greenGate() {
        return verdicts.shift() ?? { green: true, detail: "green" };
      },
      async fix(findings) {
        return skippedAll(findings, "that test is flaky, not broken");
      },
    });

    const outcome = await run(crew);

    expect(outcome).toEqual({ kind: "success", detail: "green" });
    expect(unaddressed()).toEqual([
      { finding: gateFinding("one test red"), reason: "that test is flaky, not broken" },
    ]);
  });

  it("runs end to end on the stub crew", async () => {
    const outcome = await runHarness(createStubCrew(), issue);

    expect(outcome).toEqual({ kind: "success", detail: "stub gate is always green" });
  });

  it("runs end to end on the stub crew of a merge-landing repo", async () => {
    const outcome = await runHarness(createStubCrew({ landing: "merge" }), issue);

    expect(outcome).toEqual({ kind: "success", detail: "stub gate is always green" });
  });
});

describe("exitCodeFor", () => {
  it("maps a reviewable pass to success", () => {
    expect(exitCodeFor({ kind: "success", detail: "green" })).toBe(ExitCode.Success);
  });

  it("maps both blocked outcomes to the blocked code", () => {
    expect(exitCodeFor({ kind: "mid-block", reason: "red" })).toBe(ExitCode.Blocked);
    expect(exitCodeFor({ kind: "early-bail", reason: "thin" })).toBe(ExitCode.Blocked);
  });
});
