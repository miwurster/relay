import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { Finding } from "../../src/crew/contract.js";
import { digestRecords } from "../../rehearsal/digest.js";

/** The mtimes the durations are read out of, one minute apart per leg. */
const GENESIS = new Date("2026-07-30T12:00:00Z").getTime();
const MINUTE = 60_000;

const specFinding: Finding = {
  source: "ticketReview",
  axis: "spec",
  ticket: 101,
  summary: "the due date is never validated",
};

const standardsFinding: Finding = {
  source: "ticketReview",
  axis: "standards",
  ticket: 101,
  summary: "toDueDate is named vaguely",
};

const rereviewFinding: Finding = {
  source: "branchReview",
  axis: "spec",
  summary: "the overdue query ignores the injected clock",
};

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "relay-digest-"));
});

/** Write one record file and pin its mtime, so durations are deterministic. */
async function record(name: string, value: unknown, minute: number): Promise<void> {
  const path = join(dir, name);
  await writeFile(path, typeof value === "string" ? value : JSON.stringify(value), "utf8");
  const when = new Date(GENESIS + minute * MINUTE);
  await utimes(path, when, when);
}

/** The records of a pass that reviewed one ticket, fixed one finding and declined one. */
async function passRecords(): Promise<void> {
  await record(
    "gateResolver.status.json",
    {
      role: "gateResolver",
      model: "claude-haiku-4-5",
      answer: { command: "npm run verify", provenance: "declared", source: "AGENTS.md" },
    },
    0,
  );
  await record(
    "planner.status.json",
    { role: "planner", model: "claude-opus-4-8", answer: { kind: "plan", tickets: [] } },
    1,
  );
  await record(
    "implementer-101.status.json",
    { role: "implementer-101", model: "claude-sonnet-5", answer: { kind: "done" } },
    2,
  );
  await record(
    "ticketReview-101.status.json",
    {
      role: "ticketReview-101",
      model: "claude-opus-4-8",
      answer: { spec: [specFinding.summary], standards: [standardsFinding.summary] },
    },
    3,
  );
  await record("101-ticketReview.json", [specFinding, standardsFinding], 3);
  await record(
    "fixer-101.status.json",
    { role: "fixer-101", model: "claude-sonnet-5", answer: [] },
    4,
  );
  await record(
    "fixer-101.verdicts.json",
    [
      { id: "spec-1", finding: specFinding, verdict: { kind: "fixed" } },
      {
        id: "standards-1",
        finding: standardsFinding,
        verdict: { kind: "skipped", reason: "the name matches the repo's own convention" },
      },
    ],
    4,
  );
  await record("branch-rereview-branchReview.json", [rereviewFinding], 5);
}

describe("digestRecords", () => {
  it("names every leg that recorded, with its role, its model and its status", async () => {
    await passRecords();

    const digest = await digestRecords(dir);

    expect(digest).toContain("gateResolver");
    expect(digest).toContain("claude-haiku-4-5");
    expect(digest).toMatch(/planner.*claude-opus-4-8.*plan/);
    expect(digest).toMatch(/implementer-101.*claude-sonnet-5.*done/);
  });

  it("groups findings by axis, so a spec finding never reads as a standards one", async () => {
    await passRecords();

    const digest = await digestRecords(dir);

    const spec = digest.indexOf("spec (2)");
    const standards = digest.indexOf("standards (1)");
    expect(spec).toBeGreaterThan(-1);
    expect(standards).toBeGreaterThan(spec);
    expect(digest.slice(spec, standards)).toContain(specFinding.summary);
    expect(digest.slice(standards)).toContain(standardsFinding.summary);
  });

  it("carries the fixer's verdict for each finding it was handed", async () => {
    await passRecords();

    const digest = await digestRecords(dir);

    expect(digest).toMatch(/spec-1 +fixed/);
    expect(digest).toMatch(/standards-1 +skipped/);
  });

  it("carries the reason the fixer gave where it declined", async () => {
    await passRecords();

    const digest = await digestRecords(dir);

    expect(digest).toContain("the name matches the repo's own convention");
  });

  it("lists the finding the fixer declined and the one the re-review raised", async () => {
    await passRecords();

    const digest = await digestRecords(dir);

    const unaddressed = digest.slice(digest.indexOf("Unaddressed findings"));
    expect(unaddressed).toContain(standardsFinding.summary);
    expect(unaddressed).toContain(rereviewFinding.summary);
    expect(unaddressed).not.toContain(specFinding.summary);
  });

  it("presents each leg's duration as approximate, derived from record mtimes", async () => {
    await passRecords();

    const digest = await digestRecords(dir);

    expect(digest).toContain("approximate");
    expect(digest).toMatch(/planner.*~60\.0s/);
  });

  it("names a record it could not parse and renders the rest of the digest", async () => {
    await passRecords();
    await record("reviewer-202.status.json", "{ not json", 6);

    const digest = await digestRecords(dir);

    expect(digest).toContain("reviewer-202.status.json");
    expect(digest).toContain("planner");
  });

  it("names a record whose shape it did not recognise", async () => {
    await passRecords();
    await record("lander.status.json", { role: "lander" }, 6);

    const digest = await digestRecords(dir);

    expect(digest.slice(digest.indexOf("Unparseable records"))).toContain("lander.status.json");
  });

  it("says the record directory is empty rather than throwing", async () => {
    const digest = await digestRecords(dir);

    expect(digest).toContain("empty");
  });

  it("says the record directory is absent rather than throwing", async () => {
    await rm(dir, { recursive: true });

    const digest = await digestRecords(dir);

    expect(digest).toContain("absent");
  });
});
