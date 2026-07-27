import { access } from "node:fs/promises";
import { join } from "node:path";
import { ConfigError } from "./errors.js";

/** The agent-facing tracker doc a target repo commits, relative to its root. */
export const TRACKER_DOC_PATH = "docs/agents/issue-tracker.md";

/**
 * Fail the pass unless the repo commits its tracker doc.
 *
 * The doc carries no setup constants — `gh` infers the repo from the clone's
 * remote — but every tracker-facing role is told to read it first, so a missing
 * one is worth failing on here rather than mid-pass inside the sandbox.
 */
export async function requireTrackerDoc(repoRoot: string): Promise<void> {
  const path = join(repoRoot, TRACKER_DOC_PATH);
  try {
    await access(path);
  } catch {
    throw new ConfigError(`No ${TRACKER_DOC_PATH} found at ${path}`);
  }
}
