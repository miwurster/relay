import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RelayConfig } from "../config.js";
import { passRecordDir } from "../crew/leg-record.js";
import { reasonOf } from "../errors.js";
import { runGit, type GitRunner } from "../host/git.js";
import { WORKTREE_DIR } from "../host/worktree-dir.js";
import { passBranch } from "../sandbox/sandbox.js";
import { digestRecords } from "./digest.js";
import type { PassRecord } from "./pass-record.js";
import { readPassRecord } from "./pass-record.js";
import { section } from "./section.js";

/** Where sandcastle files each leg's transcript, which is not configurable. */
const LOG_DIR = join(WORKTREE_DIR, "logs");

/** What every archive of one work item's pass is named, before its stamp. */
const ARCHIVE_PREFIX = "archive-";

/** What the host needs to build one archive. */
export interface ArchiveInput {
  repoRoot: string;
  workItem: number;
  config: RelayConfig;
  git?: GitRunner;
}

/**
 * Write one pass's archive and answer with the path it landed at.
 *
 * Inside the pass's own record directory, so it is gitignored by the same rule
 * as the records it is built from, and stamped rather than fixed: a second
 * archive of one pass is another reading of it, not a replacement.
 */
export async function writeArchive(input: ArchiveInput): Promise<string> {
  const archivedAt = new Date();
  const text = await renderArchive(input, archivedAt);
  const dir = passRecordDir(input.repoRoot, input.workItem);
  // Made if it must: a pass nobody recorded still gets an archive saying so, so
  // the command answers rather than failing where there is nothing to read.
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${ARCHIVE_PREFIX}${stamp(archivedAt)}.txt`);
  await writeFile(path, text, "utf8");
  return path;
}

/**
 * Everything relay knows about one pass, as one file.
 *
 * Every section is always present, an empty one saying so — the archive is read
 * long after the pass and diffed against other passes, so a section that
 * vanished would read as a change to the flow rather than as the absence it is.
 *
 * Nothing here is inferred: what the pass did comes from the pass record, what
 * each leg did from the leg records, what the legs said from their transcripts,
 * and what came out of it from git.
 */
export async function renderArchive(
  { repoRoot, workItem, config, git = runGit }: ArchiveInput,
  archivedAt: Date = new Date(),
): Promise<string> {
  const dir = passRecordDir(repoRoot, workItem);
  const record = await readPassRecord(dir);
  const branch = record?.branch ?? passBranch(config, workItem);

  return [
    headingSection({ workItem, archivedAt, record }),
    await digestRecords(dir),
    await diffSection({ repoRoot, record, git }),
    await transcriptsSection({ repoRoot, branch }),
  ].join("\n");
}

/**
 * Which pass this is an archive of, and when it was read back.
 *
 * How the pass ended is the digest's heading below rather than this one's: the
 * digest is also read on its own, so the outcome lives with it and is stated
 * once.
 */
function headingSection({
  workItem,
  archivedAt,
  record,
}: {
  workItem: number;
  archivedAt: Date;
  record: PassRecord | undefined;
}): string {
  const lines = [`relay archive — work item #${workItem}`, `archived: ${archivedAt.toISOString()}`];
  if (!record) {
    lines.push(
      "",
      "No pass record: this pass ran before relay recorded its own facts, or never",
      "reached the point of writing them. What follows is what its legs left behind.",
    );
    return `${lines.join("\n")}\n`;
  }

  lines.push(
    `branch: ${record.branch} (from ${record.baseBranch})`,
    `landing: ${record.landing}`,
    `started: ${record.startedAt}`,
    `ended: ${record.endedAt}`,
  );
  return `${lines.join("\n")}\n`;
}

/**
 * What the pass produced, as the diff of its branch against the branch it was
 * cut from.
 *
 * Read from git at archive time rather than recorded during the pass, because
 * relay never deletes a pass branch — and a branch a human has since removed is
 * reported as gone rather than guessed at from the leg records.
 */
async function diffSection({
  repoRoot,
  record,
  git,
}: {
  repoRoot: string;
  record: PassRecord | undefined;
  git: GitRunner;
}): Promise<string> {
  if (!record) {
    return section("Diff", ["  No pass record, so the range the diff would cover is unknown."]);
  }

  const range = `${record.baseBranch}...${record.branch}`;
  try {
    const summary = await git(["-C", repoRoot, "diff", "--stat", range]);
    const patch = await git(["-C", repoRoot, "diff", range]);
    return section(`Diff (${range})`, [summary, "", patch].map(indent));
  } catch (error) {
    // One line, because the commonest cause is a branch a human deleted and
    // git's own answer to that is several lines of stderr about the argument
    // being ambiguous.
    return section(`Diff (${range})`, [`  Not available: ${firstLine(reasonOf(error))}`]);
  }
}

function firstLine(text: string): string {
  return text.split("\n")[0]?.trim() ?? text;
}

/**
 * Every leg's transcript, whole.
 *
 * The transcripts are sandcastle's, named after the pass branch and nothing
 * else, so a second pass over one work item overwrites them — which is why each
 * is headed with its own mtime. A transcript older than the pass record above it
 * belongs to an earlier pass, and only that timestamp says so.
 */
async function transcriptsSection({
  repoRoot,
  branch,
}: {
  repoRoot: string;
  branch: string;
}): Promise<string> {
  const dir = join(repoRoot, LOG_DIR);
  const logs = await transcriptFiles(dir, branch);
  if (logs.length === 0) {
    return section("Transcripts", [`  None found under ${LOG_DIR} for branch ${branch}.`]);
  }

  const bodies = await Promise.all(
    logs.map(async ({ name, mtimeMs }) => {
      const body = await readFile(join(dir, name), "utf8");
      return [`--- ${name} (last written ${new Date(mtimeMs).toISOString()}) ---`, body].join("\n");
    }),
  );
  return section(`Transcripts (${logs.length})`, bodies);
}

/** One leg's transcript file, as the directory listing describes it. */
interface Transcript {
  name: string;
  mtimeMs: number;
}

/**
 * The transcripts of one branch's legs, oldest first, which is the order the
 * legs ran in.
 *
 * Matched on the branch prefix rather than reconstructed name by name: a leg's
 * own file name is sandcastle's to build, and a retry attempt files a second
 * transcript relay would otherwise have to know to look for.
 */
async function transcriptFiles(dir: string, branch: string): Promise<Transcript[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }

  const prefix = `${logNameFor(branch)}-`;
  const matched = names.filter((name) => name.startsWith(prefix) && name.endsWith(".log"));
  const transcripts = await Promise.all(
    matched.map(async (name) => ({ name, mtimeMs: (await stat(join(dir, name))).mtimeMs })),
  );
  return transcripts.sort((one, other) => one.mtimeMs - other.mtimeMs);
}

/**
 * A branch as sandcastle spells it in a log file name, since a `branchPrefix`
 * with a slash in it — relay's own default — reaches the file system as a dash.
 */
function logNameFor(branch: string): string {
  return branch.replaceAll(/[/\\:*?"<>|]/g, "-");
}

/** An ISO instant a filename can carry, on every platform. */
function stamp(at: Date): string {
  return at
    .toISOString()
    .replace(/\.\d+Z$/, "")
    .replaceAll(":", "-");
}

function indent(block: string): string {
  return block
    .split("\n")
    .map((line) => (line ? `  ${line}` : line))
    .join("\n");
}
