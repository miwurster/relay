import { describe, expect, it } from "vitest";
import type { Finding } from "../../src/crew/contract.js";
import { finding, recordingCrew, reviewName, run, skippedAll } from "./harness-crew.js";

/**
 * The branch review is the only review that reads a fixer's commit, and the gate
 * that runs after it is objective. So a fix that addressed the wrong half of what
 * the item asked would land green — which is what the one re-review is for.
 */
describe("runHarness re-reviewing a fix", () => {
  const wanted = finding("branch-review", "spec", "the cap is read from the wrong key");

  /**
   * What the re-review is asked about is the fixer's claims, not the branch
   * ([ADR-0032](../../docs/adr/0032-the-re-review-verifies-the-fix-it-was-handed.md)).
   * A run handed anything else would be free to raise findings about the fixer's
   * own new code, which reach nobody and so can only stop the pass.
   */
  it("hands the re-review exactly the findings the fixer said it fixed", async () => {
    const declined = finding("branch-review", "standards", "split the loader");
    const verifying: (readonly Finding[] | undefined)[] = [];
    const { crew } = recordingCrew({
      async review(scope) {
        if (scope.kind === "branch") verifying.push(scope.verifying);
        return scope.kind === "branch" && !scope.verifying ? [wanted, declined] : [];
      },
      async fix(findings) {
        return {
          fixed: findings.filter((one) => one === wanted),
          skipped: [{ finding: declined, reason: "one caller only" }],
        };
      },
    });

    await run(crew);

    expect(verifying).toEqual([undefined, [wanted]]);
  });

  it("re-reads the branch once after a fix that changed something", async () => {
    const { crew, calls } = recordingCrew({
      async review(scope) {
        calls.push(`review:${reviewName(scope)}`);
        return scope.kind === "branch" && !scope.verifying ? [wanted] : [];
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
    const raised = finding("branch-review", "spec", "the fix reads the cap from the wrong key");
    const { crew, calls } = recordingCrew({
      async review(scope) {
        calls.push(`review:${reviewName(scope)}`);
        if (scope.kind !== "branch") return [];
        return scope.verifying ? [raised] : [wanted];
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
    const raised = finding("branch-review", "standards", "the fix duplicates parseKey");
    const { crew, calls, unaddressed } = recordingCrew({
      async review(scope) {
        calls.push(`review:${reviewName(scope)}`);
        if (scope.kind !== "branch") return [];
        return scope.verifying ? [raised] : [wanted];
      },
    });

    const outcome = await run(crew);

    expect(outcome).toEqual({ kind: "success", detail: "green" });
    expect(unaddressed()).toEqual([
      {
        finding: raised,
        reason:
          "the re-review found the fixer's commit does not address it, " +
          "and a re-review's findings reach no fixer",
      },
    ]);
  });

  it("re-reads nothing when the fixer declined everything it was handed", async () => {
    const { crew, calls } = recordingCrew({
      async review(scope) {
        calls.push(`review:${reviewName(scope)}`);
        return scope.kind === "branch" && !scope.verifying
          ? [finding("branch-review", "standards", "split the loader")]
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
