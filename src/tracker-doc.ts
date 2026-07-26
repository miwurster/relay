import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ConfigError } from "./errors.js";
import { requireAll } from "./required.js";

/** The agent-facing tracker doc a target repo commits, relative to its root. */
export const TRACKER_DOC_PATH = "docs/agents/issue-tracker.md";

/**
 * What scopes work items to this repo. Selection is explicit — it comes from
 * the committed tracker doc, never from the git remote.
 */
export interface TrackerScope {
  projectKey: string;
  repoLabel: string;
}

/**
 * Read the repo's tracker scope from `docs/agents/issue-tracker.md`.
 *
 * The doc is prose for agents; its `## Setup constants` bullets are the one
 * machine-readable part, each a bold label and a backticked value.
 */
export async function loadTrackerScope(repoRoot: string): Promise<TrackerScope> {
  const path = join(repoRoot, TRACKER_DOC_PATH);
  const doc = await read(path);

  return requireAll(
    {
      projectKey: setupConstant(doc, "Jira project key"),
      repoLabel: setupConstant(doc, "Repo label"),
    },
    { projectKey: "Jira project key", repoLabel: "Repo label" },
    (missing) => `${path} is missing its setup constant(s): ${missing.join(", ")}. ` + "Each must be a bullet with the value in backticks.",
  );
}

async function read(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    throw new ConfigError(`No ${TRACKER_DOC_PATH} found at ${path}`);
  }
}

function setupConstant(doc: string, label: string): string | undefined {
  const bullet = new RegExp(`^- \\*\\*${label}:\\*\\* *\`([^\`]+)\``, "im");
  return bullet.exec(doc)?.[1];
}
