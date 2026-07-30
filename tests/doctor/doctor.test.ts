import { describe, expect, it } from "vitest";
import { runDoctor } from "../../src/doctor/doctor.js";
import type { GateProbe } from "../../src/doctor/gate-probe.js";
import { ExitCode } from "../../src/exit-codes.js";
import { PASS_LABELS } from "../../src/tracker/labels.js";
import {
  validConfig,
  mergeConfig,
  repoWith,
  envWithSecrets,
  EVERY_CHECK,
  ignoringGit,
  notIgnoringGit,
  dirtyGit,
  healthyDocker,
  healthyGh,
  ghWithPullRequestRuleset,
  unauthenticatedGh,
  ALL_LABELS,
  declaredProbe,
  inferredProbe,
  fakeSink,
  pendingLine,
  reportedNames,
} from "./doctor-fixtures.js";

describe("runDoctor", () => {
  it("succeeds when every check passes", async () => {
    const code = await runDoctor({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });
    expect(code).toBe(ExitCode.Success);
  });

  it("succeeds despite a dirty worktree, which is a warning and not a failure", async () => {
    const code = await runDoctor({
      repoRoot: await repoWith(mergeConfig),
      env: envWithSecrets(),
      git: dirtyGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });
    expect(code).toBe(ExitCode.Success);
  });

  it("exits with the error code when any check fails", async () => {
    const env = envWithSecrets();
    delete env["GH_TOKEN"];

    const code = await runDoctor({
      repoRoot: await repoWith(validConfig),
      env,
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });
    expect(code).toBe(ExitCode.Error);
  });

  it("exits with the error code when gh is not authenticated", async () => {
    const code = await runDoctor({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: unauthenticatedGh,
      probe: declaredProbe,
    });
    expect(code).toBe(ExitCode.Error);
  });

  it("fails a repo where the credential file is not ignored", async () => {
    const code = await runDoctor({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: notIgnoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });
    expect(code).toBe(ExitCode.Error);
  });

  it("fails a repo whose label vocabulary a pass would die on", async () => {
    const code = await runDoctor({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh(ALL_LABELS.filter((name) => name !== "agent-blocked")).gh,
      probe: declaredProbe,
    });
    expect(code).toBe(ExitCode.Error);
  });

  it("succeeds on missing triage labels — a repo may speak its own vocabulary", async () => {
    const code = await runDoctor({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh(PASS_LABELS.map(({ name }) => name)).gh,
      probe: declaredProbe,
    });
    expect(code).toBe(ExitCode.Success);
  });

  it("prints one line per check", async () => {
    const { out, chunks } = fakeSink(false);

    await runDoctor({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
      out,
    });

    const printed = chunks.join("");
    for (const name of EVERY_CHECK) {
      expect(printed).toContain(`${name}: `);
    }
  });

  it("announces a check before it runs and erases that line with the verdict", async () => {
    const { out, chunks } = fakeSink(true);

    await runDoctor({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
      out,
    });

    expect(chunks.join("")).toContain(`${pendingLine("gate")}\r\u001b[K    ok   gate: `);
  });

  it("writes each verdict before the next check starts", async () => {
    const { out, chunks } = fakeSink(true);
    const written: string[] = [];
    const probe: GateProbe = async () => {
      written.push(chunks.join(""));
      return { command: "npm run verify", provenance: "declared", source: "AGENTS.md" };
    };

    await runDoctor({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe,
      out,
    });

    // The gate's own pending line is out, and every earlier verdict with it —
    // so the report was arriving while the slowest check was still running.
    expect(written[0]).toContain("sandbox image: ");
    expect(written[0]).toContain(pendingLine("gate"));
    expect(written[0]).not.toContain("gate: ");
  });

  it("announces nothing for a check that never runs", async () => {
    const { out, chunks } = fakeSink(true);

    await runDoctor({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
      out,
    });

    const printed = chunks.join("");
    expect(printed).toContain("base branch ruleset: this repo lands through a pull request");
    expect(printed).not.toContain(pendingLine("base branch ruleset"));
  });

  it("announces nothing at all where no line can be erased", async () => {
    const { out, chunks } = fakeSink(false);

    await runDoctor({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
      out,
    });

    const printed = chunks.join("");
    expect(printed).not.toContain("\u001b");
    expect(printed).not.toMatch(/^ {3}run {3}/m);
    expect(reportedNames(chunks)).toEqual(EVERY_CHECK);
  });

  it("succeeds on an inferred gate — a guess is imperfect, not broken", async () => {
    const code = await runDoctor({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: inferredProbe,
    });
    expect(code).toBe(ExitCode.Success);
  });

  it("succeeds on a dirty worktree — a pass reads it again at its own start", async () => {
    const code = await runDoctor({
      repoRoot: await repoWith(mergeConfig),
      env: envWithSecrets(),
      git: dirtyGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });
    expect(code).toBe(ExitCode.Success);
  });

  it("fails a merge repo whose base branch requires a pull request", async () => {
    const code = await runDoctor({
      repoRoot: await repoWith(mergeConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: ghWithPullRequestRuleset().gh,
      probe: declaredProbe,
    });
    expect(code).toBe(ExitCode.Error);
  });

  it("prints a warning distinctly from an ok and from a failure", async () => {
    const { out, chunks } = fakeSink(false);

    await runDoctor({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: inferredProbe,
      out,
    });
    const gateLine = chunks.find((chunk) => chunk.includes("gate: "));

    expect(gateLine).toMatch(/warn/i);
    expect(gateLine).not.toMatch(/\bok\b|FAILED/);
  });
});
