import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { type Landing, LANDINGS } from "../config.js";
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

const ticketRefSchema = z.object({ number: z.number(), summary: z.string() });

const resolvedGateSchema = z.object({
  command: z.string(),
  provenance: z.enum(["declared", "inferred"]),
  source: z.string(),
});

/**
 * The record as it is read back, checked all the way down to every field the
 * archive dereferences.
 *
 * Parsed rather than trusted, because the file may have been hand-edited or
 * written by an older relay — and checked to the leaf, because a record ending
 * `{ "kind": "handed-over" }` and nothing else would otherwise read as an ending
 * with facts and throw where those facts are rendered. The point is that an
 * archive of an unreadable record says so
 * ([ADR-0035](../../docs/adr/0035-a-pass-records-its-own-facts.md)).
 *
 * Typed as the record it must produce, so a change to the contract's own shapes
 * is a typecheck failure here rather than a schema that quietly stops matching.
 * The timestamps are held to ISO instants, which is what the writer emits and
 * what the digest parses back into a duration.
 */
const passRecordSchema: z.ZodType<PassRecord> = z.object({
  workItem: z.number(),
  branch: z.string(),
  baseBranch: z.string(),
  landing: z.enum(LANDINGS),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime(),
  end: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("crashed"), error: z.string() }),
    z.object({
      kind: z.literal("handed-over"),
      outcome: z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("success"), detail: z.string() }),
        z.object({ kind: z.literal("mid-block"), reason: z.string() }),
        z.object({ kind: z.literal("early-bail"), reason: z.string() }),
      ]),
      gate: z.discriminatedUnion("kind", [
        z.object({
          kind: z.literal("gated"),
          gate: resolvedGateSchema,
          green: z.boolean(),
          detail: z.string(),
        }),
        z.object({ kind: z.literal("not-gated"), gate: resolvedGateSchema }),
      ]),
      land: z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("landed"), detail: z.string() }),
        z.object({ kind: z.literal("not-landed"), reason: z.string() }),
        z.object({ kind: z.literal("no-landing") }),
      ]),
      committed: z.array(ticketRefSchema),
      finished: z.array(ticketRefSchema),
      blocked: z.array(ticketRefSchema),
    }),
  ]),
});

/**
 * The pass record in `dir`, or nothing when there is none to read.
 *
 * Absent, unparseable and the wrong shape all answer the same way, because what
 * the caller does about them is the same: an archive says it has no pass record
 * rather than failing.
 */
export async function readPassRecord(dir: string): Promise<PassRecord | undefined> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(join(dir, PASS_RECORD_FILE), "utf8"));
  } catch {
    return undefined;
  }
  const result = passRecordSchema.safeParse(value);
  return result.success ? result.data : undefined;
}
