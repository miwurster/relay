import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Sandbox, SandboxRunOptions, SandboxRunResult } from "@ai-hero/sandcastle";
import { beforeEach, describe, expect, it } from "vitest";
import { relayConfigSchema } from "../../../src/config.js";
import { RoleError } from "../../../src/errors.js";
import { createGateResolver, RESOLVED_GATE_TAG } from "../../../src/crew/roles/gate-resolver.js";
import { readResource } from "../../../src/resources.js";
import { expectPromptParity } from "./prompt-parity.js";

const config = relayConfigSchema.parse({ landing: "pull-request" });

/** A sandbox whose only real behaviour is the stdout the resolver run returns. */
function resolving(stdout: string, commits: { sha: string }[] = []) {
  const runs: SandboxRunOptions[] = [];
  const sandbox = {
    async run(options: SandboxRunOptions): Promise<SandboxRunResult> {
      runs.push(options);
      return { iterations: [], stdout, commits };
    },
  } as unknown as Sandbox;

  return { resolveGate: createGateResolver({ sandbox, config, recordDir }), runs };
}

const taggedGate = (json: string) =>
  `Read the docs.\n<${RESOLVED_GATE_TAG}>${json}</${RESOLVED_GATE_TAG}>`;

let recordDir: string;

beforeEach(async () => {
  recordDir = await mkdtemp(join(tmpdir(), "relay-gate-resolver-"));
});

describe("createGateResolver", () => {
  it("returns the declared gate it read out of the repo's docs", async () => {
    const { resolveGate } = resolving(
      taggedGate(
        '{"command":"npm run verify","provenance":"declared",' +
          '"source":"AGENTS.md, under Verifying"}',
      ),
    );

    await expect(resolveGate()).resolves.toEqual({
      command: "npm run verify",
      provenance: "declared",
      source: "AGENTS.md, under Verifying",
    });
  });

  it("returns an inferred gate the same way, so a pass is never blocked", async () => {
    const { resolveGate } = resolving(
      taggedGate(
        '{"command":"./mvnw verify","provenance":"inferred",' +
          '"source":"no doc declares a gate; pom.xml is a Maven build"}',
      ),
    );

    await expect(resolveGate()).resolves.toEqual({
      command: "./mvnw verify",
      provenance: "inferred",
      source: "no doc declares a gate; pom.xml is a Maven build",
    });
  });

  it("runs one-shot on its own entry in the model map", async () => {
    const { resolveGate, runs } = resolving(
      taggedGate('{"command":"make test","provenance":"declared","source":"AGENTS.md"}'),
    );

    await resolveGate();

    expect(runs).toHaveLength(1);
    const [run] = runs;
    expect(run?.name).toBe("gate-resolver");
    expect(run?.maxIterations).toBe(1);
    expect(
      run?.agent.buildPrintCommand({ prompt: "", dangerouslySkipPermissions: true }).command,
    ).toContain(`--model '${config.models["gate-resolver"]}'`);
    // The one role that takes no arguments: its prompt has to hold no
    // placeholders either, or the run fails on the first one it cannot fill.
    expect(run?.promptArgs).toEqual({});
    await expectPromptParity(run, "gate-resolver.md");
  });

  it("fails as a role error when the run emitted no block", async () => {
    const { resolveGate } = resolving("I had a look at AGENTS.md and it says `npm run verify`.");

    await expect(resolveGate()).rejects.toThrow(RoleError);
  });

  it("fails as a role error on a malformed block, never as a bad command", async () => {
    const { resolveGate } = resolving(taggedGate('{"command":"npm run verify"}'));

    await expect(resolveGate()).rejects.toThrow(RoleError);
  });

  it("refuses a provenance it does not know", async () => {
    const { resolveGate } = resolving(
      taggedGate('{"command":"make test","provenance":"guessed","source":"a hunch"}'),
    );

    await expect(resolveGate()).rejects.toThrow(RoleError);
  });

  it("may not commit", async () => {
    const { resolveGate } = resolving(
      taggedGate('{"command":"make test","provenance":"declared","source":"AGENTS.md"}'),
      [{ sha: "c0ffee" }],
    );

    await expect(resolveGate()).rejects.toThrow(RoleError);
  });

  it("is not failed for a worktree it did not dirty", async () => {
    const { resolveGate } = resolving(
      taggedGate('{"command":"make test","provenance":"declared","source":"AGENTS.md"}'),
    );

    // No `git status` seam on this sandbox at all: a dirt check would throw.
    await expect(resolveGate()).resolves.toMatchObject({ command: "make test" });
  });
});

/**
 * The resolver's behaviour is its prompt's — the reading order, the static
 * check and the inference ladder are that session's judgement, so what the
 * prompt instructs is the only thing there is to assert about them.
 */
describe("the gate resolver prompt", () => {
  let prompt: string;

  beforeEach(async () => {
    prompt = await readResource("gate-resolver.md");
  });

  it("ends the run with the block relay reads the gate out of", () => {
    expect(prompt).toContain(`<${RESOLVED_GATE_TAG}>`);
  });

  it("reads the root doc graph in precedence order, following `@`-includes", () => {
    expect(prompt).toMatch(/`AGENTS\.md`[\s\S]*`CLAUDE\.md`[\s\S]*`README\.md`/);
    expect(prompt).toMatch(/follow every `@`-include/);
    expect(prompt).toMatch(/first explicit statement/);
  });

  it("resolves a declaration behind a `CLAUDE.md` that only includes `AGENTS.md`", () => {
    expect(prompt).toMatch(/`CLAUDE\.md` only `@`-includes `AGENTS\.md`[\s\S]*read it/);
  });

  it("leaves per-directory docs out, since the gate is repo-wide", () => {
    expect(prompt).toMatch(/Per-directory `AGENTS\.md`[\s\S]*not/);
  });

  it("confirms the declared command's target exists without running it", () => {
    expect(prompt).toMatch(/never run/i);
    expect(prompt).toMatch(/manifest[\s\S]*Makefile[\s\S]*wrapper/);
  });

  it("infers a gate rather than blocking the pass, and says so in `source`", () => {
    expect(prompt).toMatch(/Maven[\s\S]*uv[\s\S]*verify/);
    expect(prompt).toContain("never block");
  });
});
