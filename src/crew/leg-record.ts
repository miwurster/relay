import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { RELAY_DIR, RELAY_GITIGNORE_PATH } from "../config.js";
import type { IgnoreRule } from "../host/gitignore.js";
import type { Finding } from "./contract.js";

const DOCTOR_RECORD_DIR = "doctor";

/** Where one pass's legs record, named after the work item they ran over. */
export function passRecordDir(repoRoot: string, workItem: number): string {
  return join(repoRoot, RELAY_DIR, String(workItem));
}

/** Where the gate probe's one leg records. */
export function doctorRecordDir(repoRoot: string): string {
  return join(repoRoot, RELAY_DIR, DOCTOR_RECORD_DIR);
}

/**
 * The record directories belong in relay's own `.gitignore`, next to the
 * credential rule and for the same reason: they sit inside the directory the
 * entries govern, so they read as bare names there.
 *
 * A pass's directory is named after its work item, which is why the entry is a
 * glob — one line covers every pass rather than one line per issue.
 */
export const RECORD_RULE: IgnoreRule = {
  file: RELAY_GITIGNORE_PATH,
  entries: [`${DOCTOR_RECORD_DIR}/`, "[0-9]*/"],
  why: "What a relay leg recorded. Runtime output, never committed.",
};

/** The tagged answer one leg ended its run with, as relay parsed it. */
interface RoleStatus {
  role: string;
  model: string;
  answer: unknown;
}

/** Write one role's status to the leg's record directory, a file per run. */
export async function writeStatusFile({
  dir,
  status,
}: {
  dir: string;
  status: RoleStatus;
}): Promise<void> {
  await writeRecordFile({ dir, name: `${status.role}.status.json`, value: status });
}

/**
 * Write one lens's findings to its own file in the leg's record directory.
 *
 * A file per lens, never a shared one: each file is attributable to the lens
 * that wrote it, and merging what they return is the harness's job.
 */
export async function writeFindingsFile({
  dir,
  name,
  findings,
}: {
  dir: string;
  name: string;
  findings: readonly Finding[];
}): Promise<void> {
  await writeRecordFile({ dir, name: `${name}.json`, value: findings });
}

/**
 * Every record file is pretty JSON, in a directory relay makes if it must.
 *
 * The records land on the host rather than in the sandbox's worktree, because
 * that worktree is disposed of once the pass ends and stdout scrolls past — so
 * what a leg left behind is only inspectable if it lands here.
 */
async function writeRecordFile({
  dir,
  name,
  value,
}: {
  dir: string;
  name: string;
  value: unknown;
}): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, name), `${JSON.stringify(value, undefined, 2)}\n`, "utf8");
}
