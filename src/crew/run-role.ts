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
  const first = await sandbox.run({
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

  // Every attempt's output, kept whole: a role that narrated its answer instead
  // of tagging it said the substantive thing on its first attempt, and a record
  // holding only the terse retry would lose exactly what a human came to read.
  const said = [first.stdout];
  let commitCount = first.commits.length;
  let read = readAnswer({ stdout: first.stdout, tag, schema, role: name });

  // A protocol slip is not a role that cannot do the work, so it gets exactly
  // one more iteration of the same session, told what was wrong
  // ([ADR-0033](../../docs/adr/0033-a-protocol-slip-gets-one-retry.md)). The
  // retry runs under a fresh signal from the same role timeout, and its commits
  // are added to the first attempt's before any branch rule is judged.
  if ("error" in read && first.resume) {
    const retry = await first.resume(retryPrompt(read.error, tag), {
      name: `${name}-retry`,
      signal: AbortSignal.timeout(config.roleTimeoutMs),
    });
    said.push(retry.stdout);
    commitCount += retry.commits.length;
    read = readAnswer({ stdout: retry.stdout, tag, schema, role: name });
  }

  if ("error" in read) {
    // Recorded before it is raised: the leg the pass blocks on is the one leg a
    // human has to be able to read, and only the record survives the sandbox.
    await writeStatusFile({
      dir: recordDir,
      status: { role: name, model, failure: read.error, stdout: said.join("\n\n") },
    });
    throw new RoleError(read.error);
  }

  // Written before the leg is judged: a leg that broke its branch rule is
  // exactly the one whose answer a human needs to read.
  await writeStatusFile({ dir: recordDir, status: { role: name, model, answer: read.answer } });
  if (branchRule) await enforceBranchRule(sandbox, name, branchRule(read.answer), commitCount);
  return read.answer;
}

/** The leg's answer, or the sentence saying why there is none to be had. */
function readAnswer<Schema extends z.ZodType>(options: {
  stdout: string;
  tag: string;
  schema: Schema;
  role: string;
}): { answer: z.infer<Schema> } | { error: string } {
  try {
    return { answer: readTaggedOutput(options) };
  } catch (error) {
    if (error instanceof RoleError) return { error: error.message };
    throw error;
  }
}

/**
 * What the role is told on its second attempt.
 *
 * It names the tag as well as the failure, so a role whose block was missing,
 * unfenced or the wrong shape all know what to emit — and it asks for the answer
 * again rather than for the work again, because the work is already done.
 */
function retryPrompt(failure: string, tag: string): string {
  return [
    `Your last answer did not fit relay's output protocol: ${failure}`,
    `Re-emit that same answer now as a single <${tag}>…</${tag}> block holding the JSON the prompt asked for, and nothing else. Do not redo the work.`,
  ].join("\n");
}

/**
 * Hold the leg to what it was allowed to do to the branch.
 *
 * A read-only leg is checked for uncommitted work as well as for commits: the
 * legs share one worktree, so an edit a review never committed is still there
 * for the next leg to read and for the fixer to commit as nobody's work.
 *
 * That dirt is discarded rather than fatal. A leg that judges the branch has to
 * build it, and a build writes files nobody edited — a lockfile the install
 * refreshed is not a review misbehaving, and ending the pass over one throws
 * away every leg that came before it. Discarding restores the property the rule
 * is there for: the next leg reads the branch as the leg found it.
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
    console.error(`relay: [${name}] is read-only; discarding what it left behind:\n${dirt}`);
    await discardWorktreeChanges(sandbox, name);
  }
}

/** Put the worktree back the way a read-only leg found it. */
async function discardWorktreeChanges(sandbox: Sandbox, name: string): Promise<void> {
  const { stderr, exitCode } = await sandbox.exec("git checkout -- . && git clean -fd");
  if (exitCode !== 0) {
    throw new RoleError(`Could not restore the worktree after ${name}: ${stderr.trim()}`);
  }
}

async function worktreeChanges(sandbox: Sandbox, name: string): Promise<string> {
  const { stdout, stderr, exitCode } = await sandbox.exec("git status --porcelain");
  if (exitCode !== 0) {
    throw new RoleError(`Could not check the worktree after ${name}: ${stderr.trim()}`);
  }
  return stdout.trim();
}
