import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * The two `.gitignore` entries relay asks a repo to carry — one for a pass's
 * worktree, one for the credential file — differ in which file they belong to
 * and what they say. How an entry is recognised and how it is appended is the
 * same both times, and lives here.
 */
export interface IgnoreRule {
  /** The `.gitignore` that carries the entry, relative to the repo root. */
  file: string;
  entry: string;
  /** What the comment line above the entry says it is for. */
  why: string;
}

/** Whether the rule's file already carries its entry as a line of its own. */
export async function isIgnored(repoRoot: string, rule: IgnoreRule): Promise<boolean> {
  return carriesEntry(await readIgnoreFile(repoRoot, rule), rule.entry);
}

/**
 * Carry the rule's entry in its file, writing the file when it is missing.
 * Appended, never rewritten: a `.gitignore` may carry entries that are not
 * relay's. Answers whether it had to write.
 */
export async function ensureIgnored(repoRoot: string, rule: IgnoreRule): Promise<boolean> {
  const existing = await readIgnoreFile(repoRoot, rule);
  if (carriesEntry(existing, rule.entry)) return false;

  const path = join(repoRoot, rule.file);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, withEntry(existing, rule), "utf8");
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

function withEntry(gitignore: string, { entry, why }: IgnoreRule): string {
  const added = `# ${why}\n${entry}\n`;
  if (gitignore === "") return added;
  return `${gitignore}${gitignore.endsWith("\n") ? "\n" : "\n\n"}${added}`;
}

function trimSlashes(line: string): string {
  return line.replace(/^\/+|\/+$/g, "");
}
