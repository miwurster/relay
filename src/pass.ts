import { ExitCode } from "./exit-codes.js";

/**
 * Run one pass over a single work item, then hand off to a human.
 *
 * Stub: the orchestration crew (planner → implementer → review → fix →
 * quality-gate → handover) lands in later tickets. For now it only proves the
 * dispatch and exit-code contract.
 */
export async function runPass(workItem: string | undefined): Promise<ExitCode> {
  if (workItem) {
    console.log(`relay: would run a pass over ${workItem}`);
  } else {
    console.log("relay: would auto-pick the next ready work item and run a pass");
  }
  return ExitCode.Success;
}
