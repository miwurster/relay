import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ResumeSandboxRunResultOptions, Sandbox, SandboxRunResult } from "@ai-hero/sandcastle";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { relayConfigSchema } from "../../src/config.js";
import { runRole } from "../../src/crew/run-role.js";
import { RoleError } from "../../src/errors.js";

const config = relayConfigSchema.parse({ landing: "pull-request" });

const TAG = "relay-fix";

const schema = z.object({ kind: z.literal("done") });

const tagged = (json: string) => `Talked my way there.\n<${TAG}>${json}</${TAG}>`;

const DONE = tagged('{"kind":"done"}');

/** One attempt's outcome: what the agent said, and what it committed. */
interface Attempt {
  stdout: string;
  commits?: { sha: string }[];
}

/**
 * A sandbox whose one run answers with the first attempt, and whose `resume`
 * answers with the second — or is absent, when the provider cannot resume.
 */
function fakeSandbox(attempts: readonly Attempt[], { resumable = true } = {}) {
  const prompts: string[] = [];
  const resumeOptions: (ResumeSandboxRunResultOptions | undefined)[] = [];
  const resultOf = (index: number): SandboxRunResult => {
    const attempt = attempts[index] ?? { stdout: "" };
    const next =
      resumable && index + 1 < attempts.length
        ? async (prompt: string, options?: ResumeSandboxRunResultOptions) => {
            prompts.push(prompt);
            resumeOptions.push(options);
            return resultOf(index + 1);
          }
        : undefined;
    return { iterations: [], stdout: attempt.stdout, commits: attempt.commits ?? [], resume: next };
  };
  const sandbox = {
    async run(): Promise<SandboxRunResult> {
      return resultOf(0);
    },
    async exec() {
      return { stdout: "", stderr: "", exitCode: 0 };
    },
  } as unknown as Sandbox;
  return { sandbox, prompts, resumeOptions };
}

let recordDir: string;

beforeEach(async () => {
  recordDir = await mkdtemp(join(tmpdir(), "relay-run-role-"));
});

function running(
  attempts: readonly Attempt[],
  {
    resumable = true,
    branchRule,
    promptArgs = {},
  }: {
    resumable?: boolean;
    branchRule?: () => "read-only" | "must-commit";
    promptArgs?: Record<string, string>;
  } = {},
) {
  const { sandbox, prompts, resumeOptions } = fakeSandbox(attempts, { resumable });
  const run = () =>
    runRole({
      sandbox,
      config,
      recordDir,
      name: "fixer-quality",
      model: "claude-sonnet-5",
      prompt: "prompts/fix.md",
      promptArgs,
      tag: TAG,
      schema,
      branchRule,
    });
  return { run, prompts, resumeOptions };
}

const statusFile = async () =>
  JSON.parse(await readFile(join(recordDir, "fixer-quality.status.json"), "utf8")) as Record<
    string,
    unknown
  >;

describe("runRole", () => {
  it("returns the answer of a leg that got its block right the first time", async () => {
    const { run, prompts } = running([{ stdout: DONE }]);

    await expect(run()).resolves.toEqual({ kind: "done" });
    expect(prompts).toEqual([]);
  });

  it.each([
    ["no tagged block", "I addressed both findings.", "emitted no <relay-fix> block"],
    ["a block that is not JSON", tagged("both findings addressed"), "is not JSON"],
    ["a block that fails its schema", tagged('{"kind":"maybe"}'), "does not fit"],
  ])("records %s as a failure with the raw output", async (_case, stdout, expected) => {
    const { run } = running([{ stdout }, { stdout }]);

    await expect(run()).rejects.toThrow(RoleError);

    expect(await statusFile()).toEqual({
      role: "fixer-quality",
      model: "claude-sonnet-5",
      failure: expect.stringContaining(expected) as string,
      stdout: expect.stringContaining(stdout) as string,
    });
  });

  it("keeps both attempts' output, since the first is where the role said the most", async () => {
    const { run } = running([
      { stdout: "I addressed both findings by rewriting the parser." },
      { stdout: "Sorry — here it is:" },
    ]);

    await expect(run()).rejects.toThrow(RoleError);

    const { stdout } = await statusFile();
    expect(stdout).toContain("rewriting the parser");
    expect(stdout).toContain("Sorry");
  });

  it.each([
    ["no tagged block", "I addressed both findings."],
    ["a block that is not JSON", tagged("both findings addressed")],
    ["a block that fails its schema", tagged('{"kind":"maybe"}')],
  ])("retries %s once and returns the second answer", async (_case, stdout) => {
    const { run, prompts } = running([{ stdout }, { stdout: DONE }]);

    await expect(run()).resolves.toEqual({ kind: "done" });
    expect(prompts).toHaveLength(1);
    expect(await statusFile()).toEqual({
      role: "fixer-quality",
      model: "claude-sonnet-5",
      answer: { kind: "done" },
    });
  });

  it("clears the first attempt's prompt arguments, which an inline retry prompt cannot carry", async () => {
    const { run, resumeOptions } = running([{ stdout: "nothing" }, { stdout: DONE }], {
      promptArgs: { TICKET: "#42" },
    });

    await run();

    expect(resumeOptions[0]).toMatchObject({ promptArgs: {} });
  });

  it("tells the retry which tag to re-emit and what was wrong", async () => {
    const { run, prompts } = running([{ stdout: "I addressed both findings." }, { stdout: DONE }]);

    await run();

    expect(prompts[0]).toContain(`<${TAG}>`);
    expect(prompts[0]).toContain("emitted no <relay-fix> block");
  });

  it("raises the role error the pass blocks on when the retry fails too", async () => {
    const { run, prompts } = running([{ stdout: "nothing" }, { stdout: "still nothing" }]);

    await expect(run()).rejects.toThrow(/fixer-quality emitted no <relay-fix> block\./);
    expect(prompts).toHaveLength(1);
  });

  it("fails without retrying when the provider cannot resume", async () => {
    const { run, prompts } = running([{ stdout: "nothing" }, { stdout: DONE }], {
      resumable: false,
    });

    await expect(run()).rejects.toThrow(RoleError);
    expect(prompts).toEqual([]);
    expect(await statusFile()).toMatchObject({ stdout: "nothing" });
  });

  it("counts a first attempt's commits towards a must-commit leg the retry answered", async () => {
    const { run } = running(
      [
        { stdout: "nothing", commits: [{ sha: "c0ffee" }] },
        { stdout: DONE, commits: [] },
      ],
      { branchRule: () => "must-commit" },
    );

    await expect(run()).resolves.toEqual({ kind: "done" });
  });

  it("counts a retry's commits against a read-only leg", async () => {
    const { run } = running(
      [
        { stdout: "nothing", commits: [] },
        { stdout: DONE, commits: [{ sha: "c0ffee" }] },
      ],
      { branchRule: () => "read-only" },
    );

    await expect(run()).rejects.toThrow(/may not commit but committed 1 commit\(s\)/);
  });
});
