import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Sandbox, SandboxRunOptions, SandboxRunResult } from "@ai-hero/sandcastle";
import { beforeEach, describe, expect, it } from "vitest";
import { relayConfigSchema } from "../src/config.js";
import type { TicketRef } from "../src/crew.js";
import { RoleError } from "../src/errors.js";
import { createImplementer, IMPLEMENT_TAG } from "../src/implementer.js";
import { TRACKER_DOC_PATH } from "../src/tracker-doc.js";

const config = relayConfigSchema.parse({
  greenGate: "make test",
  defaultBranch: "main",
  jira: { baseUrl: "https://example.atlassian.net" },
});

const ticket: TicketRef = { key: "PSD-8", summary: "the schema" };

/** What the branch is at before the implementer runs. */
const HEAD_SHA = "9e4d1a0";

/** A sandbox whose only real behaviour is what one implementer run returns. */
function fakeSandbox(stdout: string, commits: { sha: string }[]) {
  const runs: SandboxRunOptions[] = [];
  const execs: string[] = [];
  const sandbox = {
    async run(options: SandboxRunOptions): Promise<SandboxRunResult> {
      runs.push(options);
      return { iterations: [], stdout, commits };
    },
    async exec(command: string) {
      execs.push(command);
      return { stdout: `${HEAD_SHA}\n`, stderr: "", exitCode: 0 };
    },
  } as unknown as Sandbox;
  return { sandbox, runs, execs };
}

const implementing = (stdout: string, commits = [{ sha: "c0ffee" }]) => {
  const { sandbox, runs, execs } = fakeSandbox(stdout, commits);
  return { implement: createImplementer({ sandbox, config, outputDir }), runs, execs };
};

const taggedResult = (json: string) => `Wrote the test first.\n<${IMPLEMENT_TAG}>${json}</${IMPLEMENT_TAG}>`;

let outputDir: string;

beforeEach(async () => {
  outputDir = await mkdtemp(join(tmpdir(), "relay-implementer-"));
});

describe("createImplementer", () => {
  it("reports a committed ticket as done, from the base its change starts at", async () => {
    const { implement, execs } = implementing(taggedResult('{"kind":"done"}'));

    await expect(implement(ticket)).resolves.toEqual({ kind: "done", base: HEAD_SHA });
    expect(execs).toEqual(["git rev-parse HEAD"]);
  });

  it("names its status file after the run, so the pass's legs stay apart", async () => {
    const { implement } = implementing(taggedResult('{"kind":"done"}'));

    await implement(ticket);

    const written = await readFile(join(outputDir, `implementer-${ticket.key}.status.json`), "utf8");
    expect(JSON.parse(written)).toMatchObject({ role: `implementer-${ticket.key}`, answer: { kind: "done" } });
  });

  it("refuses a done that committed nothing", async () => {
    const { implement } = implementing(taggedResult('{"kind":"done"}'), []);

    await expect(implement(ticket)).rejects.toThrow(RoleError);
  });

  it("lets a needs-input end with no commit of its own", async () => {
    const { implement } = implementing(taggedResult('{"kind":"needs-input","reason":"no queue named"}'), []);

    await expect(implement(ticket)).resolves.toEqual({
      kind: "needs-input",
      reason: "no queue named",
    });
  });

  it("passes a request for human input straight through", async () => {
    const { implement } = implementing(taggedResult('{"kind":"needs-input","reason":"PSD-8 does not say which queue to use"}'));

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
    expect(run?.agent.buildPrintCommand({ prompt: "", dangerouslySkipPermissions: true }).command).toContain(
      `--model '${config.models.implementer}'`,
    );
    expect(run?.promptArgs).toEqual({
      TICKET_KEY: ticket.key,
      TICKET_SUMMARY: ticket.summary,
      TRACKER_DOC: TRACKER_DOC_PATH,
    });
    expect(run?.prompt).toContain("{{TICKET_KEY}}");
    expect(run?.prompt).toContain("{{TICKET_SUMMARY}}");
    expect(run?.prompt).toContain("{{TRACKER_DOC}}");
    expect(run?.prompt).toContain(`<${IMPLEMENT_TAG}>`);
  });

  it("mounts the skills it works under: tdd, and kipu-commit to commit itself", async () => {
    const { implement, runs } = implementing(taggedResult('{"kind":"done"}'));

    await implement(ticket);

    expect(runs[0]?.prompt).toContain("kipu-all:tdd");
    expect(runs[0]?.prompt).toContain("kipu-all:kipu-commit");
  });
});
