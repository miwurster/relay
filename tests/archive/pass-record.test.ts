import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  PASS_RECORD_FILE,
  type PassRecord,
  readPassRecord,
  writePassRecord,
} from "../../src/archive/pass-record.js";

const record: PassRecord = {
  workItem: 42,
  branch: "agent/42",
  baseBranch: "main",
  landing: "pull-request",
  startedAt: "2026-08-02T10:00:00.000Z",
  endedAt: "2026-08-02T10:30:00.000Z",
  end: { kind: "crashed", error: "the sandbox died" },
};

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "relay-pass-record-"));
});

describe("the pass record", () => {
  it("reads back what a pass wrote about itself", async () => {
    await writePassRecord({ dir: join(dir, "42"), record });

    expect(await readPassRecord(join(dir, "42"))).toEqual(record);
  });

  it("answers with nothing where no pass ever recorded", async () => {
    expect(await readPassRecord(dir)).toBeUndefined();
  });

  it("answers with nothing for a file that is not a pass record", async () => {
    await writeFile(join(dir, PASS_RECORD_FILE), '{"legs": 9}', "utf8");

    expect(await readPassRecord(dir)).toBeUndefined();
  });

  it("answers with nothing for an ending the archive could not read all the way down", async () => {
    await writePassRecord({ dir, record });
    await writeFile(
      join(dir, PASS_RECORD_FILE),
      JSON.stringify({ ...record, end: { kind: "handed-over" } }),
      "utf8",
    );

    expect(await readPassRecord(dir)).toBeUndefined();
  });

  it("answers with nothing where the record names no landing to state", async () => {
    await writeFile(
      join(dir, PASS_RECORD_FILE),
      JSON.stringify({ ...record, landing: undefined }),
      "utf8",
    );

    expect(await readPassRecord(dir)).toBeUndefined();
  });

  it("answers with nothing for a file that is not JSON at all", async () => {
    await writeFile(join(dir, PASS_RECORD_FILE), "the disk filled up mid-writ", "utf8");

    expect(await readPassRecord(dir)).toBeUndefined();
  });
});
