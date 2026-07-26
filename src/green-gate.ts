import type { Sandbox } from "@ai-hero/sandcastle";
import { z } from "zod";
import type { RelayConfig } from "./config.js";
import type { Crew, GateResult } from "./crew.js";
import { runRole } from "./run-role.js";

/** The block the gate's triage leg ends its run with, and the prompt it runs from. */
export const GATE_TAG = "relay-gate";
const GATE_PROMPT = "green-gate.md";

/**
 * How much of a red run's output the triage leg is shown, in characters. A
 * full suite prints far more than a prompt can hold, and what failed is at the
 * end.
 */
export const GATE_OUTPUT_TAIL = 20_000;

/** What the triage leg reports: one description of why the branch is not green. */
const gateSchema = z.object({ detail: z.string().min(1) });

/**
 * The real green gate: run the repo's own command, and let its exit code
 * decide. relay never parses the output — a repo's build tool is its own
 * business, and an exit code is the one thing every build tool agrees on.
 *
 * A red run is handed to a cold session that reads what failed and says so in
 * the one line the fixer will act on. Green needs no judgement and costs no
 * run, which is what keeps the common case cheap.
 */
export function createGreenGate({ sandbox, config, outputDir }: { sandbox: Sandbox; config: RelayConfig; outputDir: string }): Crew["greenGate"] {
  return async function greenGate(attempt: number): Promise<GateResult> {
    const { stdout, stderr, exitCode } = await sandbox.exec(config.greenGate);
    if (exitCode === 0) {
      return { green: true, detail: `\`${config.greenGate}\` exited 0.` };
    }

    const { detail } = await runRole({
      sandbox,
      config,
      name: `green-gate-${attempt}`,
      outputDir,
      model: config.models.greenGate,
      prompt: GATE_PROMPT,
      promptArgs: {
        COMMAND: config.greenGate,
        EXIT_CODE: String(exitCode),
        OUTPUT: tail(`${stdout}\n${stderr}`),
      },
      tag: GATE_TAG,
      schema: gateSchema,
      // Triaging is not fixing: the fixer leg the harness runs next owns the
      // change, and a gate that fixed its own red would be marking its own
      // work. Dirt is not checked, because the gate command's own build
      // artefacts are already in the worktree before this leg starts.
      branchRule: () => "no-commits",
    });

    return { green: false, detail };
  };
}

function tail(output: string): string {
  return output.trim().slice(-GATE_OUTPUT_TAIL);
}
