import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Crew, Finding, ReviewScope } from "../../src/crew/contract.js";
import { RoleError } from "../../src/errors.js";
import { ExitCode } from "../../src/exit-codes.js";
import { exitCodeFor } from "../../src/pass/harness.js";
import {
  finding,
  recordingCrew,
  reviewName,
  run,
  skippedAll,
  twoTicketPlan,
} from "./harness-crew.js";

/**
 * The quality review asks the wider version of the standards question, on a
 * rubric relay vendors rather than authors. It reads the branch once the spec
 * question is settled, its findings are not binding, and nothing verifies its fix
 * ([ADR-0027](../../docs/adr/0027-the-branch-review-splits-into-a-spec-review-and-a-quality-review.md)).
 */
describe("runHarness reviewing the branch's quality", () => {
  const wanted = finding("quality-review", "quality", "the two loaders should be one module");

  /** A crew whose quality scope found `wanted`, and whose branch review found what is given. */
  const crewFinding = (onBranch: Finding[] = []) => {
    const recorded = recordingCrew({
      async review(scope) {
        recorded.calls.push(`review:${reviewName(scope)}`);
        if (scope.kind === "quality") return [wanted];
        if (scope.kind === "branch" && !scope.verifying) return onBranch;
        return [];
      },
    });
    return recorded;
  };

  it("reads the branch after the spec review's fix has been re-reviewed", async () => {
    const { crew, calls } = crewFinding([
      finding("branch-review", "spec", "the cap is read from the wrong key"),
    ]);

    await run(crew);

    expect(calls).toEqual([
      "resolveGate",
      "plan",
      "implement:1",
      "review:branch",
      "fix",
      "review:branch-rereview",
      "review:quality",
      "fix",
      "gate",
      "land",
      "handover:success",
    ]);
  });

  it("hands its findings to a fixer leg of its own", async () => {
    const { crew, fixed, fixTargets } = crewFinding();

    await run(crew);

    expect(fixed).toEqual([[wanted]]);
    expect(fixTargets).toEqual([{ kind: "quality" }]);
  });

  it("calls no fixer when it found nothing", async () => {
    const { crew, calls } = recordingCrew();

    await run(crew);

    expect(calls).toContain("review:quality");
    expect(calls).not.toContain("fix");
  });

  it("verifies its own fix with nothing but the gate", async () => {
    const { crew, calls } = crewFinding();

    await run(crew);

    expect(calls.filter((call) => call === "review:quality")).toHaveLength(1);
    expect(calls.slice(calls.indexOf("review:quality"))).toEqual([
      "review:quality",
      "fix",
      "gate",
      "land",
      "handover:success",
    ]);
  });

  it("lands a pass whose quality findings the fixer declined, and reports them", async () => {
    const { crew, unaddressed } = recordingCrew({
      async review(scope) {
        return scope.kind === "quality" ? [wanted] : [];
      },
      async fix(findings) {
        return skippedAll(findings, "AGENTS.md prefers one file until a second caller exists");
      },
    });

    const outcome = await run(crew);

    expect(outcome).toEqual({ kind: "success", detail: "green" });
    expect(unaddressed()).toEqual([
      {
        finding: wanted,
        reason: "AGENTS.md prefers one file until a second caller exists",
      },
    ]);
  });

  /**
   * ADR-0034: the last review of the pass is told what the earlier ones settled,
   * so it cannot order the reversal of a landed fix without knowing it is doing
   * so. A multi-ticket plan, because that is the only shape where a ticket
   * review runs at all — and so the only one where both sources can contribute.
   */
  describe("the settled findings it is handed", () => {
    const onTicket = finding("ticket-review", "standards", "extract the shared trim helper", 1);
    const onBranch = finding("branch-review", "spec", "the cap is read from the wrong key");

    /** The scope the quality review was called with, over a two-ticket plan. */
    const qualityScopeOf = async (
      findings: (scope: ReviewScope) => Finding[],
      fix?: Crew["fix"],
    ) => {
      let scoped: ReviewScope | undefined;
      const { crew } = recordingCrew({
        ...twoTicketPlan,
        async review(scope) {
          if (scope.kind === "quality") scoped = scope;
          return findings(scope);
        },
        ...(fix ? { fix } : {}),
      });
      await run(crew);
      return scoped;
    };

    it("carries what a fixer fixed at ticket scope and at branch scope alike", async () => {
      const scope = await qualityScopeOf((s) => {
        if (s.kind === "ticket" && s.ticket.number === 1) return [onTicket];
        if (s.kind === "branch" && !s.verifying) return [onBranch];
        return [];
      });

      expect(scope).toEqual({ kind: "quality", workItem: 1, settled: [onTicket, onBranch] });
    });

    it("carries an empty list when the pass fixed nothing, rather than nothing at all", async () => {
      const scope = await qualityScopeOf(() => []);

      expect(scope).toEqual({ kind: "quality", workItem: 1, settled: [] });
    });

    it("leaves out what a fixer declined, since no code changed for it", async () => {
      const declined = finding("ticket-review", "standards", "inline the second loader", 1);
      const scope = await qualityScopeOf(
        (s) => (s.kind === "ticket" && s.ticket.number === 1 ? [onTicket, declined] : []),
        async (findings) => ({
          fixed: findings.filter((f) => f !== declined),
          skipped: [
            { finding: declined, reason: "AGENTS.md prefers one file until a second call" },
          ],
        }),
      );

      expect(scope).toEqual({ kind: "quality", workItem: 1, settled: [onTicket] });
    });
  });

  /**
   * The stage cannot stop a pass by any means — not by a finding, which it cannot
   * raise bindingly, and not by a leg that fails to answer
   * ([ADR-0036](../../docs/adr/0036-a-leg-that-fails-to-answer-blocks-the-pass-and-never-on-quality.md)).
   */
  describe("a leg of it that fails to answer", () => {
    const slip = new RoleError("the quality fixer emitted no <relay-fix> block");

    /** A crew whose quality review throws what it is given, and whose others are clean. */
    const reviewThatFailsToAnswer = (error: Error): Partial<Crew> => ({
      async review(scope) {
        if (scope.kind === "quality") throw error;
        return [];
      },
    });

    beforeEach(() => {
      vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("leaves the pass running to the gate when it is the reviewer, with nothing unaddressed", async () => {
      const { crew, calls, unaddressed } = recordingCrew({
        async review(scope) {
          calls.push(`review:${reviewName(scope)}`);
          if (scope.kind === "quality") throw slip;
          return [];
        },
      });

      const outcome = await run(crew);

      expect(outcome).toEqual({ kind: "success", detail: "green" });
      expect(calls.slice(calls.indexOf("review:quality"))).toEqual([
        "review:quality",
        "gate",
        "land",
        "handover:success",
      ]);
      expect(unaddressed()).toEqual([]);
    });

    it("leaves every finding it was handed unaddressed when it is the fixer", async () => {
      const { crew, calls, unaddressed } = recordingCrew({
        async review(scope) {
          calls.push(`review:${reviewName(scope)}`);
          return scope.kind === "quality" ? [wanted] : [];
        },
        async fix() {
          calls.push("fix");
          throw slip;
        },
      });

      const outcome = await run(crew);

      expect(outcome).toEqual({ kind: "success", detail: "green" });
      expect(calls.slice(calls.indexOf("review:quality"))).toEqual([
        "review:quality",
        "fix",
        "gate",
        "land",
        "handover:success",
      ]);
      expect(unaddressed()).toEqual([
        {
          finding: wanted,
          reason: "the quality fixer failed to answer, so nothing it was handed was decided",
        },
      ]);
    });

    it("lands the pass and exits zero when the gate is green after the degrade", async () => {
      const { crew, land } = recordingCrew({
        ...reviewThatFailsToAnswer(slip),
        async land() {
          return { kind: "landed", detail: "fast-forwarded main onto the pass branch" };
        },
      });

      const outcome = await run(crew);

      expect(exitCodeFor(outcome)).toBe(ExitCode.Success);
      expect(land()).toEqual({
        kind: "landed",
        detail: "fast-forwarded main onto the pass branch",
      });
    });

    it("names it on the console, since the handover cannot tell it from a clean review", async () => {
      const { crew } = recordingCrew(reviewThatFailsToAnswer(slip));

      await run(crew);

      expect(console.error).toHaveBeenCalledWith(expect.stringContaining(slip.message));
    });

    it("lets a leg that died for any other reason through as the crash it is", async () => {
      const { crew } = recordingCrew(reviewThatFailsToAnswer(new Error("the sandbox died")));

      await expect(run(crew)).rejects.toThrow("the sandbox died");
    });
  });

  it("never runs when the branch review's own findings blocked the pass", async () => {
    const { crew, calls } = recordingCrew({
      async review(scope) {
        calls.push(`review:${reviewName(scope)}`);
        return scope.kind === "branch" && !scope.verifying
          ? [finding("branch-review", "spec", "the retry cap is still hardcoded")]
          : [];
      },
      async fix(findings) {
        return skippedAll(findings, "the cap was never asked to move");
      },
    });

    const outcome = await run(crew);

    expect(outcome.kind).toBe("mid-block");
    expect(calls).not.toContain("review:quality");
  });
});
