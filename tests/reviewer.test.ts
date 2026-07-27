import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Sandbox, SandboxRunOptions, SandboxRunResult } from "@ai-hero/sandcastle";
import { beforeEach, describe, expect, it } from "vitest";
import { relayConfigSchema } from "../src/config.js";
import type { ReviewLens, ReviewScope } from "../src/crew.js";
import { RoleError } from "../src/errors.js";
import { createReviewer, FINDINGS_TAG } from "../src/reviewer.js";
import { TRACKER_DOC_PATH } from "../src/tracker-doc.js";

const config = relayConfigSchema.parse({
  defaultBranch: "main",
});

const ticketScope: ReviewScope = {
  kind: "ticket",
  ticket: { number: 8, summary: "the schema" },
  base: "c0ffee",
};
const branchScope: ReviewScope = { kind: "branch", workItem: 7 };

let recordDir: string;

beforeEach(async () => {
  recordDir = await mkdtemp(join(tmpdir(), "relay-findings-"));
});

/**
 * A sandbox whose only real behaviour is the stdout one review run returns and
 * what `git status --porcelain` says the worktree looks like afterwards.
 */
function fakeSandbox(stdout: string, commits: { sha: string }[], worktree: string) {
  const runs: SandboxRunOptions[] = [];
  const sandbox = {
    async run(options: SandboxRunOptions): Promise<SandboxRunResult> {
      runs.push(options);
      return { iterations: [], stdout, commits };
    },
    async exec() {
      return { stdout: worktree, stderr: "", exitCode: 0 };
    },
  } as unknown as Sandbox;
  return { sandbox, runs };
}

const reviewing = (stdout: string, commits: { sha: string }[] = [], worktree = "") => {
  const { sandbox, runs } = fakeSandbox(stdout, commits, worktree);
  return { review: createReviewer({ sandbox, config, recordDir }), runs };
};

const taggedFindings = (json: string) =>
  `Read the diff.\n<${FINDINGS_TAG}>${json}</${FINDINGS_TAG}>`;

const commandOf = (run: SandboxRunOptions | undefined) =>
  run?.agent.buildPrintCommand({ prompt: "", dangerouslySkipPermissions: true }).command;

const findingsFile = (name: string) =>
  readFile(join(recordDir, name), "utf8").then((text) => JSON.parse(text) as unknown);

describe("createReviewer", () => {
  it("stamps each finding with its lens and the ticket it is about", async () => {
    const { review } = reviewing(
      taggedFindings('["src/a.ts:3 duplicated parsing","src/b.ts:9 dead branch"]'),
    );

    await expect(review("fastCodeReview", ticketScope)).resolves.toEqual([
      { source: "fastCodeReview", ticket: 8, summary: "src/a.ts:3 duplicated parsing" },
      { source: "fastCodeReview", ticket: 8, summary: "src/b.ts:9 dead branch" },
    ]);
  });

  it("leaves a whole-branch finding without a ticket", async () => {
    const { review } = reviewing(taggedFindings('["the two loaders should be one"]'));

    await expect(review("inDepthCodeReview", branchScope)).resolves.toEqual([
      { source: "inDepthCodeReview", summary: "the two loaders should be one" },
    ]);
  });

  it("reads a clean review as no findings", async () => {
    const { review } = reviewing(taggedFindings("[]"));

    await expect(review("fastSpecReview", ticketScope)).resolves.toEqual([]);
  });

  it("refuses a run that reported no findings block", async () => {
    const { review } = reviewing("I read it all and had some thoughts.");

    await expect(review("fastCodeReview", ticketScope)).rejects.toThrow(RoleError);
  });

  it("refuses a finding with nothing in it", async () => {
    const { review } = reviewing(taggedFindings('[""]'));

    await expect(review("fastCodeReview", ticketScope)).rejects.toThrow(RoleError);
  });

  it("refuses a lens that committed, since every lens is read-only", async () => {
    const { review } = reviewing(taggedFindings("[]"), [{ sha: "beef" }]);

    await expect(review("fastCodeReview", ticketScope)).rejects.toThrow(RoleError);
  });

  it("refuses a lens that edited without committing, which the next leg would inherit", async () => {
    const { review } = reviewing(taggedFindings("[]"), [], " M src/a.ts\n?? notes.md");

    await expect(review("fastCodeReview", ticketScope)).rejects.toThrow(
      /left the worktree changed/,
    );
  });

  it("writes each lens's findings to its own file for the harness to merge", async () => {
    const { review } = reviewing(taggedFindings('["src/a.ts:3 duplicated parsing"]'));

    await review("fastSpecReview", ticketScope);
    await review("inDepthSpecReview", branchScope);

    await expect(findingsFile("8-fastSpecReview.json")).resolves.toEqual([
      { source: "fastSpecReview", ticket: 8, summary: "src/a.ts:3 duplicated parsing" },
    ]);
    await expect(findingsFile("branch-inDepthSpecReview.json")).resolves.toEqual([
      { source: "inDepthSpecReview", summary: "src/a.ts:3 duplicated parsing" },
    ]);
  });

  it("runs the code lenses one-shot on their own model, at their own depth", async () => {
    const { review, runs } = reviewing(taggedFindings("[]"));

    await review("fastCodeReview", ticketScope);
    await review("inDepthCodeReview", branchScope);

    expect(runs).toHaveLength(2);
    expect(runs[0]?.maxIterations).toBe(1);
    expect(commandOf(runs[0])).toContain(`--model '${config.models.fastCodeReview}'`);
    expect(commandOf(runs[1])).toContain(`--model '${config.models.inDepthCodeReview}'`);
    expect(runs[0]?.promptArgs).toEqual({
      SCOPE: "ticket",
      ITEM: "#8",
      BASE: "c0ffee",
      DEPTH: "fast",
    });
    expect(runs[1]?.promptArgs).toEqual({
      SCOPE: "branch",
      ITEM: "#7",
      BASE: config.defaultBranch,
      DEPTH: "full",
    });
    expect(runs[0]?.prompt).toContain("kipu-all:kipu-code-review");
  });

  it("sends the spec lenses to the tracker doc for the intent", async () => {
    const { review, runs } = reviewing(taggedFindings("[]"));

    await review("fastSpecReview", ticketScope);
    await review("inDepthSpecReview", branchScope);

    expect(commandOf(runs[0])).toContain(`--model '${config.models.fastSpecReview}'`);
    expect(commandOf(runs[1])).toContain(`--model '${config.models.inDepthSpecReview}'`);
    expect(runs[0]?.promptArgs).toEqual({
      SCOPE: "ticket",
      ITEM: "#8",
      BASE: "c0ffee",
      TRACKER_DOC: TRACKER_DOC_PATH,
    });
    expect(runs[0]?.prompt).toContain("kipu-all:kipu-spec-review");
    expect(runs[0]?.prompt).toContain("{{TRACKER_DOC}}");
  });

  it("names each run for the lens and what it read, so each lens gets its own findings file", async () => {
    const { review, runs } = reviewing(taggedFindings("[]"));

    await review("fastCodeReview", ticketScope);
    await review("inDepthCodeReview", branchScope);

    expect(runs[0]?.name).toBe("fastCodeReview-8");
    expect(runs[1]?.name).toBe("inDepthCodeReview-branch");
  });

  it("tells every lens it is read-only", async () => {
    const { review, runs } = reviewing(taggedFindings("[]"));

    const lenses: ReviewLens[] = ["fastCodeReview", "fastSpecReview"];
    for (const lens of lenses) await review(lens, ticketScope);

    for (const run of runs) expect(run.prompt).toContain("read-only");
  });
});
