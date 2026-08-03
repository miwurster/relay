import { RelayError, RoleError } from "./errors.js";
import { ExitCode } from "./exit-codes.js";

/** A single flagless invocation, resolved from the positional argument. */
export type Command =
  | { kind: "pass"; workItem: string | undefined }
  | { kind: "doctor" }
  | { kind: "init" }
  | { kind: "archive"; workItem: string | undefined };

/** The side-effecting entry points the CLI dispatches to. Injectable for tests. */
export interface CliHandlers {
  runPass(workItem: string | undefined): Promise<ExitCode>;
  runDoctor(): Promise<ExitCode>;
  runInit(): Promise<ExitCode>;
  runArchive(workItem: string | undefined): Promise<ExitCode>;
}

/**
 * Resolve the positional arguments into a command.
 *
 * `doctor` runs the preflight, `init` bootstraps a repo's config, `archive`
 * collects one past pass; any other value names the work item to run a pass
 * over, and no argument means auto-pick the next ready item.
 *
 * `archive` is the one keyword that takes an argument of its own, because there
 * is no such thing as archiving whichever pass happens to be next: the work item
 * names the pass to collect, and a missing one is the handler's to refuse.
 */
export function parseArgs(argv: readonly string[]): Command {
  const [positional, second] = argv;
  if (positional === "doctor") return { kind: "doctor" };
  if (positional === "init") return { kind: "init" };
  if (positional === "archive") return { kind: "archive", workItem: second };
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
      case "archive":
        return await handlers.runArchive(command.workItem);
      case "pass":
        return await handlers.runPass(command.workItem);
    }
  } catch (error) {
    console.error(error instanceof RelayError ? error.message : error);
    return error instanceof RoleError ? ExitCode.Blocked : ExitCode.Error;
  }
}
