import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** What one leg left behind for a human to read after the pass is over. */
interface RoleStatus {
  role: string;
  model: string;
  /** The tagged answer the leg ended its run with, as relay parsed it. */
  answer: unknown;
}

/**
 * Write one role's status to the pass's output dir, a file per run.
 *
 * Together with the findings files these are the hand-off: the sandbox's
 * worktree is thrown away once the pass ends and stdout scrolls past, so a
 * leg's answer is only inspectable if it lands on the host.
 */
export async function writeStatusFile({ dir, status }: { dir: string; status: RoleStatus }): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${status.role}.status.json`), `${JSON.stringify(status, undefined, 2)}\n`, "utf8");
}
