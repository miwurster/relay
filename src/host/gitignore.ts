/**
 * The two `.gitignore` entries relay asks a repo to carry — one for a pass's
 * worktree, one for the credential file — differ in which file they belong to
 * and what they say. How an entry is recognised and how it is appended is the
 * same both times, and lives here.
 */

/** Whether these contents already carry `entry` as a line of their own. */
export function carriesEntry(gitignore: string, entry: string): boolean {
  const wanted = trimSlashes(entry);
  return gitignore.split("\n").some((line) => trimSlashes(line.trim()) === wanted);
}

/**
 * The same contents with `entry` appended under `why`. Appended, never
 * rewritten: a `.gitignore` may carry entries that are not relay's.
 */
export function withEntry(
  gitignore: string,
  { entry, why }: { entry: string; why: string },
): string {
  const added = `# ${why}\n${entry}\n`;
  if (gitignore === "") return added;
  return `${gitignore}${gitignore.endsWith("\n") ? "\n" : "\n\n"}${added}`;
}

function trimSlashes(line: string): string {
  return line.replace(/^\/+|\/+$/g, "");
}
