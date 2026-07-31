import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Sandbox, SandboxRunOptions, SandboxRunResult } from "@ai-hero/sandcastle";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { relayConfigSchema } from "../../../src/config.js";
import {
  type LandResult,
  NO_LANDING,
  type Outcome,
  type TicketRef,
  type UnaddressedFinding,
} from "../../../src/crew/contract.js";
import { RoleError } from "../../../src/errors.js";
import { readResource } from "../../../src/resources.js";
import { createHandover, HANDOVER_TAG } from "../../../src/crew/roles/handover.js";
import { TRACKER_DOC_PATH } from "../../../src/tracker/tracker-doc.js";
import { expectPromptParity } from "./prompt-parity.js";

const config = relayConfigSchema.parse({ landing: "pull-request" });
const mergeConfig = relayConfigSchema.parse({ landing: "merge" });

const workItem = 7;
const branch = "agent/7";
const baseBranch = "main";

/** A sandbox whose handover run has a fixed stdout and commit count. */
function handing({ stdout = "", commits = [] as { sha: string }[], withConfig = config } = {}) {
  const runs: SandboxRunOptions[] = [];
  const sandbox = {
    async run(options: SandboxRunOptions): Promise<SandboxRunResult> {
      runs.push(options);
      return { iterations: [], stdout, commits };
    },
  } as unknown as Sandbox;

  const handover = createHandover({
    sandbox,
    config: withConfig,
    recordDir,
    workItem,
    branch,
    baseBranch,
  });

  return {
    // A pass that left nothing unaddressed is the ordinary one, so it is the
    // default here and only the tests about that list pass one — and such a pass
    // finished everything it committed, which is the default for the same reason.
    handover: (
      outcome: Outcome,
      committed: readonly TicketRef[],
      land: LandResult,
      unaddressed: readonly UnaddressedFinding[] = [],
      finished: readonly TicketRef[] = committed,
    ) => handover(outcome, committed, finished, land, unaddressed),
    runs,
  };
}

const tagged = (json: string) => `Handed over.\n<${HANDOVER_TAG}>${json}</${HANDOVER_TAG}>`;

const published = tagged(
  '{"prUrl":"https://github.com/miwurster/relay/pull/12","report":"#7 is agent-in-review."}',
);

const success: Outcome = {
  kind: "success",
  detail: "`make test` exited 0 — declared in relay.config.ts.",
};
const midBlock: Outcome = { kind: "mid-block", reason: "the gate is still red" };
const earlyBail: Outcome = { kind: "early-bail", reason: "#7 has no acceptance criteria" };

/** What the pass committed: two tickets, or an empty branch. */
const tickets: TicketRef[] = [
  { number: 8, summary: "reject an empty cart" },
  { number: 9, summary: "price the cart" },
];
const nothing: TicketRef[] = [];

let recordDir: string;

beforeEach(async () => {
  recordDir = await mkdtemp(join(tmpdir(), "relay-handover-"));
});

describe("createHandover", () => {
  it("hands over in one leg, on the handover model", async () => {
    const { handover, runs } = handing({ stdout: published });

    await handover(success, tickets, NO_LANDING);

    expect(runs.map((run) => run.name)).toEqual(["handover"]);
    expect(
      runs[0]?.agent.buildPrintCommand({ prompt: "", dangerouslySkipPermissions: true }).command,
    ).toContain(`--model '${config.models.handover}'`);
  });

  it("tells the leg which outcome it is handing over, and on what", async () => {
    const { handover, runs } = handing({ stdout: published });

    await handover(success, tickets, NO_LANDING);

    expect(runs[0]?.promptArgs).toEqual({
      OUTCOME: "success",
      REASON: "`make test` exited 0 — declared in relay.config.ts.",
      PULL_REQUEST: "required",
      LANDING: "pull-request",
      LANDED: "no",
      LANDED_DETAIL: "nothing was landed",
      COMMITTED_TICKETS: "#8, #9",
      FINISHED_TICKETS: "#8, #9",
      BLOCKED_TICKETS: "nothing",
      UNADDRESSED: "none",
      RECORD_PATH: `.relay/${workItem}`,
      WORK_ITEM: `#${workItem}`,
      BRANCH: branch,
      BASE_BRANCH: baseBranch,
      TRACKER_DOC: TRACKER_DOC_PATH,
    });
    await expectPromptParity(runs[0], "handover.md");
  });

  it("names the committed tickets, which the leg cannot read out of the commits", async () => {
    const { handover, runs } = handing({ stdout: published });

    await handover(midBlock, [{ number: 8, summary: "reject an empty cart" }], NO_LANDING);

    expect(runs[0]?.promptArgs).toMatchObject({ COMMITTED_TICKETS: "#8" });
  });

  it("names the finished tickets apart from the committed ones, which a block leaves differing", async () => {
    const { handover, runs } = handing({
      stdout: tagged('{"report":"#7 blocked on #9; agent/7 pushed."}'),
      withConfig: mergeConfig,
    });

    await handover(
      midBlock,
      tickets,
      NO_LANDING,
      [],
      [{ number: 8, summary: "reject an empty cart" }],
    );

    expect(runs[0]?.promptArgs).toMatchObject({
      COMMITTED_TICKETS: "#8, #9",
      FINISHED_TICKETS: "#8",
    });
  });

  it("names the tickets that blocked, as the committed ones no review left finished", async () => {
    const { handover, runs } = handing({
      stdout: tagged('{"report":"#7 blocked on #9; agent/7 pushed."}'),
      withConfig: mergeConfig,
    });

    await handover(
      midBlock,
      tickets,
      NO_LANDING,
      [],
      [{ number: 8, summary: "reject an empty cart" }],
    );

    expect(runs[0]?.promptArgs).toMatchObject({ BLOCKED_TICKETS: "#9" });
  });

  it("names no blocking ticket when no committed ticket is at fault", async () => {
    const { handover, runs } = handing({
      stdout: tagged('{"report":"#7 blocked on the gate; agent/7 pushed."}'),
      withConfig: mergeConfig,
    });

    await handover(midBlock, tickets, NO_LANDING);

    expect(runs[0]?.promptArgs).toMatchObject({ BLOCKED_TICKETS: "nothing" });
  });

  it("tells a leg that finished nothing so, rather than leaving the list empty", async () => {
    const { handover, runs } = handing({
      stdout: tagged('{"report":"#7 blocked on #8; agent/7 pushed."}'),
      withConfig: mergeConfig,
    });

    await handover(midBlock, tickets, NO_LANDING, [], []);

    expect(runs[0]?.promptArgs).toMatchObject({ FINISHED_TICKETS: "nothing" });
  });

  it("tells a leg with an empty branch that it committed nothing", async () => {
    const { handover, runs } = handing({
      stdout: tagged('{"report":"#7 needs acceptance criteria; nothing was built."}'),
    });

    await handover(earlyBail, nothing, NO_LANDING);

    expect(runs[0]?.promptArgs).toMatchObject({ COMMITTED_TICKETS: "nothing" });
  });

  it("tells the leg the pull request rule relay will judge it by", async () => {
    const { handover, runs } = handing({
      stdout: tagged('{"report":"#7 blocked before it committed anything."}'),
    });

    await handover(midBlock, nothing, NO_LANDING);

    expect(runs[0]?.promptArgs).toMatchObject({ PULL_REQUEST: "forbidden" });
  });

  it("passes a blocked outcome's own reason on as the cause", async () => {
    const { handover, runs } = handing({ stdout: published });

    await handover(midBlock, tickets, NO_LANDING);

    expect(runs[0]?.promptArgs).toMatchObject({
      OUTCOME: "mid-block",
      REASON: "the gate is still red",
    });
  });

  it("reports the leg's report to the operator", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { handover } = handing({ stdout: published });

    await handover(success, tickets, NO_LANDING);

    const printed = log.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(printed).toContain("success");
    expect(printed).toContain("#7 is agent-in-review.");
    log.mockRestore();
  });

  it("reports what the leg did even when the leg broke its own rule", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    // The leg has already pushed, labelled and commented by the time relay
    // judges it, so the report is the human's only record of that.
    const { handover } = handing({ stdout: tagged('{"report":"#7 is agent-in-review."}') });

    await expect(handover(success, tickets, NO_LANDING)).rejects.toThrow(RoleError);

    expect(log).toHaveBeenCalledWith(expect.stringContaining("#7 is agent-in-review."));
    log.mockRestore();
  });

  it("hands an early bail over without a pull request", async () => {
    const { handover, runs } = handing({
      stdout: tagged('{"report":"#7 needs acceptance criteria; nothing was built."}'),
    });

    await handover(earlyBail, nothing, NO_LANDING);

    expect(runs[0]?.promptArgs).toMatchObject({ OUTCOME: "early-bail" });
  });

  it("refuses a success that opened no pull request", async () => {
    const { handover } = handing({ stdout: tagged('{"report":"#7 is agent-in-review."}') });

    await expect(handover(success, tickets, NO_LANDING)).rejects.toThrow(RoleError);
  });

  it("lets a mid-block on an empty branch hand over without a pull request", async () => {
    const { handover } = handing({
      stdout: tagged('{"report":"#7 blocked on its first ticket; nothing was committed."}'),
    });

    await expect(handover(midBlock, nothing, NO_LANDING)).resolves.toBeUndefined();
  });

  it("refuses a mid-block that left committed tickets unpublished", async () => {
    const { handover } = handing({
      stdout: tagged('{"report":"#7 blocked after two tickets; the branch was not pushed."}'),
    });

    await expect(handover(midBlock, tickets, NO_LANDING)).rejects.toThrow(RoleError);
  });

  it("refuses a mid-block that opened a pull request on an empty branch", async () => {
    const { handover } = handing({ stdout: published });

    await expect(handover(midBlock, nothing, NO_LANDING)).rejects.toThrow(RoleError);
  });

  it("refuses an early bail that opened a pull request on an empty branch", async () => {
    const { handover } = handing({ stdout: published });

    await expect(handover(earlyBail, nothing, NO_LANDING)).rejects.toThrow(RoleError);
  });

  it("refuses a handover that committed to the branch", async () => {
    const { handover } = handing({ stdout: published, commits: [{ sha: "c0ffee" }] });

    await expect(handover(success, tickets, NO_LANDING)).rejects.toThrow(RoleError);
  });

  it("leaves the leg's answer on the host, even when the leg broke its own rule", async () => {
    const { handover } = handing({ stdout: tagged('{"report":"#7 is agent-in-review."}') });

    await expect(handover(success, tickets, NO_LANDING)).rejects.toThrow(RoleError);

    const written = await readFile(join(recordDir, "handover.status.json"), "utf8");
    expect(JSON.parse(written)).toEqual({
      role: "handover",
      model: config.models.handover,
      answer: { report: "#7 is agent-in-review." },
    });
  });

  it("refuses a handover that reported nothing", async () => {
    const { handover } = handing({ stdout: "Pushed it." });

    await expect(handover(success, tickets, NO_LANDING)).rejects.toThrow(RoleError);
  });
});

describe("createHandover under merge landing", () => {
  const merging = (stdout: string) => handing({ stdout, withConfig: mergeConfig });

  const landed: LandResult = {
    kind: "landed",
    detail: "agent/7 was rebased onto main, which fast-forwarded onto it and was pushed.",
  };

  it("tells the leg the landing, the base branch, and that the work landed", async () => {
    const { handover, runs } = merging(tagged('{"report":"#7 landed on main."}'));

    await handover(success, tickets, landed);

    expect(runs[0]?.promptArgs).toMatchObject({
      LANDING: "merge",
      LANDED: "yes",
      LANDED_DETAIL: landed.detail,
      BASE_BRANCH: baseBranch,
      COMMITTED_TICKETS: "#8, #9",
    });
  });

  it("says nothing landed when the lander refused, whatever the outcome says", async () => {
    const { handover, runs } = merging(tagged('{"report":"#7 blocked; agent/7 pushed."}'));

    await handover(success, tickets, { kind: "not-landed", reason: "main would not fast-forward" });

    expect(runs[0]?.promptArgs).toMatchObject({
      LANDED: "no",
      LANDED_DETAIL: "nothing was landed",
    });
  });

  it("says nothing landed when there was no landing at all", async () => {
    const { handover, runs } = merging(tagged('{"report":"#7 blocked; agent/7 pushed."}'));

    await handover(success, tickets, NO_LANDING);

    expect(runs[0]?.promptArgs).toMatchObject({ LANDED: "no" });
  });

  it("forbids a pull request on a successful pass, which has already landed", async () => {
    const { handover, runs } = merging(tagged('{"report":"#7 landed on main."}'));

    await handover(success, tickets, NO_LANDING);

    expect(runs[0]?.promptArgs).toMatchObject({ PULL_REQUEST: "forbidden" });
  });

  it("forbids a pull request on a blocked pass that committed work, and says nothing landed", async () => {
    const { handover, runs } = merging(tagged('{"report":"#7 blocked; agent/7 pushed."}'));

    await handover(midBlock, tickets, NO_LANDING);

    expect(runs[0]?.promptArgs).toMatchObject({ PULL_REQUEST: "forbidden", LANDED: "no" });
  });

  it("still refuses a leg that opened a pull request anyway, on any outcome", async () => {
    await expect(
      handing({ stdout: published, withConfig: mergeConfig }).handover(
        success,
        tickets,
        NO_LANDING,
      ),
    ).rejects.toThrow(/opens none on any path/);
    await expect(
      handing({ stdout: published, withConfig: mergeConfig }).handover(
        midBlock,
        tickets,
        NO_LANDING,
      ),
    ).rejects.toThrow(RoleError);
    await expect(
      handing({ stdout: published, withConfig: mergeConfig }).handover(
        earlyBail,
        nothing,
        NO_LANDING,
      ),
    ).rejects.toThrow(RoleError);
  });

  it("lets a success hand over with no pull request at all", async () => {
    const { handover } = merging(tagged('{"report":"#7 landed on main."}'));

    await expect(handover(success, tickets, NO_LANDING)).resolves.toBeUndefined();
  });
});

/**
 * The handover is where a finding nobody acted on reaches the human, so what it
 * is told about one is the whole of that reporting.
 */
describe("createHandover on findings nobody addressed", () => {
  const unaddressed: UnaddressedFinding[] = [
    {
      finding: { source: "branchReview", axis: "standards", summary: "split the loader" },
      reason: "one caller only",
    },
    {
      finding: { source: "greenGate", summary: "one test red" },
      reason: "that test is flaky",
    },
  ];

  it("tells the leg each one under the label that says what it cost", async () => {
    const { handover, runs } = handing({ stdout: published });

    await handover(success, tickets, NO_LANDING, unaddressed);

    expect(runs[0]?.promptArgs?.UNADDRESSED).toBe(
      "[standards] split the loader — left: one caller only\n" +
        "[gate] one test red — left: that test is flaky",
    );
  });

  it("says `none` rather than nothing, so an empty list is never a missing one", async () => {
    const { handover, runs } = handing({ stdout: published });

    await handover(success, tickets, NO_LANDING, []);

    expect(runs[0]?.promptArgs?.UNADDRESSED).toBe("none");
  });

  it("names the record directory on the host, which the leg cannot read itself", async () => {
    const { handover, runs } = handing({ stdout: published });

    await handover(success, tickets, NO_LANDING, unaddressed);

    expect(runs[0]?.promptArgs?.RECORD_PATH).toBe(`.relay/${workItem}`);
  });
});

/**
 * What the leg publishes lives in its prompt, so what the prompt instructs is
 * the only thing there is to assert about how the pull request gets opened.
 */
describe("the handover prompt", () => {
  let prompt: string;

  beforeEach(async () => {
    prompt = await readResource("handover.md");
  });

  /** One outcome's own section, which is where that outcome's rules live. */
  const section = (heading: string, until?: string) =>
    prompt.slice(prompt.indexOf(heading), until ? prompt.indexOf(until) : undefined);

  it("opens the pull request with `gh` itself, delegating to no skill", () => {
    expect(prompt).toContain("gh pr create");
    expect(prompt).not.toMatch(/kipu-mr|glab|merge request/i);
  });

  it("drafts a mid-block's pull request in the one command", () => {
    expect(prompt).toContain("gh pr create --draft");
  });

  it("closes the tickets relay names, never a list the leg worked out itself", () => {
    expect(prompt).toMatch(/`Closes` line for \*\*each ticket the pass committed\*\*/);
    expect(prompt).toContain("The pass committed **{{COMMITTED_TICKETS}}**");
  });

  it("counts what went unaddressed on a success and lists it on a block", () => {
    const unaddressed = section("## 3. Say what the pass left unaddressed", "## 4.");
    expect(unaddressed).toContain("{{UNADDRESSED}}");
    expect(unaddressed).toMatch(/\*\*success\*\* — .*\*\*count\*\*/);
    expect(unaddressed).toContain("{{RECORD_PATH}}");
    expect(unaddressed).toMatch(/\*\*mid-block\*\* and \*\*early-bail\*\* — .*\*\*full list\*\*/);
  });

  it("says which axis stopped the pass and which never could", () => {
    const unaddressed = section("## 3. Say what the pass left unaddressed", "## 4.");
    expect(unaddressed).toContain("`spec`");
    expect(unaddressed).toContain("It never stops a pass");
  });

  it("is told the landing, whether the work landed and how, rather than reading the branches", () => {
    expect(prompt).toContain("This repo's landing is **{{LANDING}}**");
    expect(prompt).toContain("**{{LANDED}}**");
    expect(prompt).toContain("{{LANDED_DETAIL}}");
  });

  it("says a merge repo opens no pull request on any path", () => {
    expect(prompt).toMatch(/no pull request is opened on any path/);
  });

  it("adds no label to a merge repo's successful item beyond removing the hold", () => {
    expect(prompt).toMatch(
      /under `merge` landing, remove `agent-in-progress` and add \*\*no\*\* label/,
    );
  });

  it("closes the tickets a merge pass landed, and nothing beyond them", () => {
    expect(section("### success", "### mid-block")).toMatch(
      /Close each of \{\{FINISHED_TICKETS\}\}, and nothing else/,
    );
  });

  it("records as done only the tickets relay derived, never a list the leg worked out itself", () => {
    expect(prompt).toContain("The pass finished **{{FINISHED_TICKETS}}**");
    expect(prompt).toMatch(/the only list you may record as done/);
    expect(prompt).toMatch(/Never work it out yourself/);
  });

  it("closes the work item only when no sub-issue of it is still open", () => {
    const success = section("### success", "### mid-block");
    expect(success).toMatch(/re-read \{\{WORK_ITEM\}\}'s sub-issues/);
    expect(success).toMatch(
      /close \{\{WORK_ITEM\}\} too when none of them is still open, and leave it open when one is/,
    );
  });

  it("closes nothing under `pull-request` landing, where a merge does it", () => {
    expect(section("### success", "### mid-block")).toMatch(
      /Under `pull-request` landing close \*\*nothing\*\*/,
    );
  });

  it("closes nothing until the base branch is pushed", () => {
    const success = section("### success", "### mid-block");
    expect(success).toMatch(/only\*\* when \{\{LANDED\}\} is `yes`/);
    expect(success).toMatch(/When \{\{LANDED\}\} is `no` close nothing/);
  });

  it("closes nothing on a blocked or bailed pass", () => {
    expect(section("### mid-block", "### early-bail")).toMatch(/close \*\*nothing\*\*/i);
    expect(section("### early-bail")).toMatch(/close \*\*nothing\*\*/i);
  });

  it("names the base branch, the gate and the tickets it closed in the comment", () => {
    const success = section("### success", "### mid-block");
    expect(success).toMatch(/Comment the resolution.*\{\{BASE_BRANCH\}\}/s);
    expect(success).toMatch(/the tickets it committed.*closed.*\{\{REASON\}\}/s);
  });

  it("pushes the pass branch on a blocked pass", () => {
    expect(section("### mid-block", "### early-bail")).toContain("git push -u origin {{BRANCH}}");
  });

  it("reads the per-ticket SHAs from the base branch's range, in the report it writes last", () => {
    expect(section("## 4. Report to the operator", "## Output")).toContain(
      "git log --oneline {{BASE_BRANCH}}..{{BRANCH}}",
    );
  });

  it("labels each finished ticket for the state its landing leaves it in", () => {
    const success = section("### success", "### mid-block");
    expect(success).toMatch(/Label each of \{\{FINISHED_TICKETS\}\}, and no other ticket/);
    expect(success).toMatch(/remove `agent-in-progress`/);
    expect(success).toMatch(/under `pull-request` landing, add `agent-in-review` to each/);
    expect(success).toMatch(/under `merge` landing, add \*\*no\*\* label to any of them/);
  });

  it("leaves the held label on the ticket that blocked and marks it blocked", () => {
    const block = section("### mid-block", "### early-bail");
    expect(block).toMatch(/\{\{BLOCKED_TICKETS\}\}/);
    expect(block).toMatch(/leave `agent-in-progress` on it and add `agent-blocked`/);
    expect(block).toMatch(/remove `agent-in-progress` and add \*\*no\*\* label/);
  });

  it("writes no ticket at all on a pass that implemented none", () => {
    expect(section("### early-bail")).toMatch(/no ticket/);
  });

  it("ticks every unchecked box in a finished ticket, or none of them", () => {
    expect(prompt).toMatch(/\*\*every\*\* unchecked box in it/);
    expect(prompt).toMatch(/All of them or none/);
  });

  it("reads and rewrites the body the tracker doc's way, naming no command of its own", () => {
    expect(prompt).toMatch(/Read the body and write it back the way `\{\{TRACKER_DOC\}\}` says to/);
    expect(prompt).not.toMatch(/gh issue/);
  });

  it("asks the tracker doc for the body it is about to rewrite", () => {
    expect(prompt).toMatch(/read the body of, rewrite the body of/);
  });

  it("ticks under whatever heading a box sits, and in whatever list, naming neither itself", () => {
    expect(prompt).toMatch(/whatever heading sits above them and whatever list/);
    // A body heading, never the bail reason in the example report below it:
    // the repo's body conventions are the repo's, and relay states none.
    expect(prompt).not.toMatch(/#+ *acceptance criteria/i);
  });

  it("leaves a ticket whose boxes are already ticked exactly as it is", () => {
    expect(prompt).toMatch(/A ticket with no unchecked box is already ticked/);
  });

  it("never weighs one criterion at a time, having no diff to weigh it against", () => {
    expect(prompt).toMatch(/Never weigh one box against the branch and tick it alone/);
  });

  it("ticks the finished tickets on a success, under both landings", () => {
    expect(section("### success", "### mid-block")).toMatch(
      /Tick each of \{\{FINISHED_TICKETS\}\}, as above, and no other ticket — under \*\*both\*\* landings/,
    );
  });

  it("ticks the finished tickets on a block and leaves the blocking one untouched", () => {
    const block = section("### mid-block", "### early-bail");
    expect(block).toMatch(/Tick each of \{\{FINISHED_TICKETS\}\}, as above, and no other ticket/);
    expect(block).toMatch(/keeps its boxes exactly as they are/);
  });

  it("ticks nothing on a pass that implemented none", () => {
    expect(section("### early-bail")).toMatch(/\*\*no tick\*\*/);
  });

  it("swaps the held label for the state the outcome leaves the item in", () => {
    expect(prompt).toMatch(/add `agent-in-review` and remove `agent-in-progress`/);
    expect(prompt).toMatch(/add `agent-blocked` and remove `agent-in-progress`/);
  });

  it("strips the ready label from the work item on a pass that consumed it", () => {
    expect(section("### success", "### mid-block")).toMatch(
      /remove `ready-for-agent` from \{\{WORK_ITEM\}\}/,
    );
    expect(section("### mid-block", "### early-bail")).toMatch(
      /remove `ready-for-agent` from \{\{WORK_ITEM\}\}/,
    );
  });

  it("strips the ready label from every ticket a pass wrote", () => {
    expect(section("### success", "### mid-block")).toMatch(
      /remove `ready-for-agent` from each of them/,
    );
    expect(section("### mid-block", "### early-bail")).toMatch(
      /remove `ready-for-agent` from every ticket either list names/,
    );
  });

  it("names no ticket to strip for a list that reads `nothing`", () => {
    expect(section("### mid-block", "### early-bail")).toMatch(
      /A list that reads `nothing` names no ticket/,
    );
  });

  it("strips the ready label once from an item that is its own single ticket", () => {
    expect(section("### success", "### mid-block")).toMatch(
      /When \{\{WORK_ITEM\}\} is itself the only ticket, this step asks of it exactly what the step above did: do it once/,
    );
    expect(section("### mid-block", "### early-bail")).toMatch(
      /When \{\{WORK_ITEM\}\} is itself the only ticket, its `ready-for-agent` removal is the one the step above already asked for: do it once/,
    );
  });

  it("leaves the ready label on an item the planner refused, and on no ticket at all", () => {
    expect(section("### early-bail")).toMatch(/Leave `ready-for-agent` on \{\{WORK_ITEM\}\}/);
    expect(section("### early-bail")).toMatch(/Write \*\*no ticket\*\* either — no label/);
  });

  it("reads the repo's default branch itself, carrying it in no argument", () => {
    expect(prompt).toContain("gh repo view --json defaultBranchRef");
    expect(prompt).not.toContain("{{DEFAULT_BRANCH}}");
  });

  it("warns when the base branch is not the default one, in the body and the report", () => {
    const closing = section("GitHub fires those `Closes` lines", "Now do the one outcome");
    expect(closing).toContain("{{BASE_BRANCH}}");
    expect(closing).toMatch(/They differ — .*will \*\*not\*\* fire/s);
    expect(closing).toMatch(/pull request body and in your report/);
    expect(closing).toMatch(/closed by hand/);
  });

  it("says nothing about the default branch when it is the base branch", () => {
    const closing = section("GitHub fires those `Closes` lines", "Now do the one outcome");
    expect(closing).toMatch(/They match — say nothing about it/);
  });

  it("leaves the default branch out of a merge pass, where closing is the leg's own act", () => {
    const closing = section("GitHub fires those `Closes` lines", "Now do the one outcome");
    expect(closing).toMatch(/Under `merge` landing .*never arises/);
  });

  it("carries the gate's command and provenance into the pull request body and the tracker comment", () => {
    const success = section("### success", "### mid-block");
    expect(success).toContain("Its body names the command that verified it");
    expect(success).toMatch(/Comment the resolution.*\{\{REASON\}\}/);
  });
});
