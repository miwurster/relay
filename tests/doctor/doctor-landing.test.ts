import { describe, expect, it } from "vitest";
import { runDoctorChecks } from "../../src/doctor/doctor.js";
import {
  validConfig,
  mergeConfig,
  repoWith,
  envWithSecrets,
  ignoringGit,
  dirtyGit,
  detachedGit,
  unbornGit,
  healthyDocker,
  healthyGh,
  ghWithPullRequestRuleset,
  unauthenticatedGh,
  fakeProbe,
  declaredProbe,
  check,
} from "./doctor-fixtures.js";

describe("runDoctorChecks — where a pass would land: the base branch, its rulesets and this worktree", () => {
  it("reports the landing and the branch a pass would land on", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(mergeConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    expect(check(checks, "landing").status).toBe("ok");
    expect(check(checks, "landing").detail).toContain("merge");
    expect(check(checks, "landing").detail).toContain("main");
  });

  it("reports the branch a pull-request pass would target", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    expect(check(checks, "landing").status).toBe("ok");
    expect(check(checks, "landing").detail).toContain("pull-request");
    expect(check(checks, "landing").detail).toContain("main");
  });

  it("fails the landing check on a detached HEAD, which names no branch", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(mergeConfig),
      env: envWithSecrets(),
      git: detachedGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    expect(check(checks, "landing").status).toBe("failed");
    expect(check(checks, "landing").detail).toContain("detached");
    expect(check(checks, "docker daemon").status).toBe("ok");
  });

  it("fails the landing check on a branch with no commits to be cut from", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(mergeConfig),
      env: envWithSecrets(),
      git: unbornGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    expect(check(checks, "landing").status).toBe("failed");
    expect(check(checks, "landing").detail).toContain("no commits yet");
  });

  it("resolves the base branch once and hands it to the gate probe", async () => {
    const gitCalls: string[][] = [];
    const git = async (args: readonly string[]) => {
      gitCalls.push([...args]);
      return await ignoringGit(args);
    };
    const { probe, calls } = fakeProbe({
      command: "npm run verify",
      provenance: "declared",
      source: "AGENTS.md",
    });

    const repoRoot = await repoWith(mergeConfig);
    await runDoctorChecks({
      repoRoot,
      env: envWithSecrets(),
      git,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe,
    });

    expect(calls).toEqual([
      { repoRoot, baseBranch: "main", image: "registry.example.com/relay:1" },
    ]);
    expect(gitCalls.filter((call) => call.includes("symbolic-ref"))).toHaveLength(1);
  });

  it("skips the merge-only checks when the landing check found no branch", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(mergeConfig),
      env: envWithSecrets(),
      git: detachedGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    expect(check(checks, "base branch ruleset").status).toBe("skipped");
    expect(check(checks, "worktree clean").status).toBe("skipped");
  });

  it("passes the ruleset check on a base branch no ruleset guards", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(mergeConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    expect(check(checks, "base branch ruleset").status).toBe("ok");
    expect(check(checks, "base branch ruleset").detail).toContain("main");
  });

  it("fails a base branch whose ruleset requires a pull request, and names it", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(mergeConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: ghWithPullRequestRuleset().gh,
      probe: declaredProbe,
    });

    expect(check(checks, "base branch ruleset").status).toBe("failed");
    expect(check(checks, "base branch ruleset").detail).toContain("42");
    expect(check(checks, "base branch ruleset").detail).toContain("miwurster/relay");
    expect(check(checks, "docker daemon").status).toBe("ok");
  });

  it("asks the rulesets endpoint about the base branch, not a dry-run push", async () => {
    const { gh, calls } = healthyGh();

    await runDoctorChecks({
      repoRoot: await repoWith(mergeConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh,
      probe: declaredProbe,
    });

    expect(calls).toContainEqual(["api", "repos/{owner}/{repo}/rules/branches/main"]);
  });

  it("skips the ruleset check when no credential can ask GitHub about it", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(mergeConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: unauthenticatedGh,
      probe: declaredProbe,
    });

    expect(check(checks, "base branch ruleset").status).toBe("skipped");
    expect(check(checks, "worktree clean").status).toBe("ok");
  });

  it("only warns on a dirty worktree, which a pass reads at its own start", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(mergeConfig),
      env: envWithSecrets(),
      git: dirtyGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    expect(check(checks, "worktree clean").status).toBe("warning");
    expect(check(checks, "worktree clean").detail).toContain("uncommitted work");
    expect(check(checks, "worktree clean").detail).toContain("main");
  });

  it("skips both merge-only checks under pull-request landing", async () => {
    const { gh, calls } = healthyGh();

    const checks = await runDoctorChecks({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: dirtyGit,
      docker: healthyDocker().docker,
      gh,
      probe: declaredProbe,
    });

    expect(check(checks, "base branch ruleset").status).toBe("skipped");
    expect(check(checks, "worktree clean").status).toBe("skipped");
    expect(calls.flat()).not.toContain("api");
  });

  it("skips the landing check and the merge-only checks when the config is invalid", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(`export default { defaultBranch: "main" };`),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    expect(check(checks, "landing").status).toBe("skipped");
    expect(check(checks, "base branch ruleset").status).toBe("skipped");
    expect(check(checks, "worktree clean").status).toBe("skipped");
  });
});
