import { describe, expect, it } from "vitest";
import type { Finding, ReviewScope } from "../../src/crew/contract.js";
import { finding, recordingCrew, reviewName, run, skippedAll, ticket } from "./harness-crew.js";

/** A crew whose reviews report what `findingsFor` says, and whose fixer declines all of it. */
function decliningCrew(findingsFor: (scope: ReviewScope) => Finding[]) {
  const recorder = recordingCrew();
  recorder.crew.plan = async () => {
    recorder.calls.push("plan");
    return { kind: "plan", tickets: [ticket(1), ticket(2)] };
  };
  recorder.crew.review = async (scope) => {
    recorder.calls.push(`review:${reviewName(scope)}`);
    return findingsFor(scope);
  };
  recorder.crew.fix = async (findings) => {
    recorder.calls.push("fix");
    return skippedAll(findings, "I read it as fine");
  };
  return recorder;
}

const specOnTicketOne = (scope: ReviewScope): Finding[] =>
  scope.kind === "ticket" && scope.ticket.number === 1
    ? [finding("ticketReview", "spec", "#1 asks for a configurable cap; this hardcodes 3", 1)]
    : [];

/**
 * A spec finding says the branch does not do what the item asked, so a pass that
 * landed one nobody fixed would be relay's worst failure. These say that the
 * fixer may decline it, and that declining it stops the pass.
 */
describe("runHarness on a binding finding nobody addressed", () => {
  it("stops the pass at the ticket the finding was declined on", async () => {
    const { crew, calls } = decliningCrew(specOnTicketOne);

    const outcome = await run(crew);

    expect(outcome.kind).toBe("mid-block");
    expect(calls).toEqual([
      "resolveGate",
      "plan",
      "implement:1",
      "review:1",
      "fix",
      "handover:mid-block",
    ]);
  });

  it("says what was left unbuilt and why, in the reason the human reads", async () => {
    const { crew } = decliningCrew(specOnTicketOne);

    const outcome = await run(crew);

    expect(outcome).toEqual({
      kind: "mid-block",
      reason:
        "the branch does not do what the item asked, and nobody addressed it: " +
        "#1 asks for a configurable cap; this hardcodes 3 — I read it as fine",
    });
  });

  it("hands over the tickets already committed, and never reaches the gate or the lander", async () => {
    const { crew, calls, committed } = decliningCrew(specOnTicketOne);

    await run(crew);

    expect(committed()).toEqual([ticket(1)]);
    expect(calls).not.toContain("gate");
    expect(calls).not.toContain("land");
  });

  it("reports the declined finding to the handover as well as blocking on it", async () => {
    const { crew, unaddressed } = decliningCrew(specOnTicketOne);

    await run(crew);

    expect(unaddressed()).toEqual([
      {
        finding: finding(
          "ticketReview",
          "spec",
          "#1 asks for a configurable cap; this hardcodes 3",
          1,
        ),
        reason: "I read it as fine",
      },
    ]);
  });

  it("leaves the ticket it blocked on out of the finished tickets, but not the committed ones", async () => {
    const { crew, committed, finished } = decliningCrew(specOnTicketOne);

    await run(crew);

    expect(committed()).toEqual([ticket(1)]);
    expect(finished()).toEqual([]);
  });

  it("finishes a ticket carrying only an unaddressed standards finding", async () => {
    const { crew, finished } = decliningCrew((scope) =>
      scope.kind === "ticket" && scope.ticket.number === 1
        ? [finding("ticketReview", "standards", "split the loader", 1)]
        : [],
    );

    await run(crew);

    expect(finished()).toEqual([ticket(1), ticket(2)]);
  });

  it("finishes a ticket carrying only an unaddressed quality finding", async () => {
    const { crew, finished } = decliningCrew((scope) =>
      scope.kind === "quality" ? [finding("qualityReview", "quality", "extract the cap", 1)] : [],
    );

    await run(crew);

    expect(finished()).toEqual([ticket(1), ticket(2)]);
  });

  it("lands a pass whose fixer declined only standards findings", async () => {
    const { crew, calls } = decliningCrew((scope) =>
      scope.kind === "ticket" && scope.ticket.number === 1
        ? [finding("ticketReview", "standards", "split the loader", 1)]
        : [],
    );

    const outcome = await run(crew);

    expect(outcome).toEqual({ kind: "success", detail: "green" });
    expect(calls.at(-1)).toBe("handover:success");
  });

  it("stops on a declined spec finding at branch scope too", async () => {
    const { crew, calls } = decliningCrew((scope) =>
      scope.kind === "branch" && !scope.rereview
        ? [finding("branchReview", "spec", "#1 asks for the cap to be read from config")]
        : [],
    );

    const outcome = await run(crew);

    expect(outcome.kind).toBe("mid-block");
    expect(calls).not.toContain("gate");
    // Nothing was fixed, so there is nothing new for a re-review to read.
    expect(calls).not.toContain("review:branch-rereview");
  });
});
