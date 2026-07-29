import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Sandbox, SandboxRunOptions, SandboxRunResult } from "@ai-hero/sandcastle";
import { beforeEach, describe, expect, it } from "vitest";
import { relayConfigSchema } from "../../../src/config.js";
import type { ReviewScope } from "../../../src/crew/contract.js";
import { RoleError } from "../../../src/errors.js";
import { createReviewer, FINDINGS_TAG } from "../../../src/crew/roles/reviewer.js";
import { readResource } from "../../../src/resources.js";
import { TRACKER_DOC_PATH } from "../../../src/tracker/tracker-doc.js";
import { expectPromptParity } from "./prompt-parity.js";

const config = relayConfigSchema.parse({ landing: "pull-request" });
const baseBranch = "main";

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
  return { review: createReviewer({ sandbox, config, recordDir, baseBranch }), runs };
};

const taggedFindings = (json: string) =>
  `Read the diff.\n<${FINDINGS_TAG}>${json}</${FINDINGS_TAG}>`;

const commandOf = (run: SandboxRunOptions | undefined) =>
  run?.agent.buildPrintCommand({ prompt: "", dangerouslySkipPermissions: true }).command;

const findingsFile = (name: string) =>
  readFile(join(recordDir, name), "utf8").then((text) => JSON.parse(text) as unknown);

describe("createReviewer", () => {
  it("stamps each finding with its review and the ticket it is about", async () => {
    const { review } = reviewing(
      taggedFindings('["src/a.ts:3 duplicated parsing","src/b.ts:9 dead branch"]'),
    );

    await expect(review(ticketScope)).resolves.toEqual([
      { source: "ticketReview", ticket: 8, summary: "src/a.ts:3 duplicated parsing" },
      { source: "ticketReview", ticket: 8, summary: "src/b.ts:9 dead branch" },
    ]);
  });

  it("leaves a whole-branch finding without a ticket", async () => {
    const { review } = reviewing(taggedFindings('["the two loaders should be one"]'));

    await expect(review(branchScope)).resolves.toEqual([
      { source: "branchReview", summary: "the two loaders should be one" },
    ]);
  });

  it("reads a clean review as no findings", async () => {
    const { review } = reviewing(taggedFindings("[]"));

    await expect(review(ticketScope)).resolves.toEqual([]);
  });

  it("refuses a run that reported no findings block", async () => {
    const { review } = reviewing("I read it all and had some thoughts.");

    await expect(review(ticketScope)).rejects.toThrow(RoleError);
  });

  it("refuses a finding with nothing in it", async () => {
    const { review } = reviewing(taggedFindings('[""]'));

    await expect(review(ticketScope)).rejects.toThrow(RoleError);
  });

  it("refuses a review that committed, since every review is read-only", async () => {
    const { review } = reviewing(taggedFindings("[]"), [{ sha: "beef" }]);

    await expect(review(ticketScope)).rejects.toThrow(RoleError);
  });

  it("refuses a review that edited without committing, which the next leg would inherit", async () => {
    const { review } = reviewing(taggedFindings("[]"), [], " M src/a.ts\n?? notes.md");

    await expect(review(ticketScope)).rejects.toThrow(/left the worktree changed/);
  });

  it("writes each review's findings to its own file", async () => {
    const { review } = reviewing(taggedFindings('["src/a.ts:3 duplicated parsing"]'));

    await review(ticketScope);
    await review(branchScope);

    await expect(findingsFile("8-ticketReview.json")).resolves.toEqual([
      { source: "ticketReview", ticket: 8, summary: "src/a.ts:3 duplicated parsing" },
    ]);
    await expect(findingsFile("branch-branchReview.json")).resolves.toEqual([
      { source: "branchReview", summary: "src/a.ts:3 duplicated parsing" },
    ]);
  });

  it("runs the ticket review one-shot on its own model, over the ticket's own diff", async () => {
    const { review, runs } = reviewing(taggedFindings("[]"));

    await review(ticketScope);

    expect(runs).toHaveLength(1);
    expect(runs[0]?.maxIterations).toBe(1);
    expect(commandOf(runs[0])).toContain(`--model '${config.models.ticketReview}'`);
    expect(runs[0]?.promptArgs).toEqual({
      SCOPE: "ticket",
      ITEM: "#8",
      BASE: "c0ffee",
      TRACKER_DOC: TRACKER_DOC_PATH,
    });
    await expectPromptParity(runs[0], "review.md");
  });

  it("runs the branch review on its own model, over the whole branch", async () => {
    const { review, runs } = reviewing(taggedFindings("[]"));

    await review(branchScope);

    expect(commandOf(runs[0])).toContain(`--model '${config.models.branchReview}'`);
    expect(runs[0]?.promptArgs).toEqual({
      SCOPE: "branch",
      ITEM: "#7",
      BASE: baseBranch,
      TRACKER_DOC: TRACKER_DOC_PATH,
    });
    await expectPromptParity(runs[0], "review.md");
  });

  it("names each run for its scope, so each gets its own findings file", async () => {
    const { review, runs } = reviewing(taggedFindings("[]"));

    await review(ticketScope);
    await review(branchScope);

    expect(runs[0]?.name).toBe("ticketReview-8");
    expect(runs[1]?.name).toBe("branchReview-branch");
  });
});

/**
 * The review's behaviour lives in its prompt, so what that prompt instructs is
 * the only thing there is to assert about how it reads the diff.
 */
describe("the review prompt", () => {
  it("tells the review it is read-only", async () => {
    expect(await readResource("review.md")).toContain("read-only");
  });

  it("runs the review under the skill that is mounted for it", async () => {
    expect(await readResource("review.md")).toContain("mattpocock-skills:code-review");
  });

  it("names no skill relay would have to ship itself", async () => {
    expect(await readResource("review.md")).not.toContain("relay-skills:");
  });

  it("translates the skill's report into relay's findings", async () => {
    const prompt = await readResource("review.md");
    expect(prompt).toContain("## Standards");
    expect(prompt).toContain("`<relay-findings>`");
  });
});
