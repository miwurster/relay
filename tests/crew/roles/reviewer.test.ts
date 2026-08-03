import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Sandbox, SandboxRunOptions, SandboxRunResult } from "@ai-hero/sandcastle";
import { beforeEach, describe, expect, it } from "vitest";
import { relayConfigSchema } from "../../../src/config.js";
import type { Finding, ReviewScope } from "../../../src/crew/contract.js";
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
const branchScope: ReviewScope = {
  kind: "branch",
  workItem: 7,
  axes: "spec",
  verifying: undefined,
};
const fixed: Finding = {
  source: "branch-review",
  axis: "spec",
  summary: "src/a.ts:3 the cap is read from the wrong key",
};
const rereviewScope: ReviewScope = {
  kind: "branch",
  workItem: 7,
  axes: "spec",
  verifying: [fixed],
};
const bothAxesBranchScope: ReviewScope = {
  kind: "branch",
  workItem: 7,
  axes: "both",
  verifying: undefined,
};
const qualityScope: ReviewScope = { kind: "quality", workItem: 7, settled: [] };
const settled: Finding = {
  source: "branch-review",
  axis: "standards",
  summary: "src/todo-list.ts:54 — extract the trim into a shared helper",
};
const settledQualityScope: ReviewScope = { kind: "quality", workItem: 7, settled: [settled] };

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
  const execs: string[] = [];
  const sandbox = {
    async run(options: SandboxRunOptions): Promise<SandboxRunResult> {
      runs.push(options);
      return { iterations: [], stdout, commits };
    },
    async exec(command: string) {
      execs.push(command);
      return { stdout: worktree, stderr: "", exitCode: 0 };
    },
  } as unknown as Sandbox;
  return { sandbox, runs, execs };
}

const reviewing = (stdout: string, commits: { sha: string }[] = [], worktree = "") => {
  const { sandbox, runs, execs } = fakeSandbox(stdout, commits, worktree);
  return { review: createReviewer({ sandbox, config, recordDir, baseBranch }), runs, execs };
};

const taggedFindings = (json: string) =>
  `Read the diff.\n<${FINDINGS_TAG}>${json}</${FINDINGS_TAG}>`;

const commandOf = (run: SandboxRunOptions | undefined) =>
  run?.agent.buildPrintCommand({ prompt: "", dangerouslySkipPermissions: true }).command;

const findingsFile = (name: string) =>
  readFile(join(recordDir, name), "utf8").then((text) => JSON.parse(text) as unknown);

// A clean answer per scope, since each is asked for its own axes and nothing else.
const cleanTicket = taggedFindings('{"standards":[],"spec":[]}');
const cleanBranch = taggedFindings('{"spec":[]}');
const cleanQuality = taggedFindings('{"quality":[]}');

describe("createReviewer", () => {
  it("stamps each finding with its review, its axis and the ticket it is about", async () => {
    const { review } = reviewing(
      taggedFindings(
        '{"standards":["src/a.ts:3 duplicated parsing"],"spec":["src/b.ts:9 no cap"]}',
      ),
    );

    await expect(review(ticketScope)).resolves.toEqual([
      { source: "ticket-review", axis: "spec", ticket: 8, summary: "src/b.ts:9 no cap" },
      {
        source: "ticket-review",
        axis: "standards",
        ticket: 8,
        summary: "src/a.ts:3 duplicated parsing",
      },
    ]);
  });

  it("reports the binding axis first, since that is the one the fixer should read first", async () => {
    const { review } = reviewing(taggedFindings('{"standards":["a","b"],"spec":["c"]}'));

    const findings = await review(ticketScope);

    expect(findings.map(({ summary }) => summary)).toEqual(["c", "a", "b"]);
  });

  it("leaves a whole-branch finding without a ticket", async () => {
    const { review } = reviewing(taggedFindings('{"spec":["the cap is read from the wrong key"]}'));

    await expect(review(branchScope)).resolves.toEqual([
      { source: "branch-review", axis: "spec", summary: "the cap is read from the wrong key" },
    ]);
  });

  it("reads a clean review as no findings", async () => {
    const { review } = reviewing(cleanTicket);

    await expect(review(ticketScope)).resolves.toEqual([]);
  });

  it("refuses a run that reported no findings block", async () => {
    const { review } = reviewing("I read it all and had some thoughts.");

    await expect(review(ticketScope)).rejects.toThrow(RoleError);
  });

  it("refuses a finding with nothing in it", async () => {
    const { review } = reviewing(taggedFindings('{"standards":[""],"spec":[]}'));

    await expect(review(ticketScope)).rejects.toThrow(RoleError);
  });

  it("refuses an answer that left an axis out, rather than reading it as empty", async () => {
    const { review } = reviewing(taggedFindings('{"standards":["src/a.ts:3 dead"]}'));

    await expect(review(ticketScope)).rejects.toThrow(RoleError);
  });

  it("refuses the flat array a review used to report", async () => {
    const { review } = reviewing(taggedFindings('["src/a.ts:3 dead"]'));

    await expect(review(ticketScope)).rejects.toThrow(RoleError);
  });

  it("refuses a review that committed, since every review is read-only", async () => {
    const { review } = reviewing(cleanTicket, [{ sha: "beef" }]);

    await expect(review(ticketScope)).rejects.toThrow(RoleError);
  });

  it("discards what a review edited without committing, which the next leg would inherit", async () => {
    const { review, execs } = reviewing(cleanTicket, [], " M src/a.ts\n?? notes.md");

    await expect(review(ticketScope)).resolves.toEqual([]);
    expect(execs).toContain("git checkout -- . && git clean -fd");
  });

  it("writes each review's findings to its own file", async () => {
    const ticketRun = reviewing(taggedFindings('{"standards":["src/a.ts:3 dead"],"spec":[]}'));
    const branchRun = reviewing(taggedFindings('{"spec":["src/b.ts:9 no cap"]}'));

    await ticketRun.review(ticketScope);
    await branchRun.review(branchScope);

    await expect(findingsFile("8-ticket-review.json")).resolves.toEqual([
      { source: "ticket-review", axis: "standards", ticket: 8, summary: "src/a.ts:3 dead" },
    ]);
    await expect(findingsFile("branch-review.json")).resolves.toEqual([
      { source: "branch-review", axis: "spec", summary: "src/b.ts:9 no cap" },
    ]);
  });

  it("keeps the re-review's findings file apart from the review it re-reads", async () => {
    const { review } = reviewing(taggedFindings('{"spec":["src/a.ts:3 still wrong"]}'));

    await review(branchScope);
    await review(rereviewScope);

    await expect(findingsFile("branch-review.json")).resolves.toHaveLength(1);
    await expect(findingsFile("branch-review-rereview.json")).resolves.toHaveLength(1);
  });

  it("runs the ticket review one-shot on its own model, over the ticket's own diff", async () => {
    const { review, runs } = reviewing(cleanTicket);

    await review(ticketScope);

    expect(runs).toHaveLength(1);
    expect(runs[0]?.maxIterations).toBe(1);
    expect(commandOf(runs[0])).toContain(`--model '${config.models["ticket-review"]}'`);
    expect(runs[0]?.promptArgs).toMatchObject({
      SCOPE: "ticket",
      ITEM: "#8",
      BASE: "c0ffee",
      TRACKER_DOC: TRACKER_DOC_PATH,
    });
    await expectPromptParity(runs[0], "review.md");
  });

  it("asks a ticket for both axes, and for both keys back", async () => {
    const { review, runs } = reviewing(cleanTicket);

    await review(ticketScope);

    expect(runs[0]?.promptArgs?.["AXES"]).toContain("Both axes");
    expect(runs[0]?.promptArgs?.["ANSWER"]).toContain("`standards` array");
  });

  it("runs the branch review on its own model, over the whole branch", async () => {
    const { review, runs } = reviewing(cleanBranch);

    await review(branchScope);

    expect(commandOf(runs[0])).toContain(`--model '${config.models["branch-review"]}'`);
    expect(runs[0]?.promptArgs).toMatchObject({
      SCOPE: "branch",
      ITEM: "#7",
      BASE: baseBranch,
      TRACKER_DOC: TRACKER_DOC_PATH,
    });
    await expectPromptParity(runs[0], "review.md");
  });

  it("asks the whole branch for the spec axis alone where every ticket was reviewed", async () => {
    const { review, runs } = reviewing(cleanBranch);

    await review(branchScope);

    expect(runs[0]?.promptArgs?.["AXES"]).toContain("The `spec` axis only");
    expect(runs[0]?.promptArgs?.["AXES"]).not.toContain("Both axes");
  });

  it("asks the whole branch for a spec key and no other, so an empty one means found nothing", async () => {
    const { review, runs } = reviewing(cleanBranch);

    await review(branchScope);

    expect(runs[0]?.promptArgs?.["ANSWER"]).toContain("no other key");
    expect(runs[0]?.promptArgs?.["ANSWER"]).not.toContain('"standards": []');
  });

  it("refuses a branch review that answered on an axis it was not asked for", async () => {
    const { review } = reviewing(taggedFindings('{"spec":[],"standards":[]}'));

    await expect(review(branchScope)).rejects.toThrow(RoleError);
  });

  it("asks the whole branch for both axes where no ticket review ran", async () => {
    const { review, runs } = reviewing(cleanTicket);

    await review(bothAxesBranchScope);

    expect(runs[0]?.promptArgs?.["AXES"]).toContain("Both axes");
    expect(runs[0]?.promptArgs?.["ANSWER"]).toContain("`standards` array");
    await expectPromptParity(runs[0], "review.md");
  });

  it("stamps a branch review's standards finding with the branch review as its source", async () => {
    const { review } = reviewing(
      taggedFindings('{"spec":[],"standards":["src/a.ts:3 duplicated parsing"]}'),
    );

    await expect(review(bothAxesBranchScope)).resolves.toEqual([
      {
        source: "branch-review",
        axis: "standards",
        ticket: undefined,
        summary: "src/a.ts:3 duplicated parsing",
      },
    ]);
  });

  it("refuses a both-axes branch review that answered on spec alone", async () => {
    const { review } = reviewing(cleanBranch);

    await expect(review(bothAxesBranchScope)).rejects.toThrow(RoleError);
  });

  it("names each run for its scope, so each gets its own findings file", async () => {
    const { review, runs } = reviewing(cleanBranch);

    await review(branchScope);
    await review(rereviewScope);

    expect(runs.map((run) => run.name)).toEqual(["branch-review", "branch-review-rereview"]);
  });

  it("runs the re-review on the branch review's model, over the same diff", async () => {
    const { review, runs } = reviewing(cleanBranch);

    await review(rereviewScope);

    expect(commandOf(runs[0])).toContain(`--model '${config.models["branch-review"]}'`);
    expect(runs[0]?.promptArgs).toMatchObject({ ITEM: "#7", BASE: baseBranch });
  });

  /**
   * The whole of ADR-0032: the re-review reads its own prompt, and what it is
   * asked about is the fixer's claims rather than the branch.
   */
  it("hands the re-review the findings the fixer said it fixed, and its own prompt", async () => {
    const { review, runs } = reviewing(cleanBranch);

    await review(rereviewScope);

    expect(runs[0]?.promptArgs?.["FIXES"]).toContain(fixed.summary);
    expect(runs[0]?.promptArgs?.["FIXES"]).toContain('"axis": "spec"');
    await expectPromptParity(runs[0], "rereview.md");
  });

  it("answers the re-review in the same axis shape as the review it verifies", async () => {
    const { review } = reviewing(taggedFindings('{"spec":["src/a.ts:3 still reads legacyCap"]}'));

    await expect(review(rereviewScope)).resolves.toEqual([
      { source: "branch-review", axis: "spec", summary: "src/a.ts:3 still reads legacyCap" },
    ]);
  });
});

/**
 * The quality scope is the same role over a rubric relay vendors rather than
 * authors: its own prompt, its own model and its own axis, and nothing else about
 * the leg differs
 * ([ADR-0027](../../../docs/adr/0027-the-branch-review-splits-into-a-spec-review-and-a-quality-review.md)).
 */
describe("createReviewer over the quality scope", () => {
  it("stamps its findings with the quality axis and no ticket", async () => {
    const { review } = reviewing(
      taggedFindings('{"quality":["src/a.ts — the two loaders should be one module"]}'),
    );

    await expect(review(qualityScope)).resolves.toEqual([
      {
        source: "quality-review",
        axis: "quality",
        summary: "src/a.ts — the two loaders should be one module",
      },
    ]);
  });

  it("reads a branch with nothing structural to answer for as no findings", async () => {
    const { review } = reviewing(cleanQuality);

    await expect(review(qualityScope)).resolves.toEqual([]);
  });

  it("refuses the spec review's shape, which is not the question it was asked", async () => {
    const { review } = reviewing(cleanTicket);

    await expect(review(qualityScope)).rejects.toThrow(RoleError);
  });

  it("refuses a finding with nothing in it", async () => {
    const { review } = reviewing(taggedFindings('{"quality":[""]}'));

    await expect(review(qualityScope)).rejects.toThrow(RoleError);
  });

  it("discards the restructuring a review started rather than describing", async () => {
    const { review, execs } = reviewing(cleanQuality, [], " M src/a.ts");

    await expect(review(qualityScope)).resolves.toEqual([]);
    expect(execs).toContain("git checkout -- . && git clean -fd");
  });

  it("writes its findings to a file of its own", async () => {
    const { review } = reviewing(taggedFindings('{"quality":["split the harness"]}'));

    await review(qualityScope);

    await expect(findingsFile("quality-review.json")).resolves.toEqual([
      { source: "quality-review", axis: "quality", summary: "split the harness" },
    ]);
  });

  it("runs one-shot on its own model and prompt, with the rubric inlined", async () => {
    const { review, runs } = reviewing(cleanQuality);

    await review(qualityScope);

    expect(runs).toHaveLength(1);
    expect(runs[0]?.maxIterations).toBe(1);
    expect(runs[0]?.name).toBe("quality-review");
    expect(commandOf(runs[0])).toContain(`--model '${config.models["quality-review"]}'`);
    expect(runs[0]?.promptArgs).toMatchObject({ ITEM: "#7", BASE: baseBranch });
    expect(String(runs[0]?.promptArgs?.["RUBRIC"])).toContain("Thermo-Nuclear Code Quality Review");
    await expectPromptParity(runs[0], "quality-review.md");
  });

  /**
   * The whole of ADR-0034, and the mirror of the re-review's `FIXES` argument:
   * what an earlier fixer acted on reaches this prompt, in the same stripped
   * shape and for the same reason.
   */
  it("hands it the findings a fixer already acted on this pass", async () => {
    const { review, runs } = reviewing(cleanQuality);

    await review(settledQualityScope);

    expect(runs[0]?.promptArgs?.["SETTLED"]).toContain(settled.summary);
    expect(runs[0]?.promptArgs?.["SETTLED"]).toContain('"axis": "standards"');
    expect(runs[0]?.promptArgs?.["SETTLED"]).not.toContain("branch-review");
  });

  it("carries the settled list empty rather than absent when the pass fixed nothing", async () => {
    const { review, runs } = reviewing(cleanQuality);

    await review(qualityScope);

    expect(runs[0]?.promptArgs?.["SETTLED"]).toBe("[]");
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

  it("tells the review to keep each finding on the axis it came from", async () => {
    const prompt = await readResource("review.md");
    expect(prompt).toContain("never move one to the other");
  });

  it("sends a problem both axes name to the binding one, so nothing is softened by a coin flip", async () => {
    expect(await readResource("review.md")).toContain(
      "**Where both sections name the same problem, report it once, under `spec`.**",
    );
  });

  it("leaves the shape of the answer to the scope that is asking", async () => {
    expect(await readResource("review.md")).toContain("{{ANSWER}}");
  });

  it("keeps the graph relay's own, whatever the tracker doc calls a relation", async () => {
    const prompt = await readResource("review.md");
    expect(prompt).toContain("never what the graph is");
    expect(prompt).toContain("A task list in a body");
    expect(prompt).not.toContain("per the relation model the tracker doc describes");
  });
});

/**
 * What the quality scope does lives in its prompt and in the rubric that prompt
 * carries, so what both say is the only thing there is to assert about how it reads.
 */
describe("the quality review prompt", () => {
  it("tells the review it is read-only", async () => {
    expect(await readResource("quality-review.md")).toContain("read-only");
  });

  it("carries the rubric in, rather than sending the leg to a file relay ships", async () => {
    const prompt = await readResource("quality-review.md");
    expect(prompt).toContain("{{RUBRIC}}");
    expect(prompt).not.toContain("src/resources/skills");
  });

  it("names no skill the sandbox would have to have mounted", async () => {
    const prompt = await readResource("quality-review.md");
    expect(prompt).not.toContain("mattpocock-skills:");
    expect(prompt).not.toContain("cursor-team-kit:");
  });

  it("closes the spec question rather than reopening it", async () => {
    expect(await readResource("quality-review.md")).toContain("not yours to reopen");
  });

  it("takes the rubric's severity but neither its approval nor its tone", async () => {
    const prompt = await readResource("quality-review.md");
    expect(prompt).toContain("You do not approve or block");
    expect(prompt).toContain("You do not write review tone");
  });

  it("lets the rubric reach past the diff, but not past what this branch caused", async () => {
    const prompt = await readResource("quality-review.md");
    expect(prompt).toContain("deliberately not bounded by that diff");
    expect(prompt).toContain("is not this pass's to answer for");
  });

  it("tells it what the pass already settled, as decisions rather than suggestions", async () => {
    const prompt = await readResource("quality-review.md");
    expect(prompt).toContain("{{SETTLED}}");
    expect(prompt).toContain("decisions, not suggestions");
  });

  it("lets it overrule a settled remedy only by naming what it overrules and why", async () => {
    const prompt = await readResource("quality-review.md");
    expect(prompt).toContain(
      "**A finding that undoes a settled remedy must name the settled finding it overrules and say why that earlier call was wrong**",
    );
  });

  it("asks for one quality array, and nothing the spec review answers", async () => {
    const prompt = await readResource("quality-review.md");
    expect(prompt).toContain("`quality` array");
    expect(prompt).toContain("`<relay-findings>`");
  });
});

describe("the vendored rubric", () => {
  const rubric = () => readResource("skills", "thermo-nuclear-code-quality-review.md");

  it("says where it came from, at which commit, and under which licence", async () => {
    const text = await rubric();
    expect(text).toContain("github.com/cursor/plugins");
    expect(text).toContain("6e3d2ea56d7d446b955eaae6ac4c8eef8bf504cf");
    expect(text).toContain("MIT License");
    expect(text).toContain("Copyright (c) 2026 Cursor");
  });

  it("drops the frontmatter of a skill nothing loads as one", async () => {
    expect(await rubric()).not.toMatch(/^---$/m);
  });

  it("still carries the rules relay vendored it for", async () => {
    const text = await rubric();
    expect(text).toContain("code judo");
    expect(text).toContain("1000 lines");
  });
});
