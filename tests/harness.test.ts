import { describe, expect, it } from "vitest";
import type {
  Crew,
  Finding,
  GateResult,
  ImplementResult,
  Outcome,
  PlanResult,
  ReviewLens,
  ReviewScope,
  TicketRef,
} from "../src/crew.js";
import { createStubCrew } from "../src/crew.js";
import { ExitCode } from "../src/exit-codes.js";
import { exitCodeFor, MAX_GATE_FIX_ATTEMPTS, runHarness } from "../src/harness.js";
import type { JiraIssue } from "../src/jira.js";

const issue: JiraIssue = {
  key: "PSD-1",
  issueType: "Story",
  labels: ["ready-for-agent"],
  isDone: false,
  blockedBy: [],
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
    async fix(findings): Promise<void> {
      calls.push("fix");
      fixed.push([...findings]);
    },
    async qualityGate(): Promise<GateResult> {
      calls.push("gate");
      return { green: true, detail: "green" };
    },
    async handover(outcome): Promise<void> {
      calls.push(`handover:${outcome.kind}`);
      handedOver = outcome;
    },
    ...overrides,
  };

  return { crew, calls, fixed, handover: () => handedOver };
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

  it("runs both lenses of a scope concurrently", async () => {
    const started: ReviewLens[] = [];
    let releaseFirst: (() => void) | undefined;
    const first = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const { crew } = recordingCrew({
      async review(lens) {
        started.push(lens);
        // The first lens only finishes once the second one has started, so the
        // pass deadlocks unless the harness runs them concurrently.
        if (started.length === 1) await first;
        else releaseFirst?.();
        return [];
      },
    });

    await runHarness(crew, issue);

    expect(started).toEqual([
      "fastCodeReview",
      "fastSpecReview",
      "inDepthCodeReview",
      "inDepthSpecReview",
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
      async qualityGate() {
        calls.push("gate");
        return verdicts.shift() ?? { green: true, detail: "green" };
      },
    });

    const outcome = await runHarness(crew, issue);

    expect(outcome).toEqual({ kind: "success" });
    expect(calls.filter((call) => call === "gate")).toHaveLength(2);
    expect(fixed.at(-1)).toEqual([finding("qualityGate", "one test red")]);
  });

  it("gives up after two fixer attempts and mid-blocks on a red gate", async () => {
    const { crew, calls } = recordingCrew({
      async qualityGate() {
        calls.push("gate");
        return { green: false, detail: "still red" };
      },
    });

    const outcome = await runHarness(crew, issue);

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

    expect(outcome).toEqual({ kind: "mid-block", reason: "which queue does this drain?" });
    expect(calls).toEqual(["plan", "implement:PSD-1", "handover:mid-block"]);
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
    expect(exitCodeFor({ kind: "mid-block", reason: "red" })).toBe(ExitCode.Blocked);
    expect(exitCodeFor({ kind: "early-bail", reason: "thin" })).toBe(ExitCode.Blocked);
  });
});
