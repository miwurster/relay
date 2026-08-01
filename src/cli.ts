import { RelayError, RoleError } from "./errors.js";
import { ExitCode } from "./exit-codes.js";

/** A single flagless invocation, resolved from the positional argument. */
export type Command =
  { kind: "pass"; workItem: string | undefined } | { kind: "doctor" } | { kind: "init" };

/** The side-effecting entry points the CLI dispatches to. Injectable for tests. */
export interface CliHandlers {
  runPass(workItem: string | undefined): Promise<ExitCode>;
  runDoctor(): Promise<ExitCode>;
  runInit(): Promise<ExitCode>;
}

/**
 * Resolve the single positional argument into a command.
 *
 * `doctor` runs the preflight, `init` bootstraps a repo's config; any other
 * value names the work item to run a pass over; no argument means auto-pick
 * the next ready item.
 */
export function parseArgs(argv: readonly string[]): Command {
  const [positional] = argv;
  if (positional === "doctor") return { kind: "doctor" };
  if (positional === "init") return { kind: "init" };
  return { kind: "pass", workItem: positional };
}

/**
 * Dispatch the CLI and return the exit code to hand to the process.
 *
 * Any unexpected throw collapses to the error exit code so the contract holds
 * end to end even when a handler crashes — except a role that misbehaved, which
 * is the pass being blocked rather than relay's config, auth or infra failing,
 * and which a caller must be able to tell apart from a setup it has to repair.
 */
export async function runCli(argv: readonly string[], handlers: CliHandlers): Promise<ExitCode> {
  const command = parseArgs(argv);
  try {
    switch (command.kind) {
      case "doctor":
        return await handlers.runDoctor();
      case "init":
        return await handlers.runInit();
      case "pass":
        return await handlers.runPass(command.workItem);
    }
  } catch (error) {
    console.error(error instanceof RelayError ? error.message : error);
    return error instanceof RoleError ? ExitCode.Blocked : ExitCode.Error;
  }
}
