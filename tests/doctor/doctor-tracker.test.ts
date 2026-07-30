import { describe, expect, it } from "vitest";
import { runDoctorChecks } from "../../src/doctor/doctor.js";
import { PASS_LABELS } from "../../src/tracker/labels.js";
import {
  validConfig,
  repoWith,
  envWithSecrets,
  ignoringGit,
  healthyDocker,
  ALL_LABELS,
  healthyGh,
  unauthenticatedGh,
  missingGh,
  declaredProbe,
  check,
} from "./doctor-fixtures.js";

describe("runDoctorChecks — what this host's `gh` and this repo's label vocabulary look like", () => {
  it("names the host's gh version and the account it is logged in as", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    expect(check(checks, "gh installed").detail).toContain("2.62.0");
    expect(check(checks, "gh authenticated").detail).toContain("github.com");
  });

  it("reports a missing gh, skips the auth check, and still runs the docker checks", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: missingGh,
      probe: declaredProbe,
    });

    expect(check(checks, "gh installed").status).toBe("failed");
    expect(check(checks, "gh installed").detail).toContain("PATH");
    expect(check(checks, "gh authenticated").status).toBe("skipped");
    expect(check(checks, "docker daemon").status).toBe("ok");
  });

  it("reports a present-but-unauthenticated gh as a failure of its own", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: unauthenticatedGh,
      probe: declaredProbe,
    });

    expect(check(checks, "gh installed").status).toBe("ok");
    expect(check(checks, "gh authenticated").status).toBe("failed");
    expect(check(checks, "gh authenticated").detail).toContain("gh auth login");
    expect(check(checks, "docker daemon").status).toBe("ok");
  });

  it("reports the gh checks even when the config is invalid", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(`export default { landing: "pull-request" };`),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    expect(check(checks, "gh installed").status).toBe("ok");
    expect(check(checks, "gh authenticated").status).toBe("ok");
  });

  it("asks gh only what the checks need", async () => {
    const { gh, calls } = healthyGh();

    await runDoctorChecks({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh,
      probe: declaredProbe,
    });

    expect(calls).toEqual([
      ["--version"],
      ["auth", "status"],
      ["label", "list", "--json", "name", "--limit", "200"],
    ]);
  });

  it("fails on a missing pass label, which would kill a pass mid-flight", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh(ALL_LABELS.filter((name) => name !== "agent-in-progress")).gh,
      probe: declaredProbe,
    });

    expect(check(checks, "labels").status).toBe("failed");
    expect(check(checks, "labels").detail).toContain("agent-in-progress");
    expect(check(checks, "triage labels").status).toBe("ok");
  });

  it("only warns on a missing triage label, which a repo may rename", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh(PASS_LABELS.map(({ name }) => name)).gh,
      probe: declaredProbe,
    });

    expect(check(checks, "labels").status).toBe("ok");
    expect(check(checks, "triage labels").status).toBe("warning");
    expect(check(checks, "triage labels").detail).toContain("needs-triage");
  });

  it("counts a differently-cased label as present", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh(ALL_LABELS.map((name) => name.toUpperCase())).gh,
      probe: declaredProbe,
    });

    expect(check(checks, "labels").status).toBe("ok");
    expect(check(checks, "triage labels").status).toBe("ok");
  });

  it("reads the labels on a gh that prints its auth status on stderr", async () => {
    const gh = async (args: readonly string[]) => {
      if (args[0] === "--version") return "gh version 2.62.0 (2024-11-14)";
      if (args[0] === "auth") return "";
      return JSON.stringify(ALL_LABELS.map((name) => ({ name })));
    };

    const checks = await runDoctorChecks({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh,
      probe: declaredProbe,
    });

    expect(check(checks, "gh authenticated").status).toBe("ok");
    expect(check(checks, "labels").status).toBe("ok");
    expect(check(checks, "triage labels").status).toBe("ok");
  });

  it("skips both label checks when gh has no credential to read them with", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: unauthenticatedGh,
      probe: declaredProbe,
    });

    expect(check(checks, "labels").status).toBe("skipped");
    expect(check(checks, "triage labels").status).toBe("skipped");
  });

  it("skips both label checks when there is no gh at all", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: missingGh,
      probe: declaredProbe,
    });

    expect(check(checks, "labels").status).toBe("skipped");
    expect(check(checks, "triage labels").status).toBe("skipped");
  });

  it("reports a refused label read as a failure of both checks", async () => {
    const gh = async (args: readonly string[]) => {
      if (args[0] === "--version") return "gh version 2.62.0 (2024-11-14)";
      if (args[0] === "auth") return "✓ Logged in to github.com account octocat";
      throw new Error("HTTP 404: Not Found");
    };

    const checks = await runDoctorChecks({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh,
      probe: declaredProbe,
    });

    expect(check(checks, "labels").status).toBe("failed");
    expect(check(checks, "labels").detail).toContain("404");
    expect(check(checks, "triage labels").status).toBe("failed");
  });
});
