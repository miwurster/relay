import { join } from "node:path";
import { CREDENTIAL_FILE_PATH, RELAY_GITIGNORE_PATH } from "../config.js";
import { runGit, type GitRunner } from "./git.js";
import type { IgnoreRule } from "./gitignore.js";

/**
 * The credential file belongs in relay's own `.gitignore`, and reads there as
 * a bare `.env`, since that file sits in the directory the entry governs.
 */
export const CREDENTIAL_RULE: IgnoreRule = {
  file: RELAY_GITIGNORE_PATH,
  entries: [".env"],
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
