import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Sandbox, SandboxRunOptions, SandboxRunResult } from "@ai-hero/sandcastle";
import { beforeEach, describe, expect, it } from "vitest";
import { relayConfigSchema } from "../../../src/config.js";
import type { TicketRef } from "../../../src/crew/contract.js";
import { RoleError } from "../../../src/errors.js";
import { createImplementer, IMPLEMENT_TAG } from "../../../src/crew/roles/implementer.js";
import { readResource } from "../../../src/resources.js";
import { TRACKER_DOC_PATH } from "../../../src/tracker/tracker-doc.js";
import { expectPromptParity } from "./prompt-parity.js";

const config = relayConfigSchema.parse({ landing: "pull-request" });

const ticket: TicketRef = { number: 8, summary: "the schema" };

const baseBranch = "main";

/** What the branch is at before the implementer runs. */
const HEAD_SHA = "9e4d1a0";

/** The commits the pass put on the branch before this ticket. */
const PASS_LOG = "9e4d1a0 feat: the endpoint";

/** A sandbox whose only real behaviour is what one implementer run returns. */
function fakeSandbox(stdout: string, commits: { sha: string }[], passLog: string) {
  const runs: SandboxRunOptions[] = [];
  const execs: string[] = [];
  const sandbox = {
    async run(options: SandboxRunOptions): Promise<SandboxRunResult> {
      runs.push(options);
      return { iterations: [], stdout, commits };
    },
    async exec(command: string) {
      execs.push(command);
      const out = command.startsWith("git log") ? passLog : HEAD_SHA;
      return { stdout: `${out}\n`, stderr: "", exitCode: 0 };
    },
  } as unknown as Sandbox;
  return { sandbox, runs, execs };
}

const implementing = (
  stdout: string,
  commits = [{ sha: "c0ffee" }],
  { passLog = PASS_LOG }: { passLog?: string } = {},
) => {
  const { sandbox, runs, execs } = fakeSandbox(stdout, commits, passLog);
  return {
    implement: createImplementer({ sandbox, config, recordDir, baseBranch }),
    runs,
    execs,
  };
};

const taggedResult = (json: string) =>
  `Wrote the test first.\n<${IMPLEMENT_TAG}>${json}</${IMPLEMENT_TAG}>`;

let recordDir: string;

beforeEach(async () => {
  recordDir = await mkdtemp(join(tmpdir(), "relay-implementer-"));
});

describe("createImplementer", () => {
  it("reports a committed ticket as done, from the base its change starts at", async () => {
    const { implement } = implementing(taggedResult('{"kind":"done"}'));

    await expect(implement(ticket)).resolves.toEqual({ kind: "done", base: HEAD_SHA });
  });

  it("names its status file after the run, so the pass's legs stay apart", async () => {
    const { implement } = implementing(taggedResult('{"kind":"done"}'));

    await implement(ticket);

    const written = await readFile(
      join(recordDir, `implementer-${ticket.number}.status.json`),
      "utf8",
    );
    expect(JSON.parse(written)).toMatchObject({
      role: `implementer-${ticket.number}`,
      answer: { kind: "done" },
    });
  });

  it("refuses a done that committed nothing", async () => {
    const { implement } = implementing(taggedResult('{"kind":"done"}'), []);

    await expect(implement(ticket)).rejects.toThrow(RoleError);
  });

  it("lets a needs-input end with no commit of its own", async () => {
    const { implement } = implementing(
      taggedResult('{"kind":"needs-input","reason":"no queue named"}'),
      [],
    );

    await expect(implement(ticket)).resolves.toEqual({
      kind: "needs-input",
      reason: "no queue named",
    });
  });

  it("passes a request for human input straight through", async () => {
    const { implement } = implementing(
      taggedResult('{"kind":"needs-input","reason":"PSD-8 does not say which queue to use"}'),
    );

    await expect(implement(ticket)).resolves.toEqual({
      kind: "needs-input",
      reason: "PSD-8 does not say which queue to use",
    });
  });

  it("refuses a needs-input with no reason to hand a human", async () => {
    const { implement } = implementing(taggedResult('{"kind":"needs-input","reason":""}'));

    await expect(implement(ticket)).rejects.toThrow(RoleError);
  });

  it("refuses a run that reported nothing", async () => {
    const { implement } = implementing("I changed a few files.");

    await expect(implement(ticket)).rejects.toThrow(RoleError);
  });

  it("runs a fresh session on the implementer's model, over the ticket and the tracker doc", async () => {
    const { implement, runs } = implementing(taggedResult('{"kind":"done"}'));

    await implement(ticket);

    expect(runs).toHaveLength(1);
    const [run] = runs;
    expect(
      run?.agent.buildPrintCommand({ prompt: "", dangerouslySkipPermissions: true }).command,
    ).toContain(`--model '${config.models.implementer}'`);
    expect(run?.promptArgs).toEqual({
      TICKET: `#${ticket.number}`,
      TICKET_SUMMARY: ticket.summary,
      TRACKER_DOC: TRACKER_DOC_PATH,
      PASS_COMMITS: PASS_LOG,
    });
    await expectPromptParity(run, "implementer.md");
  });

  it("shows the leg the pass's own commits, read alongside the branch's HEAD", async () => {
    const { implement, runs, execs } = implementing(taggedResult('{"kind":"done"}'));

    await implement(ticket);

    expect(execs).toEqual(["git rev-parse HEAD", `git log --oneline ${baseBranch}..HEAD`]);
    expect(runs[0]?.promptArgs).toMatchObject({ PASS_COMMITS: PASS_LOG });
  });

  it("implements the pass's first ticket, whose log of earlier commits is empty", async () => {
    const { implement, runs } = implementing(taggedResult('{"kind":"done"}'), [{ sha: "c0ffee" }], {
      passLog: "",
    });

    await expect(implement(ticket)).resolves.toEqual({ kind: "done", base: HEAD_SHA });
    expect(runs[0]?.promptArgs).toMatchObject({ PASS_COMMITS: "" });
  });
});

/**
 * The implementer's behaviour lives in its prompt, so what the prompt instructs
 * is the only thing there is to assert about how it builds a ticket.
 */
describe("the implementer prompt", () => {
  let prompt: string;

  beforeEach(async () => {
    prompt = await readResource("implementer.md");
  });

  it("ends the run with the block relay reads the result out of", () => {
    expect(prompt).toContain(`<${IMPLEMENT_TAG}>`);
  });

  it("mounts the skills it works under: tdd, and kipu-commit to commit itself", () => {
    expect(prompt).toContain("kipu-all:tdd");
    expect(prompt).toContain("kipu-all:kipu-commit");
  });

  it("shows the pass's commits where it tells the leg to build on them", () => {
    expect(prompt).toMatch(/\{\{PASS_COMMITS\}\}[\s\S]*build on it rather than repeating it/);
  });
});
