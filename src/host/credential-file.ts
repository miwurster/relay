import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CREDENTIAL_FILE_PATH, RELAY_GITIGNORE_PATH } from "../config.js";
import { runGit, type GitRunner } from "./git.js";
import { carriesEntry, withEntry } from "./gitignore.js";

/**
 * The credential file's entry, as it reads in relay's own `.gitignore` — a
 * bare `.env`, since that file sits in the directory the entry governs.
 */
const CREDENTIAL_ENTRY = {
  entry: ".env",
  why: "The credentials a relay pass runs on. Never commit this.",
};

/**
 * The target repo's credential file, which is the only file relay reads a
 * secret from. Gitignored and never committed, so no secret ships in the
 * package or lands in the repo's history
 * ([ADR-0014](../../docs/adr/0014-credentials-live-in-the-target-repo-gitignored.md)).
 */
export function credentialFilePath(repoRoot: string): string {
  return join(repoRoot, CREDENTIAL_FILE_PATH);
}

/** Relay's own `.gitignore`, or empty when its directory has none. */
export async function readRelayGitignore(repoRoot: string): Promise<string> {
  const path = join(repoRoot, RELAY_GITIGNORE_PATH);
  return existsSync(path) ? readFile(path, "utf8") : "";
}

/** Whether these `.gitignore` contents already carry the credential file entry. */
export function ignoresCredentialFile(gitignore: string): boolean {
  return carriesEntry(gitignore, CREDENTIAL_ENTRY.entry);
}

/**
 * The same contents with the credential file ignored — appended, since a repo
 * may keep entries of its own in relay's directory.
 */
export function withCredentialFileIgnored(gitignore: string): string {
  return withEntry(gitignore, CREDENTIAL_ENTRY);
}

/**
 * Whether git itself ignores the credential file — asked of git rather than
 * matched against text, because the entry may come from relay's `.gitignore`,
 * the repo's own, a negation, or the operator's global excludes file.
 *
 * A non-zero exit is git's answer for "not ignored", and it is also what a
 * directory that is no git repo returns. Both are false here: relay cannot
 * report the credential file as safe either way. A `.relay/.env` that is
 * already tracked answers false too, since ignore rules do not apply to
 * tracked paths — which is the case that actually leaks.
 */
export async function credentialFileIgnored({
  repoRoot,
  git = runGit,
}: {
  repoRoot: string;
  git?: GitRunner;
}): Promise<boolean> {
  try {
    await git(["-C", repoRoot, "check-ignore", "-q", CREDENTIAL_FILE_PATH]);
    return true;
  } catch {
    return false;
  }
}
