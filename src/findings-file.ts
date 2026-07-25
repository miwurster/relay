import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Finding } from "./crew.js";

/** The directory one pass writes its role artefacts to, on the host. */
export function passOutputDir(repoRoot: string, workItemKey: string): string {
  return join(repoRoot, ".relay", workItemKey);
}

/**
 * Write one lens's findings to its own file in the pass's output dir.
 *
 * A file per lens, never a shared one: the lenses of a scope run concurrently,
 * and merging what they return is the harness's job. The files are what makes
 * the hand-off inspectable, so they live on the host rather than in the
 * sandbox's worktree — that worktree is gone once the pass disposes of it.
 */
export async function writeFindingsFile({
  dir,
  name,
  findings,
}: {
  dir: string;
  name: string;
  findings: readonly Finding[];
}): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${name}.json`), `${JSON.stringify(findings, undefined, 2)}\n`, "utf8");
}
