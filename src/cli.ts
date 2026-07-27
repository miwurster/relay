import { RelayError } from "./errors.js";
import { ExitCode } from "./exit-codes.js";

/** A single flagless invocation, resolved from the positional argument. */
export type Command = { kind: "pass"; workItem: string | undefined } | { kind: "doctor" };

/** The side-effecting entry points the CLI dispatches to. Injectable for tests. */
export interface CliHandlers {
  runPass(workItem: string | undefined): Promise<ExitCode>;
  runDoctor(): Promise<ExitCode>;
}

/**
 * Resolve the single positional argument into a command.
 *
 * `doctor` runs the preflight; any other value names the work item to run a pass
 * over; no argument means auto-pick the next ready item.
 */
export function parseArgs(argv: readonly string[]): Command {
  const [positional] = argv;
  if (positional === "doctor") return { kind: "doctor" };
  return { kind: "pass", workItem: positional };
}

/**
 * Dispatch the CLI and return the exit code to hand to the process.
 *
 * Any unexpected throw collapses to the error exit code so the contract holds
 * end to end even when a handler crashes.
 */
export async function runCli(argv: readonly string[], handlers: CliHandlers): Promise<ExitCode> {
  const command = parseArgs(argv);
  try {
    switch (command.kind) {
      case "doctor":
        return await handlers.runDoctor();
      case "pass":
        return await handlers.runPass(command.workItem);
    }
  } catch (error) {
    console.error(error instanceof RelayError ? error.message : error);
    return ExitCode.Error;
  }
}
