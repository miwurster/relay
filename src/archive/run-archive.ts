import { loadConfig } from "../config.js";
import { SelectionError } from "../errors.js";
import { ExitCode } from "../exit-codes.js";
import { parseWorkItem } from "../pass/work-item.js";
import { writeArchive } from "./archive.js";

/**
 * Collect one past pass into a single readable file.
 *
 * The work item is required: an archive is of one pass, and there is no
 * next-one-up to fall back on the way a pass has a frontier. A pass that left no
 * records still gets an archive saying so, because the command's job is to
 * report everything relay has about that item — and having nothing is an answer
 * worth reading beside a pass that recorded plenty.
 */
export async function runArchive(workItem: string | undefined): Promise<ExitCode> {
  if (workItem === undefined) {
    throw new SelectionError("relay archive needs the work item to archive: `relay archive 42`.");
  }

  const repoRoot = process.cwd();
  const { number } = parseWorkItem(workItem);
  // The config carries the branch prefix the transcripts are named after, so an
  // archive of a pass that recorded nothing can still find that pass's logs.
  const config = await loadConfig(repoRoot);
  const path = await writeArchive({ repoRoot, workItem: number, config });
  console.log(`relay: archived #${number} to ${path}`);
  return ExitCode.Success;
}
