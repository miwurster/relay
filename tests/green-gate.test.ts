import type { Sandbox, SandboxRunOptions, SandboxRunResult } from "@ai-hero/sandcastle";
import { describe, expect, it } from "vitest";
import { relayConfigSchema } from "../src/config.js";
import { RoleError } from "../src/errors.js";
import { createGreenGate, GATE_OUTPUT_TAIL, GATE_TAG } from "../src/green-gate.js";

const config = relayConfigSchema.parse({
  greenGate: "./mvnw verify -DexcludedGroups=e2e",
  defaultBranch: "main",
  jira: { baseUrl: "https://example.atlassian.net" },
});

interface GateRun {
  stdout?: string;
  stderr?: string;
  exitCode: number;
  triage?: string;
  commits?: { sha: string }[];
  /** What `git status --porcelain` reports after the gate command ran. */
  dirt?: string;
}

/**
 * A sandbox whose gate command has a fixed result and whose triage run has a
 * fixed stdout. `git status --porcelain` answers the read-only check.
 */
function gating({
  stdout = "",
  stderr = "",
  exitCode,
  triage = "",
  commits = [],
  dirt = "",
}: GateRun) {
  const commands: string[] = [];
  const runs: SandboxRunOptions[] = [];
  const sandbox = {
    async exec(command: string) {
      commands.push(command);
      if (command.startsWith("git status")) return { stdout: dirt, stderr: "", exitCode: 0 };
      return { stdout, stderr, exitCode };
    },
    async run(options: SandboxRunOptions): Promise<SandboxRunResult> {
      runs.push(options);
      return { iterations: [], stdout: triage, commits };
    },
  } as unknown as Sandbox;

  return { greenGate: createGreenGate({ sandbox, config }), commands, runs };
}

const taggedTriage = (json: string) => `Had a look.\n<${GATE_TAG}>${json}</${GATE_TAG}>`;

const redTriage = taggedTriage('{"detail":"OrderTest.rejectsEmptyCart fails: cart is never null"}');

const commandOf = (run: SandboxRunOptions | undefined) =>
  run?.agent.buildPrintCommand({ prompt: "", dangerouslySkipPermissions: true }).command;

describe("createGreenGate", () => {
  it("runs the repo's configured command", async () => {
    const { greenGate, commands } = gating({ exitCode: 0 });

    await greenGate(1);

    expect(commands).toEqual([config.greenGate]);
  });

  it("reads the exit code: zero is green, whatever the command printed", async () => {
    const { greenGate, runs } = gating({ exitCode: 0, stdout: "BUILD FAILURE mentioned in a log" });

    const result = await greenGate(1);

    expect(result.green).toBe(true);
    expect(result.detail).toContain(config.greenGate);
    // A green gate is the common case and needs no judgement, so it costs no run.
    expect(runs).toHaveLength(0);
  });

  it("triages a non-zero exit code and reports the detail the triage found", async () => {
    const { greenGate, runs } = gating({ exitCode: 1, triage: redTriage });

    const result = await greenGate(1);

    expect(result).toEqual({
      green: false,
      detail: "OrderTest.rejectsEmptyCart fails: cart is never null",
    });
    expect(runs).toHaveLength(1);
  });

  it("shows the triage the command, its exit code and what it printed", async () => {
    const { greenGate, runs } = gating({
      exitCode: 2,
      stdout: "Tests run: 41, Failures: 1",
      stderr: "OrderTest.rejectsEmptyCart:63 expected 400",
      triage: redTriage,
    });

    await greenGate(1);

    expect(runs[0]?.promptArgs).toEqual({
      COMMAND: config.greenGate,
      EXIT_CODE: "2",
      OUTPUT: "Tests run: 41, Failures: 1\nOrderTest.rejectsEmptyCart:63 expected 400",
    });
  });

  it("keeps the end of a huge run, where the failures are", async () => {
    const noise = "x".repeat(GATE_OUTPUT_TAIL * 2);
    const { greenGate, runs } = gating({
      exitCode: 1,
      stdout: `${noise}\nOrderTest failed`,
      triage: redTriage,
    });

    await greenGate(1);

    const output = runs[0]?.promptArgs?.OUTPUT ?? "";
    expect(output.length).toBeLessThanOrEqual(GATE_OUTPUT_TAIL);
    expect(output).toContain("OrderTest failed");
  });

  it("names each triage run for the attempt it belongs to", async () => {
    const { greenGate, runs } = gating({ exitCode: 1, triage: redTriage });

    await greenGate(1);
    await greenGate(2);

    expect(runs.map((run) => run.name)).toEqual(["green-gate-1", "green-gate-2"]);
  });

  it("runs the triage on the gate's model", async () => {
    const { greenGate, runs } = gating({ exitCode: 1, triage: redTriage });

    await greenGate(1);

    expect(commandOf(runs[0])).toContain(`--model '${config.models.greenGate}'`);
  });

  it("tolerates the build artefacts the gate command itself left behind", async () => {
    const { greenGate } = gating({
      exitCode: 1,
      triage: redTriage,
      dirt: "?? target/surefire-reports/\n",
    });

    // The dirt is the gate command's, not the leg's, so it must not crash the
    // pass out of the handover a red gate is owed.
    await expect(greenGate(1)).resolves.toEqual({
      green: false,
      detail: "OrderTest.rejectsEmptyCart fails: cart is never null",
    });
  });

  it("refuses a triage that fixed the branch itself", async () => {
    const { greenGate } = gating({ exitCode: 1, triage: redTriage, commits: [{ sha: "c0ffee" }] });

    await expect(greenGate(1)).rejects.toThrow(RoleError);
  });

  it("refuses a triage that said nothing about why the gate is red", async () => {
    const { greenGate } = gating({ exitCode: 1, triage: taggedTriage('{"detail":""}') });

    await expect(greenGate(1)).rejects.toThrow(RoleError);
  });

  it("refuses a triage that emitted no block", async () => {
    const { greenGate } = gating({ exitCode: 1, triage: "The build is red." });

    await expect(greenGate(1)).rejects.toThrow(RoleError);
  });
});
