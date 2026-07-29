import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Sandbox, SandboxRunOptions, SandboxRunResult } from "@ai-hero/sandcastle";
import { beforeEach, describe, expect, it } from "vitest";
import { relayConfigSchema } from "../../src/config.js";
import { NO_LANDING } from "../../src/crew/contract.js";
import { createCrew } from "../../src/crew/crew.js";
import { FIX_TAG } from "../../src/crew/roles/fixer.js";
import { RESOLVED_GATE_TAG } from "../../src/crew/roles/gate-resolver.js";
import { HANDOVER_TAG } from "../../src/crew/roles/handover.js";
import { IMPLEMENT_TAG } from "../../src/crew/roles/implementer.js";
import { LAND_TAG } from "../../src/crew/roles/lander.js";
import type { GitHubIssue } from "../../src/tracker/github.js";
import { PLAN_TAG } from "../../src/crew/roles/planner.js";
import { FINDINGS_TAG } from "../../src/crew/roles/reviewer.js";

const config = relayConfigSchema.parse({ landing: "pull-request" });

const issue: GitHubIssue = {
  number: 7,
  labels: ["ready-for-agent"],
  isOpen: true,
  blockedBy: [],
  subIssues: [],
};

const repoRoot = "/repo";
const branch = "agent/7";
const baseBranch = "main";

let recordDir: string;

beforeEach(async () => {
  recordDir = await mkdtemp(join(tmpdir(), "relay-crew-"));
});

describe("createCrew", () => {
  it("resolves the gate by running the gate resolver role in the pass's sandbox", async () => {
    const runs: SandboxRunOptions[] = [];
    const sandbox = {
      async run(options: SandboxRunOptions): Promise<SandboxRunResult> {
        runs.push(options);
        return {
          iterations: [],
          commits: [],
          stdout:
            `<${RESOLVED_GATE_TAG}>{"command":"npm run verify","provenance":"declared",` +
            `"source":"AGENTS.md"}</${RESOLVED_GATE_TAG}>`,
        };
      },
    } as unknown as Sandbox;

    const crew = createCrew({
      sandbox,
      config,
      recordDir,
      repoRoot,
      workItem: issue.number,
      branch,
      baseBranch,
    });
    const gate = await crew.resolveGate();

    expect(gate).toEqual({
      command: "npm run verify",
      provenance: "declared",
      source: "AGENTS.md",
    });
    expect(runs.map((run) => run.name)).toEqual(["gate-resolver"]);
  });

  it("plans by running the planner role in the pass's sandbox", async () => {
    const runs: SandboxRunOptions[] = [];
    const sandbox = {
      async run(options: SandboxRunOptions): Promise<SandboxRunResult> {
        runs.push(options);
        return {
          iterations: [],
          commits: [],
          stdout: `<${PLAN_TAG}>{"kind":"plan","tickets":[{"number":8,"summary":"it"}]}</${PLAN_TAG}>`,
        };
      },
    } as unknown as Sandbox;

    const crew = createCrew({
      sandbox,
      config,
      recordDir,
      repoRoot,
      workItem: issue.number,
      branch,
      baseBranch,
    });
    const plan = await crew.plan(issue);

    expect(plan).toEqual({ kind: "plan", tickets: [{ number: 8, summary: "it" }] });
    expect(runs.map((run) => run.name)).toEqual(["planner"]);
  });

  it("implements each ticket in its own implementer run", async () => {
    const runs: SandboxRunOptions[] = [];
    const sandbox = {
      async run(options: SandboxRunOptions): Promise<SandboxRunResult> {
        runs.push(options);
        return {
          iterations: [],
          commits: [{ sha: "c0ffee" }],
          stdout: `<${IMPLEMENT_TAG}>{"kind":"done"}</${IMPLEMENT_TAG}>`,
        };
      },
      async exec() {
        return { stdout: "9e4d1a0\n", stderr: "", exitCode: 0 };
      },
    } as unknown as Sandbox;
    const crew = createCrew({
      sandbox,
      config,
      recordDir,
      repoRoot,
      workItem: issue.number,
      branch,
      baseBranch,
    });

    await crew.implement({ number: 8, summary: "the schema" });
    const result = await crew.implement({ number: 9, summary: "the endpoint" });

    expect(result).toEqual({ kind: "done", base: "9e4d1a0" });
    expect(runs.map((run) => run.name)).toEqual(["implementer-8", "implementer-9"]);
  });

  it("fixes a scope's merged findings in one fixer run", async () => {
    const runs: SandboxRunOptions[] = [];
    const sandbox = {
      async run(options: SandboxRunOptions): Promise<SandboxRunResult> {
        runs.push(options);
        return {
          iterations: [],
          commits: [{ sha: "c0ffee" }],
          stdout: `<${FIX_TAG}>{"kind":"fixed"}</${FIX_TAG}>`,
        };
      },
    } as unknown as Sandbox;
    const crew = createCrew({
      sandbox,
      config,
      recordDir,
      repoRoot,
      workItem: issue.number,
      branch,
      baseBranch,
    });

    await crew.fix([{ source: "ticketReview", ticket: 8, summary: "src/a.ts:3 dead" }], {
      kind: "ticket",
      ticket: { number: 8, summary: "the schema" },
    });

    expect(runs.map((run) => run.name)).toEqual(["fixer-8"]);
  });

  it("gates by running the resolved gate's command in the pass's sandbox", async () => {
    const commands: string[] = [];
    const sandbox = {
      async exec(command: string) {
        commands.push(command);
        return { stdout: "", stderr: "", exitCode: 0 };
      },
    } as unknown as Sandbox;

    const result = await createCrew({
      sandbox,
      config,
      recordDir,
      repoRoot,
      workItem: issue.number,
      branch,
      baseBranch,
    }).greenGate(1, {
      command: "make test",
      provenance: "declared",
      source: "relay.config.ts",
    });

    expect(result.green).toBe(true);
    expect(commands).toEqual(["make test"]);
  });

  it("reviews a scope in its own review run", async () => {
    const runs: SandboxRunOptions[] = [];
    const sandbox = {
      async run(options: SandboxRunOptions): Promise<SandboxRunResult> {
        runs.push(options);
        return {
          iterations: [],
          commits: [],
          stdout: `<${FINDINGS_TAG}>["src/a.ts:3 duplicated parsing"]</${FINDINGS_TAG}>`,
        };
      },
      // The review is read-only, so its run is followed by a clean-worktree check.
      async exec() {
        return { stdout: "", stderr: "", exitCode: 0 };
      },
    } as unknown as Sandbox;
    const crew = createCrew({
      sandbox,
      config,
      recordDir,
      repoRoot,
      workItem: issue.number,
      branch,
      baseBranch,
    });

    const findings = await crew.review({
      kind: "ticket",
      ticket: { number: 8, summary: "the schema" },
      base: "abc1234",
    });

    expect(findings).toEqual([
      { source: "ticketReview", ticket: 8, summary: "src/a.ts:3 duplicated parsing" },
    ]);
    expect(runs.map((run) => run.name)).toEqual(["ticketReview-8"]);
  });

  it("gives its base branch to the whole-branch reviewer and to the handover", async () => {
    const runs: SandboxRunOptions[] = [];
    const sandbox = {
      async run(options: SandboxRunOptions): Promise<SandboxRunResult> {
        runs.push(options);
        return {
          iterations: [],
          commits: [],
          stdout: options.name?.startsWith("handover")
            ? `<${HANDOVER_TAG}>{"prUrl":"https://github.com/g/r/pull/1","report":"done"}</${HANDOVER_TAG}>`
            : `<${FINDINGS_TAG}>[]</${FINDINGS_TAG}>`,
        };
      },
      async exec() {
        return { stdout: "", stderr: "", exitCode: 0 };
      },
    } as unknown as Sandbox;
    const crew = createCrew({
      sandbox,
      config,
      recordDir,
      repoRoot,
      workItem: issue.number,
      branch,
      baseBranch: "spike/foo",
    });

    await crew.review({ kind: "branch", workItem: issue.number });
    await crew.handover(
      { kind: "success", detail: "`make test` exited 0" },
      [{ number: 8, summary: "the one ticket" }],
      NO_LANDING,
    );

    expect(runs[0]?.promptArgs).toMatchObject({ SCOPE: "branch", BASE: "spike/foo" });
    expect(runs[1]?.promptArgs).toMatchObject({ BASE_BRANCH: "spike/foo" });
  });

  it("hands the pass over on the item and branch it ran on", async () => {
    const runs: SandboxRunOptions[] = [];
    const sandbox = {
      async run(options: SandboxRunOptions): Promise<SandboxRunResult> {
        runs.push(options);
        return {
          iterations: [],
          commits: [],
          stdout: `<${HANDOVER_TAG}>{"prUrl":"https://github.com/g/r/pull/1","report":"done"}</${HANDOVER_TAG}>`,
        };
      },
    } as unknown as Sandbox;
    const crew = createCrew({
      sandbox,
      config,
      recordDir,
      repoRoot,
      workItem: issue.number,
      branch,
      baseBranch,
    });

    await crew.handover(
      { kind: "success", detail: "`make test` exited 0" },
      [{ number: 8, summary: "the one ticket" }],
      NO_LANDING,
    );

    expect(runs.map((run) => run.name)).toEqual(["handover"]);
    expect(runs[0]?.promptArgs).toMatchObject({
      WORK_ITEM: `#${issue.number}`,
      BRANCH: branch,
    });
  });

  it("runs a lander leg only where the repo's landing needs one", async () => {
    const runs: SandboxRunOptions[] = [];
    const sandbox = {
      async run(options: SandboxRunOptions): Promise<SandboxRunResult> {
        runs.push(options);
        return {
          iterations: [],
          commits: [],
          stdout: `<${LAND_TAG}>{"kind":"stuck","reason":"a conflict nobody could resolve"}</${LAND_TAG}>`,
        };
      },
    } as unknown as Sandbox;
    const crewFor = (landing: "pull-request" | "merge") =>
      createCrew({
        sandbox,
        config: relayConfigSchema.parse({ landing }),
        recordDir,
        repoRoot,
        workItem: issue.number,
        branch,
        baseBranch,
      });
    const regate = () => Promise.resolve({ green: true, detail: "green" });

    expect(await crewFor("merge").land(regate)).toEqual({
      kind: "not-landed",
      reason: "a conflict nobody could resolve",
    });
    expect(await crewFor("pull-request").land(regate)).toEqual(NO_LANDING);
    expect(runs.map((run) => run.name)).toEqual(["lander"]);
  });
});
