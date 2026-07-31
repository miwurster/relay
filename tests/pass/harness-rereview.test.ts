import { describe, expect, it } from "vitest";
import { finding, recordingCrew, reviewName, run, skippedAll } from "./harness-crew.js";

/**
 * The branch review is the only review that reads a fixer's commit, and the gate
 * that runs after it is objective. So a fix that addressed the wrong half of what
 * the item asked would land green — which is what the one re-review is for.
 */
describe("runHarness re-reviewing a fix", () => {
  const wanted = finding("branchReview", "spec", "the cap is read from the wrong key");

  it("re-reads the branch once after a fix that changed something", async () => {
    const { crew, calls } = recordingCrew({
      async review(scope) {
        calls.push(`review:${reviewName(scope)}`);
        return scope.kind === "branch" && !scope.rereview ? [wanted] : [];
      },
    });

    await run(crew);

    expect(calls).toEqual([
      "resolveGate",
      "plan",
      "implement:1",
      "review:branch",
      "fix",
      "review:branch-rereview",
      "review:quality",
      "gate",
      "land",
      "handover:success",
    ]);
  });

  it("re-reads nothing when the branch review found nothing to fix", async () => {
    const { crew, calls } = recordingCrew();

    await run(crew);

    expect(calls).not.toContain("review:branch-rereview");
  });

  it("blocks on a spec finding the re-review raised, and hands it to no fixer", async () => {
    const raised = finding("branchReview", "spec", "the fix reads the cap from the wrong key");
    const { crew, calls } = recordingCrew({
      async review(scope) {
        calls.push(`review:${reviewName(scope)}`);
        if (scope.kind !== "branch") return [];
        return scope.rereview ? [raised] : [wanted];
      },
    });

    const outcome = await run(crew);

    expect(outcome.kind).toBe("mid-block");
    expect(outcome).toMatchObject({
      reason: expect.stringContaining("the fix reads the cap from the wrong key") as unknown,
    });
    // Exactly one fixer leg ran: the re-review's findings reach nobody.
    expect(calls.filter((call) => call === "fix")).toHaveLength(1);
    expect(calls).not.toContain("gate");
  });

  it("lands a pass whose re-review raised only standards findings, and reports them", async () => {
    const raised = finding("branchReview", "standards", "the fix duplicates parseKey");
    const { crew, calls, unaddressed } = recordingCrew({
      async review(scope) {
        calls.push(`review:${reviewName(scope)}`);
        if (scope.kind !== "branch") return [];
        return scope.rereview ? [raised] : [wanted];
      },
    });

    const outcome = await run(crew);

    expect(outcome).toEqual({ kind: "success", detail: "green" });
    expect(unaddressed()).toEqual([
      {
        finding: raised,
        reason:
          "the re-review raised it over the fixer's own commit, " +
          "and a re-review's findings reach no fixer",
      },
    ]);
  });

  it("re-reads nothing when the fixer declined everything it was handed", async () => {
    const { crew, calls } = recordingCrew({
      async review(scope) {
        calls.push(`review:${reviewName(scope)}`);
        return scope.kind === "branch" && !scope.rereview
          ? [finding("branchReview", "standards", "split the loader")]
          : [];
      },
      async fix(findings) {
        return skippedAll(findings, "one caller only");
      },
    });

    await run(crew);

    expect(calls).not.toContain("review:branch-rereview");
  });
});
