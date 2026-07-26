import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Sandbox, SandboxRunOptions, SandboxRunResult } from "@ai-hero/sandcastle";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { relayConfigSchema } from "../src/config.js";
import type { Outcome } from "../src/crew.js";
import { RoleError } from "../src/errors.js";
import { createHandover, HANDOVER_TAG } from "../src/handover.js";
import { TRACKER_DOC_PATH } from "../src/tracker-doc.js";

const config = relayConfigSchema.parse({
  greenGate: "make test",
  defaultBranch: "main",
  jira: { baseUrl: "https://example.atlassian.net" },
});

const workItem = "PSD-7";
const branch = "agent/PSD-7";

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
  '{"mrUrl":"https://gitlab.com/kipu/qc/-/merge_requests/12","report":"PSD-7 is In Review."}',
);

const success: Outcome = { kind: "success" };
const midBlock: Outcome = { kind: "mid-block", reason: "the gate is still red", hasWork: true };
const midBlockWithoutWork: Outcome = {
  kind: "mid-block",
  reason: "blocked on the first ticket",
  hasWork: false,
};
const earlyBail: Outcome = { kind: "early-bail", reason: "PSD-7 has no acceptance criteria" };

let outputDir: string;

beforeEach(async () => {
  outputDir = await mkdtemp(join(tmpdir(), "relay-handover-"));
});

describe("createHandover", () => {
  it("hands over in one leg, on the handover model", async () => {
    const { handover, runs } = handing({ stdout: published });

    await handover(success);

    expect(runs.map((run) => run.name)).toEqual(["handover"]);
    expect(
      runs[0]?.agent.buildPrintCommand({ prompt: "", dangerouslySkipPermissions: true }).command,
    ).toContain(`--model '${config.models.handover}'`);
  });

  it("tells the leg which outcome it is handing over, and on what", async () => {
    const { handover, runs } = handing({ stdout: published });

    await handover(success);

    expect(runs[0]?.promptArgs).toEqual({
      OUTCOME: "success",
      REASON: "The green gate is green.",
      MERGE_REQUEST: "required",
      WORK_ITEM_KEY: workItem,
      BRANCH: branch,
      TRACKER_DOC: TRACKER_DOC_PATH,
    });
  });

  it("tells the leg the merge request rule relay will judge it by", async () => {
    const { handover, runs } = handing({
      stdout: tagged('{"report":"PSD-7 blocked before it committed anything."}'),
    });

    await handover(midBlockWithoutWork);

    expect(runs[0]?.promptArgs).toMatchObject({ MERGE_REQUEST: "forbidden" });
  });

  it("passes a blocked outcome's own reason on as the cause", async () => {
    const { handover, runs } = handing({ stdout: published });

    await handover(midBlock);

    expect(runs[0]?.promptArgs).toMatchObject({
      OUTCOME: "mid-block",
      REASON: "the gate is still red",
    });
  });

  it("reports the leg's report to the operator", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { handover } = handing({ stdout: published });

    await handover(success);

    const printed = log.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(printed).toContain("success");
    expect(printed).toContain("PSD-7 is In Review.");
    log.mockRestore();
  });

  it("reports what the leg did even when the leg broke its own rule", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    // The leg has already pushed, transitioned and commented by the time relay
    // judges it, so the report is the human's only record of that.
    const { handover } = handing({ stdout: tagged('{"report":"PSD-7 is In Review."}') });

    await expect(handover(success)).rejects.toThrow(RoleError);

    expect(log).toHaveBeenCalledWith(expect.stringContaining("PSD-7 is In Review."));
    log.mockRestore();
  });

  it("hands an early bail over without a merge request", async () => {
    const { handover, runs } = handing({
      stdout: tagged('{"report":"PSD-7 needs acceptance criteria; nothing was built."}'),
    });

    await handover(earlyBail);

    expect(runs[0]?.promptArgs).toMatchObject({ OUTCOME: "early-bail" });
  });

  it("refuses a success that opened no merge request", async () => {
    const { handover } = handing({ stdout: tagged('{"report":"PSD-7 is In Review."}') });

    await expect(handover(success)).rejects.toThrow(RoleError);
  });

  it("lets a mid-block on an empty branch hand over without a merge request", async () => {
    const { handover } = handing({
      stdout: tagged('{"report":"PSD-7 blocked on its first ticket; nothing was committed."}'),
    });

    await expect(handover(midBlockWithoutWork)).resolves.toBeUndefined();
  });

  it("refuses a mid-block that left committed tickets unpublished", async () => {
    const { handover } = handing({
      stdout: tagged('{"report":"PSD-7 blocked after two tickets; the branch was not pushed."}'),
    });

    await expect(handover(midBlock)).rejects.toThrow(RoleError);
  });

  it("refuses a mid-block that opened a merge request on an empty branch", async () => {
    const { handover } = handing({ stdout: published });

    await expect(handover(midBlockWithoutWork)).rejects.toThrow(RoleError);
  });

  it("refuses an early bail that opened a merge request on an empty branch", async () => {
    const { handover } = handing({ stdout: published });

    await expect(handover(earlyBail)).rejects.toThrow(RoleError);
  });

  it("refuses a handover that committed to the branch", async () => {
    const { handover } = handing({ stdout: published, commits: [{ sha: "c0ffee" }] });

    await expect(handover(success)).rejects.toThrow(RoleError);
  });

  it("leaves the leg's answer on the host, even when the leg broke its own rule", async () => {
    const { handover } = handing({ stdout: tagged('{"report":"PSD-7 is In Review."}') });

    await expect(handover(success)).rejects.toThrow(RoleError);

    const written = await readFile(join(outputDir, "handover.status.json"), "utf8");
    expect(JSON.parse(written)).toEqual({
      role: "handover",
      model: config.models.handover,
      answer: { report: "PSD-7 is In Review." },
    });
  });

  it("refuses a handover that reported nothing", async () => {
    const { handover } = handing({ stdout: "Pushed it." });

    await expect(handover(success)).rejects.toThrow(RoleError);
  });
});
