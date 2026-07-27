import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Sandbox, SandboxRunOptions, SandboxRunResult } from "@ai-hero/sandcastle";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { relayConfigSchema } from "../src/config.js";
import type { Outcome, TicketRef } from "../src/crew.js";
import { RoleError } from "../src/errors.js";
import { readResource } from "../src/resources.js";
import { createHandover, HANDOVER_TAG } from "../src/handover.js";
import { TRACKER_DOC_PATH } from "../src/tracker-doc.js";

const config = relayConfigSchema.parse({
  greenGate: "make test",
  defaultBranch: "main",
});

const workItem = 7;
const branch = "agent/7";

/** A sandbox whose handover run has a fixed stdout and commit count. */
function handing({ stdout = "", commits = [] as { sha: string }[] } = {}) {
  const runs: SandboxRunOptions[] = [];
  const sandbox = {
    async run(options: SandboxRunOptions): Promise<SandboxRunResult> {
      runs.push(options);
      return { iterations: [], stdout, commits };
    },
  } as unknown as Sandbox;

  return { handover: createHandover({ sandbox, config, outputDir, workItem, branch }), runs };
}

const tagged = (json: string) => `Handed over.\n<${HANDOVER_TAG}>${json}</${HANDOVER_TAG}>`;

const published = tagged(
  '{"prUrl":"https://github.com/kipu/qc/pull/12","report":"#7 is agent-in-review."}',
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

let outputDir: string;

beforeEach(async () => {
  outputDir = await mkdtemp(join(tmpdir(), "relay-handover-"));
});

describe("createHandover", () => {
  it("hands over in one leg, on the handover model", async () => {
    const { handover, runs } = handing({ stdout: published });

    await handover(success, tickets);

    expect(runs.map((run) => run.name)).toEqual(["handover"]);
    expect(
      runs[0]?.agent.buildPrintCommand({ prompt: "", dangerouslySkipPermissions: true }).command,
    ).toContain(`--model '${config.models.handover}'`);
  });

  it("tells the leg which outcome it is handing over, and on what", async () => {
    const { handover, runs } = handing({ stdout: published });

    await handover(success, tickets);

    expect(runs[0]?.promptArgs).toEqual({
      OUTCOME: "success",
      REASON: "`make test` exited 0 — declared in relay.config.ts.",
      PULL_REQUEST: "required",
      COMMITTED_TICKETS: "#8, #9",
      WORK_ITEM: `#${workItem}`,
      BRANCH: branch,
      DEFAULT_BRANCH: config.defaultBranch,
      TRACKER_DOC: TRACKER_DOC_PATH,
    });
  });

  it("names the committed tickets, which the leg cannot read out of the commits", async () => {
    const { handover, runs } = handing({ stdout: published });

    await handover(midBlock, [{ number: 8, summary: "reject an empty cart" }]);

    expect(runs[0]?.promptArgs).toMatchObject({ COMMITTED_TICKETS: "#8" });
  });

  it("tells a leg with an empty branch that it committed nothing", async () => {
    const { handover, runs } = handing({
      stdout: tagged('{"report":"#7 needs acceptance criteria; nothing was built."}'),
    });

    await handover(earlyBail, nothing);

    expect(runs[0]?.promptArgs).toMatchObject({ COMMITTED_TICKETS: "nothing" });
  });

  it("tells the leg the pull request rule relay will judge it by", async () => {
    const { handover, runs } = handing({
      stdout: tagged('{"report":"#7 blocked before it committed anything."}'),
    });

    await handover(midBlock, nothing);

    expect(runs[0]?.promptArgs).toMatchObject({ PULL_REQUEST: "forbidden" });
  });

  it("passes a blocked outcome's own reason on as the cause", async () => {
    const { handover, runs } = handing({ stdout: published });

    await handover(midBlock, tickets);

    expect(runs[0]?.promptArgs).toMatchObject({
      OUTCOME: "mid-block",
      REASON: "the gate is still red",
    });
  });

  it("reports the leg's report to the operator", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { handover } = handing({ stdout: published });

    await handover(success, tickets);

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

    await expect(handover(success, tickets)).rejects.toThrow(RoleError);

    expect(log).toHaveBeenCalledWith(expect.stringContaining("#7 is agent-in-review."));
    log.mockRestore();
  });

  it("hands an early bail over without a pull request", async () => {
    const { handover, runs } = handing({
      stdout: tagged('{"report":"#7 needs acceptance criteria; nothing was built."}'),
    });

    await handover(earlyBail, nothing);

    expect(runs[0]?.promptArgs).toMatchObject({ OUTCOME: "early-bail" });
  });

  it("refuses a success that opened no pull request", async () => {
    const { handover } = handing({ stdout: tagged('{"report":"#7 is agent-in-review."}') });

    await expect(handover(success, tickets)).rejects.toThrow(RoleError);
  });

  it("lets a mid-block on an empty branch hand over without a pull request", async () => {
    const { handover } = handing({
      stdout: tagged('{"report":"#7 blocked on its first ticket; nothing was committed."}'),
    });

    await expect(handover(midBlock, nothing)).resolves.toBeUndefined();
  });

  it("refuses a mid-block that left committed tickets unpublished", async () => {
    const { handover } = handing({
      stdout: tagged('{"report":"#7 blocked after two tickets; the branch was not pushed."}'),
    });

    await expect(handover(midBlock, tickets)).rejects.toThrow(RoleError);
  });

  it("refuses a mid-block that opened a pull request on an empty branch", async () => {
    const { handover } = handing({ stdout: published });

    await expect(handover(midBlock, nothing)).rejects.toThrow(RoleError);
  });

  it("refuses an early bail that opened a pull request on an empty branch", async () => {
    const { handover } = handing({ stdout: published });

    await expect(handover(earlyBail, nothing)).rejects.toThrow(RoleError);
  });

  it("refuses a handover that committed to the branch", async () => {
    const { handover } = handing({ stdout: published, commits: [{ sha: "c0ffee" }] });

    await expect(handover(success, tickets)).rejects.toThrow(RoleError);
  });

  it("leaves the leg's answer on the host, even when the leg broke its own rule", async () => {
    const { handover } = handing({ stdout: tagged('{"report":"#7 is agent-in-review."}') });

    await expect(handover(success, tickets)).rejects.toThrow(RoleError);

    const written = await readFile(join(outputDir, "handover.status.json"), "utf8");
    expect(JSON.parse(written)).toEqual({
      role: "handover",
      model: config.models.handover,
      answer: { report: "#7 is agent-in-review." },
    });
  });

  it("refuses a handover that reported nothing", async () => {
    const { handover } = handing({ stdout: "Pushed it." });

    await expect(handover(success, tickets)).rejects.toThrow(RoleError);
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
    expect(prompt).toMatch(/Never work the list out yourself/);
  });

  it("swaps the held label for the state the outcome leaves the item in", () => {
    expect(prompt).toMatch(/add `agent-in-review` and remove `agent-in-progress`/);
    expect(prompt).toMatch(/add `agent-blocked` and remove `agent-in-progress`/);
  });

  it("carries the gate's command and provenance into the pull request body and the tracker comment", () => {
    const success = prompt.slice(prompt.indexOf("### success"), prompt.indexOf("### mid-block"));
    expect(success).toContain("Its body names the command that verified it");
    expect(success).toMatch(/Comment the resolution.*\{\{REASON\}\}/);
  });
});
