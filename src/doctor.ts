import { ExitCode } from "./exit-codes.js";

/**
 * Run the opt-in preflight check (config, secrets, environment, docker socket).
 *
 * Stub: the real checks land in the doctor ticket. For now it only proves the
 * dispatch and exit-code contract.
 */
export async function runDoctor(): Promise<ExitCode> {
  console.log("relay doctor: would validate config, secrets, and environment");
  return ExitCode.Success;
}
