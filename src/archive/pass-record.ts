import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Landing } from "../config.js";
import type { PassFacts } from "../crew/contract.js";

/** The pass record's file name, in the same directory as the pass's leg records. */
export const PASS_RECORD_FILE = "pass.json";

/**
 * How a pass ended: at its handover with everything the harness worked out, or
 * on a throw that unwound past every leg still to come.
 *
 * Two arms rather than one shape with optional facts, because a crashed pass
 * does not have them to state — a gate verdict of `not-gated` on that path would
 * be a claim about a gate nobody asked, not a fact.
 */
export type PassEnd = ({ kind: "handed-over" } & PassFacts) | { kind: "crashed"; error: string };

/**
 * What one pass was, as the host knows it: which item over which branches, how
 * the repo lands, when it ran, and how it ended.
 *
 * A record of the pass itself, next to but distinct from the **leg records**
 * ([ADR-0035](../../docs/adr/0035-a-pass-records-its-own-facts.md)).
 */
export interface PassRecord {
  workItem: number;
  branch: string;
  baseBranch: string;
  landing: Landing;
  startedAt: string;
  endedAt: string;
  end: PassEnd;
}

/** Write the pass record into the pass's own record directory. */
export async function writePassRecord({
  dir,
  record,
}: {
  dir: string;
  record: PassRecord;
}): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, PASS_RECORD_FILE), `${JSON.stringify(record, undefined, 2)}\n`, "utf8");
}

/**
 * The pass record in `dir`, or nothing when there is none to read.
 *
 * Absent, unparseable and the wrong shape all answer the same way, because what
 * the caller does about them is the same: an archive says it has no pass record
 * rather than failing. The shape is checked because the file may have been
 * written by an older relay, whose record the fields below are read out of.
 */
export async function readPassRecord(dir: string): Promise<PassRecord | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(join(dir, PASS_RECORD_FILE), "utf8"));
    return isPassRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function isPassRecord(value: unknown): value is PassRecord {
  const record = asFields(value);
  if (!record) return false;
  return (
    typeof record.workItem === "number" &&
    typeof record.branch === "string" &&
    typeof record.baseBranch === "string" &&
    typeof record.landing === "string" &&
    typeof record.startedAt === "string" &&
    typeof record.endedAt === "string" &&
    isPassEnd(record.end)
  );
}

/**
 * Whether the ending is one the archive can read all the way down.
 *
 * Every field the archive's heading dereferences is checked, not just the arm's
 * own name: a record ending `{ "kind": "handed-over" }` and nothing else would
 * otherwise pass as an ending with facts and throw where those facts are read.
 * The point of the guard is that an archive of an unreadable record says so
 * ([ADR-0035](../../docs/adr/0035-a-pass-records-its-own-facts.md)).
 */
function isPassEnd(value: unknown): value is PassEnd {
  const end = asFields(value);
  if (!end) return false;
  if (end.kind === "crashed") return typeof end.error === "string";
  if (end.kind !== "handed-over") return false;
  return (
    asFields(end.outcome) !== undefined &&
    asFields(end.gate) !== undefined &&
    asFields(end.land) !== undefined &&
    Array.isArray(end.committed) &&
    Array.isArray(end.finished) &&
    Array.isArray(end.blocked)
  );
}

/**
 * The value's own fields, as unknowns, or nothing where it is not an object at
 * all.
 *
 * Read as unknown fields rather than as a partial record: a file that was
 * hand-edited or written by an older relay may hold anything at all, including a
 * `null` where a record's own type says there is an object.
 */
function asFields(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}
