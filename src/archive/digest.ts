import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { type Axis, type Finding, findingLabel } from "../crew/contract.js";
import type { FindingVerdict, RoleStatus } from "../crew/leg-record.js";
import { PASS_RECORD_FILE, type PassRecord, readPassRecord } from "./pass-record.js";
import { section } from "./section.js";

const STATUS_SUFFIX = ".status.json";
const VERDICTS_SUFFIX = ".verdicts.json";

/**
 * The axes findings are grouped under, spec first because it is the binding one.
 *
 * Every axis a review reports and nothing else: a red gate's finding carries no
 * axis and is never written to a findings file, so it reaches the digest only
 * through the fixer's verdicts.
 *
 * Spelled as a map over `Axis` and read back in key order, rather than as a list
 * of axes: an axis added to the contract is then a typecheck failure here, not a
 * group that silently stops being printed. `quality` reached the contract as a
 * list and went unprinted until a rehearsal noticed.
 */
const AXES = Object.keys({
  spec: null,
  standards: null,
  quality: null,
} satisfies Record<Axis, null>) as Axis[];

/** One leg of the pass, as its status record and that record's mtime describe it. */
interface Leg {
  role: string;
  model: string;
  /** What the leg answered, in one phrase. */
  status: string;
  mtimeMs: number;
}

/** One finding, with the leg that raised it. */
interface RaisedFinding {
  finding: Finding;
  /** The record file's name without its suffix, which is the leg's own name. */
  leg: string;
}

/** Everything the digest reports, read out of one pass's record directory. */
interface Records {
  /** In the order the legs finished. */
  legs: Leg[];
  findings: RaisedFinding[];
  verdicts: FindingVerdict[];
  /** The files whose JSON, or whose shape, the digest did not recognise. */
  unparseable: string[];
}

/** One record file on disk, before the digest knows what is in it. */
interface RecordFile {
  name: string;
  mtimeMs: number;
  /** Absent when the file's JSON did not parse. */
  value?: unknown;
}

/**
 * Report what every leg of one pass did, out of the records relay wrote.
 *
 * The digest is what a contributor reads after a rehearsal and the artefact two
 * rehearsals are compared through, so every section is always printed — a
 * section that vanished when it was empty would show up in a diff as a change to
 * the flow rather than as the absence it is.
 */
export async function digestRecords(dir: string): Promise<string> {
  const names = await recordNames(dir);
  if (!names) return heading(dir, "The record directory is absent: no pass recorded here.");
  if (names.length === 0) return heading(dir, "The record directory is empty: no leg recorded.");

  const record = await readPassRecord(dir);
  const records = classify(await Promise.all(names.map((name) => readRecord(dir, name))));
  return [
    heading(dir, `${records.legs.length} leg(s) recorded.`),
    legsSection(records.legs, record ? Date.parse(record.startedAt) : undefined),
    findingsSection(records.findings),
    verdictsSection(records.verdicts),
    unaddressedSection(record),
    unparseableSection(records.unparseable),
  ].join("\n");
}

/** The record files in the directory, or nothing when there is no directory. */
async function recordNames(dir: string): Promise<string[] | undefined> {
  try {
    const names = await readdir(dir);
    return names.filter((name) => name.endsWith(".json")).sort();
  } catch {
    return undefined;
  }
}

async function readRecord(dir: string, name: string): Promise<RecordFile> {
  const path = join(dir, name);
  const { mtimeMs } = await stat(path);
  try {
    return { name, mtimeMs, value: JSON.parse(await readFile(path, "utf8")) };
  } catch {
    return { name, mtimeMs };
  }
}

/**
 * Sort each file into what its name says it is, and name the ones that are not
 * what they say.
 *
 * A file the digest cannot read is reported rather than skipped: a digest that
 * quietly omitted a leg would read as a pass that never ran it.
 */
function classify(files: readonly RecordFile[]): Records {
  const records: Records = { legs: [], findings: [], verdicts: [], unparseable: [] };
  for (const file of files) {
    // The pass record is the pass's own facts rather than any leg's, and the
    // archive's heading is where it is read. Skipped rather than classified, so
    // it does not report itself as a record the digest cannot read.
    if (file.name === PASS_RECORD_FILE) continue;

    if (file.name.endsWith(STATUS_SUFFIX)) {
      if (isRoleStatus(file.value)) records.legs.push(legOf(file.value, file.mtimeMs));
      else records.unparseable.push(file.name);
    } else if (file.name.endsWith(VERDICTS_SUFFIX)) {
      if (isArrayOf(file.value, isFindingVerdict)) records.verdicts.push(...file.value);
      else records.unparseable.push(file.name);
    } else if (isArrayOf(file.value, isFinding)) {
      const leg = file.name.replace(/\.json$/, "");
      records.findings.push(...file.value.map((finding) => ({ finding, leg })));
    } else {
      records.unparseable.push(file.name);
    }
  }
  records.legs.sort((one, other) => one.mtimeMs - other.mtimeMs);
  return records;
}

/**
 * A leg that broke the output protocol reads as its failure, not as the generic
 * phrase: that leg is why the pass blocked, so the digest has to say so.
 */
function legOf(record: RoleStatus, mtimeMs: number): Leg {
  const status = "failure" in record ? record.failure : statusOf(record.answer);
  return { role: record.role, model: record.model, status: onePhrase(status), mtimeMs };
}

/** How long a status phrase may be before the leg it belongs to is unreadable. */
const PHRASE_LIMIT = 200;

/**
 * A leg is one line of a table, so its status is one line of text.
 *
 * A schema failure carries zod's own message, which is pretty-printed JSON over
 * a dozen lines — left as it is, one such leg would break every later leg's
 * columns and bury the pass's shape under one leg's error.
 */
function onePhrase(status: string): string {
  const phrase = status.replace(/\s+/g, " ").trim();
  return phrase.length > PHRASE_LIMIT ? `${phrase.slice(0, PHRASE_LIMIT)}…` : phrase;
}

/**
 * The one phrase a leg's answer comes down to.
 *
 * Most roles answer with a kind, and the ones that decline carry the reason with
 * it. A review's or a fixer's answer has no kind of its own — what those legs
 * found is the digest's own findings and verdicts sections.
 *
 * The handover's answer is the pull request it opened, which is what a
 * `pull-request` rehearsal is run to look at. Carried here rather than left in the
 * pass's own console output, so a run file read later still points at the diff a
 * human was meant to review.
 */
function statusOf(answer: unknown): string {
  if (!isRecord(answer)) return "recorded";
  if (typeof answer.prUrl === "string") return answer.prUrl;
  if (typeof answer.kind !== "string") return "recorded";
  return typeof answer.reason === "string" ? `${answer.kind}: ${answer.reason}` : answer.kind;
}

/**
 * Every leg with the wall clock its record implies.
 *
 * A status record carries no timestamp, so the duration is the gap to the
 * previous record's mtime: records land as a leg finishes, which makes the gap
 * the leg's own run plus the harness's overhead between the two. That is why it
 * is labelled approximate.
 *
 * The first leg's gap is to the pass's own start, which only the pass record
 * knows — so a digest read without one still prints that leg, with no number
 * against it rather than a made-up one.
 */
function legsSection(legs: readonly Leg[], startedAtMs?: number): string {
  const width = Math.max(0, ...legs.map(({ role }) => role.length));
  const lines = legs.map((leg, index) => {
    const since = legs[index - 1]?.mtimeMs ?? startedAtMs;
    const duration = since === undefined ? "—" : `~${((leg.mtimeMs - since) / 1000).toFixed(1)}s`;
    return `  ${leg.role.padEnd(width)}  ${leg.model}  ${duration}  ${leg.status}`;
  });
  return section("Legs (durations approximate, from record mtimes)", lines);
}

/**
 * The findings, under the axis each came from and beside the leg that raised it.
 *
 * Grouped rather than listed, because the axes do not weigh the same: a `spec`
 * finding is binding and a `standards` one is not, so a review-prompt change
 * that moved one and not the other has to be readable at a glance.
 *
 * The leg is named because two reviews of one scope both report the same axis —
 * the branch review and its **re-review** — and a count that merged them reads
 * as one review having found them all.
 */
function findingsSection(findings: readonly RaisedFinding[]): string {
  const lines = AXES.flatMap((axis) => {
    const grouped = findings.filter(({ finding }) => findingLabel(finding) === axis);
    if (grouped.length === 0) return [];
    return [
      `  ${axis} (${grouped.length})`,
      ...grouped.map(({ finding, leg }) => `    (${leg}) ${describe(finding)}`),
    ];
  });
  return section("Findings by axis", lines);
}

function verdictsSection(verdicts: readonly FindingVerdict[]): string {
  const width = Math.max(0, ...verdicts.map(({ id }) => id.length));
  const lines = verdicts.map(({ id, finding, verdict }) => {
    const reason = verdict.kind === "skipped" ? ` — ${verdict.reason}` : "";
    return `  ${id.padEnd(width)}  ${verdict.kind}  ${describe(finding)}${reason}`;
  });
  return section("Fixer verdicts", lines);
}

/**
 * Every finding nobody acted on, with the sentence explaining why, as the pass
 * itself recorded it.
 *
 * Read rather than re-derived: the harness is the only thing that knows why a
 * finding went unaddressed, and its reasons are not all recoverable from the
 * verdict records — a fixer that failed to answer left no verdicts, so a digest
 * inferring from them reported "no fixer was handed it" about a finding a fixer
 * was handed twice. A pass that crashed has no facts to state, and so no lines
 * here.
 */
function unaddressedSection(record: PassRecord | undefined): string {
  const unaddressed = record?.end.kind === "handed-over" ? record.end.unaddressed : [];
  const lines = unaddressed.map(({ finding, reason }) => `  ${describe(finding)} — ${reason}`);
  return section("Unaddressed findings", lines);
}

function unparseableSection(names: readonly string[]): string {
  return section(
    "Unparseable records",
    names.map((name) => `  ${name}`),
  );
}

function describe(finding: Finding): string {
  const ticket = "ticket" in finding && finding.ticket ? `#${finding.ticket} ` : "";
  return `[${findingLabel(finding)}] ${ticket}${finding.summary}`;
}

function heading(dir: string, detail: string): string {
  return `relay pass digest — ${dir}\n${detail}\n`;
}

function isRoleStatus(value: unknown): value is RoleStatus {
  return (
    isRecord(value) &&
    typeof value.role === "string" &&
    typeof value.model === "string" &&
    ("answer" in value || (typeof value.failure === "string" && typeof value.stdout === "string"))
  );
}

function isFinding(value: unknown): value is Finding {
  if (!isRecord(value) || typeof value.summary !== "string") return false;
  if (typeof value.source !== "string") return false;
  return value.source === "green-gate" ? true : AXES.some((axis) => value.axis === axis);
}

function isFindingVerdict(value: unknown): value is FindingVerdict {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isFinding(value.finding) &&
    isRecord(value.verdict) &&
    (value.verdict.kind === "fixed" ||
      (value.verdict.kind === "skipped" && typeof value.verdict.reason === "string"))
  );
}

function isArrayOf<T>(value: unknown, is: (item: unknown) => item is T): value is T[] {
  return Array.isArray(value) && value.every(is);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
