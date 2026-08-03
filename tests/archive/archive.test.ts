import { mkdir, mkdtemp, readFile, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { renderArchive, writeArchive } from "../../src/archive/archive.js";
import { type PassRecord, writePassRecord } from "../../src/archive/pass-record.js";
import { relayConfigSchema, type RelayConfig } from "../../src/config.js";
import { passRecordDir } from "../../src/crew/leg-record.js";
import type { GitRunner } from "../../src/host/git.js";

const WORK_ITEM = 42;
const config: RelayConfig = relayConfigSchema.parse({ landing: "merge" });

/** The branch a pass over #42 runs on, and the name its transcripts carry. */
const BRANCH = "agent/42";
const LOG_PREFIX = "agent-42";

const handedOver: PassRecord = {
  workItem: WORK_ITEM,
  branch: BRANCH,
  baseBranch: "main",
  landing: "merge",
  startedAt: "2026-08-02T10:00:00.000Z",
  endedAt: "2026-08-02T10:30:00.000Z",
  end: {
    kind: "handed-over",
    outcome: { kind: "mid-block", reason: "the branch does not do what the item asked" },
    gate: {
      kind: "gated",
      gate: { command: "npm run verify", provenance: "declared", source: "AGENTS.md" },
      green: false,
      detail: "two tests red",
    },
    land: { kind: "no-landing" },
    committed: [{ number: 43, summary: "the search core" }],
    finished: [],
    blocked: [{ number: 43, summary: "the search core" }],
  },
};

let repoRoot: string;

/** A git that answers both diff calls, so the diff section has something to show. */
const fakeGit: GitRunner = async (args) =>
  args.includes("--stat") ? " one.ts | 2 +-" : "diff --git a/one.ts b/one.ts";

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), "relay-archive-"));
  await mkdir(passRecordDir(repoRoot, WORK_ITEM), { recursive: true });
});

/** One leg's status record, so the digest section has a leg to report. */
async function legRecord(): Promise<void> {
  await writeFile(
    join(passRecordDir(repoRoot, WORK_ITEM), "planner.status.json"),
    JSON.stringify({ role: "planner", model: "claude-opus-5", answer: { kind: "plan" } }),
    "utf8",
  );
}

/** One leg's transcript, filed where sandcastle files it, with a pinned mtime. */
async function transcript(name: string, body: string, at: string): Promise<void> {
  const dir = join(repoRoot, ".sandcastle", "logs");
  await mkdir(dir, { recursive: true });
  const path = join(dir, name);
  await writeFile(path, body, "utf8");
  await utimes(path, new Date(at), new Date(at));
}

async function render(git: GitRunner = fakeGit): Promise<string> {
  return await renderArchive({ repoRoot, workItem: WORK_ITEM, config, git });
}

describe("renderArchive", () => {
  it("names the pass's own facts, which no leg record holds", async () => {
    await writePassRecord({ dir: passRecordDir(repoRoot, WORK_ITEM), record: handedOver });

    const archive = await render();

    expect(archive).toContain("relay archive — work item #42");
    expect(archive).toContain("branch: agent/42 (from main)");
    expect(archive).toContain("landing: merge");
    expect(archive).toContain("outcome: mid-block — the branch does not do what the item asked");
    expect(archive).toContain("gate: `npm run verify` (declared): red — two tests red");
    expect(archive).toContain("landing result: no landing to do");
    expect(archive).toContain("committed tickets: #43");
    expect(archive).toContain("finished tickets: none");
  });

  it("says a crashed pass has no gate, landing or tickets to name", async () => {
    await writePassRecord({
      dir: passRecordDir(repoRoot, WORK_ITEM),
      record: { ...handedOver, end: { kind: "crashed", error: "the sandbox died" } },
    });

    const archive = await render();

    expect(archive).toContain("outcome: crashed — the sandbox died");
    expect(archive).toContain("gate, landing and tickets: unknown, it crashed");
  });

  it("says so where there is no pass record, rather than failing", async () => {
    await legRecord();

    const archive = await render();

    expect(archive).toContain("No pass record");
    expect(archive).toContain("No pass record, so the range the diff would cover is unknown.");
    expect(archive).toContain("planner");
  });

  it("reports the pass record as the pass's own facts, never as an unreadable record", async () => {
    await writePassRecord({ dir: passRecordDir(repoRoot, WORK_ITEM), record: handedOver });
    await legRecord();

    const archive = await render();

    expect(archive.slice(archive.indexOf("Unparseable records"))).toContain("none");
  });

  it("dates the first leg from the pass's own start, which only the pass record knows", async () => {
    await writePassRecord({ dir: passRecordDir(repoRoot, WORK_ITEM), record: handedOver });
    const path = join(passRecordDir(repoRoot, WORK_ITEM), "planner.status.json");
    await legRecord();
    const finishedAt = new Date("2026-08-02T10:01:00.000Z");
    await utimes(path, finishedAt, finishedAt);

    const archive = await render();

    expect(archive).toMatch(/planner .*~60\.0s/);
  });

  it("carries the diff of the pass branch against the branch it was cut from", async () => {
    await writePassRecord({ dir: passRecordDir(repoRoot, WORK_ITEM), record: handedOver });

    const archive = await render();

    expect(archive).toContain("Diff (main...agent/42)");
    expect(archive).toContain("one.ts | 2 +-");
    expect(archive).toContain("diff --git a/one.ts b/one.ts");
  });

  it("says why the diff is missing when the branch is gone", async () => {
    await writePassRecord({ dir: passRecordDir(repoRoot, WORK_ITEM), record: handedOver });

    const archive = await render(async () => {
      throw new Error("unknown revision agent/42");
    });

    expect(archive).toContain("Not available: unknown revision agent/42");
  });

  it("inlines every transcript of the pass branch, oldest first, with its mtime", async () => {
    await writePassRecord({ dir: passRecordDir(repoRoot, WORK_ITEM), record: handedOver });
    await transcript(`${LOG_PREFIX}-planner.log`, "the planner said this", "2026-08-02T10:01:00Z");
    await transcript(
      `${LOG_PREFIX}-handover.log`,
      "the handover said this",
      "2026-08-02T10:29:00Z",
    );
    await transcript("agent-99-planner.log", "another pass entirely", "2026-08-02T10:05:00Z");

    const archive = await render();

    expect(archive).toContain("Transcripts (2)");
    expect(archive).toContain("the planner said this");
    expect(archive).toContain("2026-08-02T10:01:00.000Z");
    expect(archive.indexOf("the planner said this")).toBeLessThan(
      archive.indexOf("the handover said this"),
    );
    expect(archive).not.toContain("another pass entirely");
  });

  it("finds the transcripts from the config where no pass record names the branch", async () => {
    await transcript(`${LOG_PREFIX}-planner.log`, "the planner said this", "2026-08-02T10:01:00Z");

    const archive = await render();

    expect(archive).toContain("the planner said this");
  });

  it("names where it looked when there is no transcript to be had", async () => {
    const archive = await render();

    expect(archive).toContain("None found under .sandcastle/logs for branch agent/42");
  });
});

describe("writeArchive", () => {
  it("files a stamped archive in the pass's own record directory", async () => {
    await writePassRecord({ dir: passRecordDir(repoRoot, WORK_ITEM), record: handedOver });

    const path = await writeArchive({ repoRoot, workItem: WORK_ITEM, config, git: fakeGit });

    expect(path).toMatch(/\.relay\/42\/archive-[\d-]+T[\d-]+\.txt$/);
    expect(await readFile(path, "utf8")).toContain("relay archive — work item #42");
  });

  it("archives a work item nothing ever recorded, rather than failing on it", async () => {
    const path = await writeArchive({ repoRoot, workItem: 99, config, git: fakeGit });

    expect(await readFile(path, "utf8")).toContain("No pass record");
  });
});
