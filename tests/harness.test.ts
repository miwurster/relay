import { describe, expect, it } from "vitest";
import type {
  Crew,
  Finding,
  FixTarget,
  GateResult,
  ImplementResult,
  Outcome,
  PlanResult,
  ReviewLens,
  ReviewScope,
  TicketRef,
} from "../src/crew.js";
import { ExitCode } from "../src/exit-codes.js";
import { exitCodeFor, MAX_GATE_FIX_ATTEMPTS, runHarness } from "../src/harness.js";
import type { GitHubIssue } from "../src/github.js";
import { createStubCrew } from "../src/stub-crew.js";

const issue: GitHubIssue = {
  number: 1,
  labels: ["ready-for-agent"],
  isOpen: true,
  blockedBy: [],
  subIssues: [],
};

const ticket = (key: string): TicketRef => ({ key, summary: `work on ${key}` });

const finding = (source: Finding["source"], summary: string, ticket?: string): Finding => ({
  source,
  summary,
  ...(ticket ? { ticket } : {}),
});

/** A crew that records the order of every leg, with overridable roles. */
function recordingCrew(overrides: Partial<Crew> = {}) {
  const calls: string[] = [];
  const fixed: Finding[][] = [];
  const fixTargets: FixTarget[] = [];
  let handedOver: Outcome | undefined;

  const crew: Crew = {
    async plan(): Promise<PlanResult> {
      calls.push("plan");
      return { kind: "plan", tickets: [ticket("PSD-1")] };
    },
    async implement(ref): Promise<ImplementResult> {
      calls.push(`implement:${ref.key}`);
      return { kind: "done", base: "c0ffee" };
    },
    async review(lens: ReviewLens, scope: ReviewScope): Promise<Finding[]> {
      calls.push(`review:${lens}:${scope.kind === "ticket" ? scope.ticket.key : "branch"}`);
      return [];
    },
    async fix(findings, target): Promise<void> {
      calls.push("fix");
      fixed.push([...findings]);
      fixTargets.push(target);
    },
    async greenGate(): Promise<GateResult> {
      calls.push("gate");
      return { green: true, detail: "green" };
    },
    async handover(outcome): Promise<void> {
      calls.push(`handover:${outcome.kind}`);
      handedOver = outcome;
    },
    ...overrides,
  };

  return { crew, calls, fixed, fixTargets, handover: () => handedOver };
}

describe("runHarness", () => {
  it("runs the full topology in order: plan, per-ticket loop, branch review, gate, handover", async () => {
    const { crew, calls } = recordingCrew({
      async plan() {
        calls.push("plan");
        return { kind: "plan", tickets: [ticket("PSD-1"), ticket("PSD-2")] };
      },
    });

    const outcome = await runHarness(crew, issue);

    expect(outcome).toEqual({ kind: "success" });
    expect(calls).toEqual([
      "plan",
      "implement:PSD-1",
      "review:fastCodeReview:PSD-1",
      "review:fastSpecReview:PSD-1",
      "implement:PSD-2",
      "review:fastCodeReview:PSD-2",
      "review:fastSpecReview:PSD-2",
      "review:inDepthCodeReview:branch",
      "review:inDepthSpecReview:branch",
      "gate",
      "handover:success",
    ]);
  });

  it("runs the lenses of a scope one at a time, since they share one worktree", async () => {
    const events: string[] = [];

    const { crew } = recordingCrew({
      async review(lens: ReviewLens) {
        events.push(`start:${lens}`);
        await Promise.resolve();
        events.push(`end:${lens}`);
        return [];
      },
    });

    await runHarness(crew, issue);

    expect(events).toEqual([
      "start:fastCodeReview",
      "end:fastCodeReview",
      "start:fastSpecReview",
      "end:fastSpecReview",
      "start:inDepthCodeReview",
      "end:inDepthCodeReview",
      "start:inDepthSpecReview",
      "end:inDepthSpecReview",
    ]);
  });

  it("array-merges both lenses' findings into one fixer call", async () => {
    const { crew, fixed } = recordingCrew({
      async review(lens, scope) {
        if (scope.kind !== "ticket") return [];
        return [finding(lens, "same problem", scope.ticket.key)];
      },
    });

    await runHarness(crew, issue);

    expect(fixed[0]).toEqual([
      finding("fastCodeReview", "same problem", "PSD-1"),
      finding("fastSpecReview", "same problem", "PSD-1"),
    ]);
  });

  it("tells each fixer leg what it is fixing", async () => {
    const { crew, fixTargets } = recordingCrew({
      async review(lens, scope) {
        const ticketKey = scope.kind === "ticket" ? scope.ticket.key : undefined;
        return [finding(lens, "same problem", ticketKey)];
      },
      async greenGate() {
        return { green: false, detail: "still red" };
      },
    });

    await runHarness(crew, issue);

    expect(fixTargets).toEqual([
      { kind: "ticket", ticket: ticket("PSD-1") },
      { kind: "branch" },
      { kind: "gate", attempt: 1 },
      { kind: "gate", attempt: 2 },
    ]);
  });

  it("does not call the fixer when no lens found anything", async () => {
    const { crew, calls } = recordingCrew();

    await runHarness(crew, issue);

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

    const outcome = await runHarness(crew, issue);

    expect(outcome).toEqual({ kind: "success" });
    expect(calls.filter((call) => call === "gate")).toHaveLength(2);
    expect(fixed.at(-1)).toEqual([finding("greenGate", "one test red")]);
  });

  it("numbers each gate run, so the loop's legs stay apart", async () => {
    const attempts: number[] = [];
    const { crew } = recordingCrew({
      async greenGate(attempt) {
        attempts.push(attempt);
        return { green: false, detail: "still red" };
      },
    });

    await runHarness(crew, issue);

    expect(attempts).toEqual([1, 2, 3]);
  });

  it("gives up after two fixer attempts and mid-blocks on a red gate", async () => {
    const { crew, calls } = recordingCrew({
      async greenGate() {
        calls.push("gate");
        return { green: false, detail: "still red" };
      },
    });

    const outcome = await runHarness(crew, issue);

    expect(outcome).toEqual({ kind: "mid-block", reason: "still red", hasWork: true });
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

    const outcome = await runHarness(crew, issue);

    expect(outcome).toEqual({ kind: "early-bail", reason: "no acceptance criteria" });
    expect(calls).toEqual(["plan", "handover:early-bail"]);
  });

  it("collapses a role that needs input into a mid-block handover, never a pause", async () => {
    const { crew, calls } = recordingCrew({
      async plan() {
        calls.push("plan");
        return { kind: "plan", tickets: [ticket("PSD-1"), ticket("PSD-2")] };
      },
      async implement(ref) {
        calls.push(`implement:${ref.key}`);
        return { kind: "needs-input", reason: "which queue does this drain?" };
      },
    });

    const outcome = await runHarness(crew, issue);

    expect(outcome).toEqual({
      kind: "mid-block",
      reason: "which queue does this drain?",
      hasWork: false,
    });
    expect(calls).toEqual(["plan", "implement:PSD-1", "handover:mid-block"]);
  });

  it("reports a block after an implemented ticket as work the handover has to publish", async () => {
    const { crew } = recordingCrew({
      async plan() {
        return { kind: "plan", tickets: [ticket("PSD-1"), ticket("PSD-2")] };
      },
      async implement(ref) {
        return ref.key === "PSD-2"
          ? { kind: "needs-input", reason: "which queue does this drain?" }
          : { kind: "done", base: "c0ffee" };
      },
    });

    const outcome = await runHarness(crew, issue);

    expect(outcome).toEqual({
      kind: "mid-block",
      reason: "which queue does this drain?",
      hasWork: true,
    });
  });

  it("runs end to end on the stub crew", async () => {
    const outcome = await runHarness(createStubCrew(), issue);

    expect(outcome).toEqual({ kind: "success" });
  });
});

describe("exitCodeFor", () => {
  it("maps a reviewable pass to success", () => {
    expect(exitCodeFor({ kind: "success" })).toBe(ExitCode.Success);
  });

  it("maps both blocked outcomes to the blocked code", () => {
    expect(exitCodeFor({ kind: "mid-block", reason: "red", hasWork: true })).toBe(ExitCode.Blocked);
    expect(exitCodeFor({ kind: "early-bail", reason: "thin" })).toBe(ExitCode.Blocked);
  });
});
