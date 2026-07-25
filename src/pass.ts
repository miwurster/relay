import { loadConfig } from "./config.js";
import { ExitCode } from "./exit-codes.js";
import { createJiraClient } from "./jira.js";
import { loadSecrets } from "./secrets.js";
import { loadTrackerScope } from "./tracker-doc.js";
import { selectWorkItem } from "./work-item.js";

/**
 * Run one pass over a single work item, then hand off to a human.
 *
 * The pass fails fast on an invalid config or an unresolvable secret before
 * any sandbox work starts; deeper tool, auth and docker failures surface
 * lazily where they are first used. Stub: the orchestration crew (planner →
 * implementer → review → fix → quality-gate → handover) lands in later
 * tickets, so for now the pass stops once the one work item is resolved.
 */
export async function runPass(workItem: string | undefined): Promise<ExitCode> {
  const repoRoot = process.cwd();
  const config = await loadConfig(repoRoot);
  const secrets = await loadSecrets();
  const scope = await loadTrackerScope(repoRoot);

  const client = createJiraClient({
    baseUrl: config.jira.baseUrl,
    email: secrets.atlassian.email,
    token: secrets.atlassian.token,
  });

  const selection = await selectWorkItem(client, scope, workItem);
  if (selection.kind === "nothing-to-do") {
    console.log(`relay: nothing to do — no ready work item for ${scope.repoLabel}`);
    return ExitCode.Success;
  }

  console.log(`relay: would run a pass over ${selection.issue.key} (gate: ${config.greenGate})`);
  return ExitCode.Success;
}
