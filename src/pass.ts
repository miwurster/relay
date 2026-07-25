import { loadConfig } from "./config.js";
import { ExitCode } from "./exit-codes.js";
import { loadSecrets } from "./secrets.js";

/**
 * Run one pass over a single work item, then hand off to a human.
 *
 * The pass fails fast on an invalid config or an unresolvable secret before
 * any sandbox work starts; deeper tool, auth and docker failures surface
 * lazily where they are first used. Stub: the orchestration crew (planner →
 * implementer → review → fix → quality-gate → handover) lands in later
 * tickets.
 */
export async function runPass(workItem: string | undefined): Promise<ExitCode> {
  const config = await loadConfig(process.cwd());
  await loadSecrets();

  const target = workItem ?? "the next ready work item";
  console.log(`relay: would run a pass over ${target} (gate: ${config.greenGate})`);
  return ExitCode.Success;
}
