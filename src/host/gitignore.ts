import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * The `.gitignore` entries relay asks a repo to carry — a pass's worktree, the
 * credential file, what a leg recorded — differ in which file they belong to
 * and what they say. How an entry is recognised and how it is appended is the
 * same every time, and lives here.
 *
 * A rule carries every entry that shares one reason, so the comment above them
 * is written once and says the one thing that is true of all of them.
 */
export interface IgnoreRule {
  /** The `.gitignore` that carries the entries, relative to the repo root. */
  file: string;
  entries: readonly string[];
  /** What the comment line above the entries says they are for. */
  why: string;
}

/** Whether the rule's file already carries every entry as a line of its own. */
export async function isIgnored(repoRoot: string, rule: IgnoreRule): Promise<boolean> {
  const gitignore = await readIgnoreFile(repoRoot, rule);
  return rule.entries.every((entry) => carriesEntry(gitignore, entry));
}

/**
 * Carry the rule's entries in its file, writing the file when it is missing.
 * Appended, never rewritten: a `.gitignore` may carry entries that are not
 * relay's, and the ones it already carries are left where they are. Answers
 * whether it had to write.
 */
export async function ensureIgnored(repoRoot: string, rule: IgnoreRule): Promise<boolean> {
  const existing = await readIgnoreFile(repoRoot, rule);
  const missing = rule.entries.filter((entry) => !carriesEntry(existing, entry));
  if (missing.length === 0) return false;

  const path = join(repoRoot, rule.file);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, withEntries({ gitignore: existing, why: rule.why, missing }), "utf8");
  return true;
}

/** The rule's `.gitignore`, or empty when the repo has none. */
async function readIgnoreFile(repoRoot: string, rule: IgnoreRule): Promise<string> {
  const path = join(repoRoot, rule.file);
  return existsSync(path) ? readFile(path, "utf8") : "";
}

function carriesEntry(gitignore: string, entry: string): boolean {
  const wanted = trimSlashes(entry);
  return gitignore.split("\n").some((line) => trimSlashes(line.trim()) === wanted);
}

function withEntries({
  gitignore,
  why,
  missing,
}: {
  gitignore: string;
  why: string;
  missing: readonly string[];
}): string {
  const added = `# ${why}\n${missing.join("\n")}\n`;
  if (gitignore === "") return added;
  return `${gitignore}${gitignore.endsWith("\n") ? "\n" : "\n\n"}${added}`;
}

function trimSlashes(line: string): string {
  return line.replace(/^\/+|\/+$/g, "");
}
