import { describe, expect, it } from "vitest";
import {
  type Crew,
  type GateResult,
  type LandResult,
  NO_LANDING,
  type PlanResult,
} from "../../src/crew/contract.js";
import { recordingCrew, resolvedGate, run, ticket } from "./harness-crew.js";

/** A crew whose lander reports `result`, recording its own leg and its re-gate. */
function landingCrew(result: LandResult, overrides: Partial<Crew> = {}) {
  const recorder = recordingCrew(overrides);
  recorder.crew.land = async (regate) => {
    recorder.calls.push("land");
    await regate();
    return result;
  };
  return recorder;
}

const landed: LandResult = { kind: "landed", detail: "agent/1 was rebased onto main" };

/**
 * A lander that reports a landing is what `merge` landing looks like to the
 * harness, so these say what the pass does with one and what it does with the
 * lander of a repo that lands nothing.
 */
describe("runHarness under merge landing", () => {
  it("runs the lander between the gate loop and the handover", async () => {
    const { crew, calls } = landingCrew(landed);

    const outcome = await run(crew);

    // The gate that verified what landed stays the outcome's detail: the lander's
    // own story is handed to the handover beside it, not in place of it.
    expect(outcome).toEqual({ kind: "success", detail: "green" });
    expect(calls).toEqual([
      "resolveGate",
      "plan",
      "implement:1",
      "review:branch",
      "gate",
      "land",
      "gate",
      "handover:success",
    ]);
  });

  it("re-gates nothing when the lander lands nothing", async () => {
    const { crew, calls } = recordingCrew();

    await run(crew);

    expect(calls.filter((call) => call === "gate")).toHaveLength(1);
  });

  it("hands the handover what the lander did, rather than leaving it to infer it", async () => {
    const { crew, land } = landingCrew(landed);

    await run(crew);

    expect(land()).toEqual(landed);
  });

  it("hands the handover a refusal too, so nothing reads a block as a landing", async () => {
    const notLanded: LandResult = { kind: "not-landed", reason: "main would not fast-forward" };
    const { crew, land } = landingCrew(notLanded);

    await run(crew);

    expect(land()).toEqual(notLanded);
  });

  it("hands the handover the no landing a lander that lands nothing reported", async () => {
    const { crew, land } = recordingCrew();

    await run(crew);

    expect(land()).toEqual(NO_LANDING);
  });

  it("hands the handover no landing when a merge pass blocked before its lander ran", async () => {
    const { crew, calls, land } = landingCrew(landed, {
      async greenGate(): Promise<GateResult> {
        calls.push("gate");
        return { green: false, detail: "still red" };
      },
    });

    await run(crew);

    expect(calls).not.toContain("land");
    expect(land()).toEqual(NO_LANDING);
  });

  it("re-gates the lander's result with the resolved gate, on the run after the loop's last", async () => {
    const attempts: number[] = [];
    const { crew } = landingCrew(landed, {
      async greenGate(attempt, gate): Promise<GateResult> {
        attempts.push(attempt);
        expect(gate).toEqual(resolvedGate);
        return { green: true, detail: "green" };
      },
    });

    await run(crew);

    expect(attempts).toEqual([1, 2]);
  });

  it("numbers the re-gate after every attempt the gate loop already spent", async () => {
    const attempts: number[] = [];
    const verdicts: GateResult[] = [
      { green: false, detail: "one test red" },
      { green: true, detail: "green" },
    ];
    const { crew } = landingCrew(landed, {
      async greenGate(attempt): Promise<GateResult> {
        attempts.push(attempt);
        return verdicts.shift() ?? { green: true, detail: "green" };
      },
    });

    await run(crew);

    expect(attempts).toEqual([1, 2, 3]);
  });

  it("mid-blocks with the committed tickets when the base branch was not landed on", async () => {
    const { crew, calls, committed } = landingCrew({
      kind: "not-landed",
      reason: "main would not fast-forward",
    });

    const outcome = await run(crew);

    expect(outcome).toEqual({ kind: "mid-block", reason: "main would not fast-forward" });
    expect(committed()).toEqual([ticket(1)]);
    expect(calls.at(-1)).toBe("handover:mid-block");
  });

  it("mid-blocks on a red re-gate without handing it to the fixer", async () => {
    const verdicts: GateResult[] = [
      { green: true, detail: "green" },
      { green: false, detail: "the cart tests fail once main is in" },
    ];
    const { crew, calls } = landingCrew(
      { kind: "not-landed", reason: "the cart tests fail once main is in" },
      {
        async greenGate(): Promise<GateResult> {
          calls.push("gate");
          return verdicts.shift() ?? { green: true, detail: "green" };
        },
      },
    );

    const outcome = await run(crew);

    expect(outcome).toEqual({ kind: "mid-block", reason: "the cart tests fail once main is in" });
    expect(calls).not.toContain("fix");
  });

  it("runs no lander when the pass never got to green", async () => {
    const { crew, calls } = landingCrew(landed, {
      async greenGate(): Promise<GateResult> {
        calls.push("gate");
        return { green: false, detail: "still red" };
      },
    });

    const outcome = await run(crew);

    expect(outcome).toEqual({ kind: "mid-block", reason: "still red" });
    expect(calls).not.toContain("land");
  });

  it("runs no lander when the planner bailed", async () => {
    const { crew, calls } = landingCrew(landed, {
      async plan(): Promise<PlanResult> {
        return { kind: "under-specified", reason: "no acceptance criteria" };
      },
    });

    await run(crew);

    expect(calls).not.toContain("land");
    expect(calls.at(-1)).toBe("handover:early-bail");
  });
});
