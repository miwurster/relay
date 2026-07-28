import type { Sandbox } from "@ai-hero/sandcastle";
import type { z } from "zod";
import type { RelayConfig } from "../config.js";
import { RoleError } from "../errors.js";
import { resourcePath } from "../resources.js";
import { roleAgent } from "./role-agent.js";
import { writeStatusFile } from "./leg-record.js";
import { readTaggedOutput } from "./tagged-output.js";

/**
 * What a leg must have left on the branch, given the answer it gave.
 *
 * `read-only` is the reviewers' rule and `must-commit` is the builders'; a leg
 * that reported it did nothing leaves `any`, since there is nothing to commit.
 * `no-commits` is for a leg that changes nothing but cannot be held to a clean
 * worktree either — because the repo's build dirtied it while the leg judged,
 * or because the leg ran before anything could have dirtied it — so only a
 * commit is worth failing on.
 */
export type BranchRule = "read-only" | "no-commits" | "must-commit" | "any";

/**
 * What every role of the crew is built from: the pass's sandbox, its config, and
 * where its legs' output lands.
 *
 * The same three facts for every role, so they are named once here and bound
 * once per pass rather than restated by each role module.
 */
export interface RoleDeps {
  sandbox: Sandbox;
  config: RelayConfig;
  /** Where on the host the pass's legs write their status and findings files. */
  recordDir: string;
}

export interface RunRoleOptions<Schema extends z.ZodType> extends RoleDeps {
  /** Names the run, its log file, and the role in every error it raises. */
  name: string;
  model: string;
  /** The prompt resource this role runs from. */
  prompt: string;
  promptArgs: Record<string, string>;
  /** The block the role ends its run with, and the shape that block must hold. */
  tag: string;
  schema: Schema;
  /** What the branch must look like afterwards. Unchecked when omitted. */
  branchRule?: (answer: z.infer<Schema>) => BranchRule;
}

/**
 * Run one role as a cold agent session and read the answer it ended with.
 *
 * Every role of the crew is the same leg — one prompt, one model, one timeout,
 * one tagged block back, and one rule about what it may leave on the branch —
 * so all a role module owns is its schema, its arguments, and what it makes of
 * the answer.
 */
export async function runRole<Schema extends z.ZodType>({
  sandbox,
  config,
  name,
  model,
  recordDir,
  prompt,
  promptArgs,
  tag,
  schema,
  branchRule,
}: RunRoleOptions<Schema>): Promise<z.infer<Schema>> {
  const { stdout, commits } = await sandbox.run({
    name,
    agent: roleAgent(model),
    // Every role is one shot. Sandcastle defaults to this, but a role that
    // silently gained a second iteration would re-read a branch it had just
    // changed, so relay states it rather than inheriting it.
    maxIterations: 1,
    // The prompt as a host-side file, never as text: substituting `{{KEY}}` is
    // something sandcastle only does for a prompt file, and the arguments every
    // role's prompt is written around are the whole point. Nothing is copied
    // anywhere — sandcastle reads it on the host, where relay's resources
    // already live in both the source tree and the published package.
    promptFile: resourcePath(prompt),
    promptArgs,
    signal: AbortSignal.timeout(config.roleTimeoutMs),
  });

  const answer = readTaggedOutput({ stdout, tag, schema, role: name });
  // Written before the leg is judged: a leg that broke its branch rule is
  // exactly the one whose answer a human needs to read.
  await writeStatusFile({ dir: recordDir, status: { role: name, model, answer } });
  if (branchRule) await enforceBranchRule(sandbox, name, branchRule(answer), commits.length);
  return answer;
}

/**
 * Hold the leg to what it was allowed to do to the branch.
 *
 * A read-only leg is checked for uncommitted work as well as for commits: the
 * legs share one worktree, so an edit a lens never committed is still there
 * for the next leg to read and for the fixer to commit as nobody's work.
 */
async function enforceBranchRule(
  sandbox: Sandbox,
  name: string,
  rule: BranchRule,
  commitCount: number,
): Promise<void> {
  if (rule === "must-commit" && commitCount === 0) {
    throw new RoleError(`${name} reported the work done but committed nothing.`);
  }
  if (rule !== "read-only" && rule !== "no-commits") return;

  if (commitCount > 0) {
    throw new RoleError(`${name} may not commit but committed ${commitCount} commit(s).`);
  }
  if (rule === "no-commits") return;

  const dirt = await worktreeChanges(sandbox, name);
  if (dirt) {
    throw new RoleError(`${name} is read-only but left the worktree changed:\n${dirt}`);
  }
}

async function worktreeChanges(sandbox: Sandbox, name: string): Promise<string> {
  const { stdout, stderr, exitCode } = await sandbox.exec("git status --porcelain");
  if (exitCode !== 0) {
    throw new RoleError(`Could not check the worktree after ${name}: ${stderr.trim()}`);
  }
  return stdout.trim();
}
