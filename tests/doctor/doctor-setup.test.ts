import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CREDENTIAL_FILE_PATH } from "../../src/config.js";
import { runDoctorChecks } from "../../src/doctor/doctor.js";
import { TRACKER_DOC_PATH } from "../../src/tracker/tracker-doc.js";
import { SKILL_PLUGINS } from "../../src/sandbox/skills.js";
import {
  validConfig,
  mergeConfig,
  repoWith,
  hostWithNoPlugins,
  hostWithoutPluginVersions,
  envWithSecrets,
  envWithoutSecrets,
  EVERY_CHECK,
  ignoringGit,
  notIgnoringGit,
  healthyDocker,
  healthyGh,
  missingGh,
  declaredProbe,
  check,
} from "./doctor-fixtures.js";

describe("runDoctorChecks — the repo's own setup: config, ignore rules, secrets, plugins and the tracker doc", () => {
  // Under `merge` landing, which is the one mode where no check is skipped.
  it("reports every check as ok on a wired-up repo", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(mergeConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    expect(checks.map((c) => c.name)).toEqual(EVERY_CHECK);
    expect(checks.every((c) => c.status === "ok")).toBe(true);
  });

  it("reports the same checks in the same order on a host with nothing wired up", async () => {
    const repoRoot = await repoWith(undefined);
    await rm(join(repoRoot, ".gitignore"));
    await rm(join(repoRoot, TRACKER_DOC_PATH));

    const checks = await runDoctorChecks({
      repoRoot,
      env: { CLAUDE_CONFIG_DIR: hostWithNoPlugins },
      git: notIgnoringGit,
      docker: async () => {
        throw new Error("Cannot connect to the Docker daemon at unix:///var/run/docker.sock");
      },
      gh: missingGh,
      probe: declaredProbe,
    });

    expect(checks.map((c) => c.name)).toEqual(EVERY_CHECK);
    expect(checks.every((c) => c.status === "failed" || c.status === "skipped")).toBe(true);
  });

  it("reports a missing secret without stopping at the first failure", async () => {
    const env = envWithSecrets();
    delete env["GH_TOKEN"];

    const checks = await runDoctorChecks({
      repoRoot: await repoWith(validConfig),
      env,
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    expect(check(checks, "secrets").status).toBe("failed");
    expect(check(checks, "secrets").detail).toContain("GH_TOKEN");
    expect(check(checks, "docker daemon").status).toBe("ok");
  });

  it("reports a repo whose .gitignore misses the worktree directory", async () => {
    const repoRoot = await repoWith(validConfig);
    await rm(join(repoRoot, ".gitignore"));

    const checks = await runDoctorChecks({
      repoRoot,
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    expect(check(checks, "worktree ignored").status).toBe("failed");
    expect(check(checks, "worktree ignored").detail).toContain(".sandcastle/");
    expect(check(checks, "docker daemon").status).toBe("ok");
  });

  it("names where each secret resolved from, and prints no value", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    const detail = check(checks, "secrets").detail;
    expect(detail).toBe("GH_TOKEN and CLAUDE_CODE_OAUTH_TOKEN from the environment");
    expect(detail).not.toContain("gh-token");
    expect(detail).not.toContain("oauth-token");
  });

  it("distinguishes a secret from the credential file from one from the environment", async () => {
    const repoRoot = await repoWith(validConfig);
    await writeFile(join(repoRoot, CREDENTIAL_FILE_PATH), "GH_TOKEN=from-file\n", "utf8");

    const checks = await runDoctorChecks({
      repoRoot,
      env: envWithSecrets({ GH_TOKEN: "" }),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    expect(check(checks, "secrets").detail).toBe(
      `GH_TOKEN from ${CREDENTIAL_FILE_PATH}, CLAUDE_CODE_OAUTH_TOKEN from the environment`,
    );
  });

  it("reads the credential file out of the repo doctor was pointed at", async () => {
    const repoRoot = await repoWith(validConfig);
    await writeFile(
      join(repoRoot, CREDENTIAL_FILE_PATH),
      "GH_TOKEN=from-file\nANTHROPIC_API_KEY=from-file\n",
      "utf8",
    );

    const checks = await runDoctorChecks({
      repoRoot,
      env: envWithoutSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    expect(check(checks, "secrets").status).toBe("ok");
    expect(check(checks, "secrets").detail).toBe(
      `GH_TOKEN and ANTHROPIC_API_KEY from ${CREDENTIAL_FILE_PATH}`,
    );
  });

  it("fails a repo where git does not ignore the credential file", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: notIgnoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    expect(check(checks, "credentials ignored").status).toBe("failed");
    expect(check(checks, "credentials ignored").detail).toContain(CREDENTIAL_FILE_PATH);
    expect(check(checks, "docker daemon").status).toBe("ok");
  });

  it("names every plugin a pass mounts, and the version installed", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    expect(check(checks, "skill plugins").status).toBe("ok");
    expect(check(checks, "skill plugins").detail).toBe("mattpocock-skills 1.0.0");
  });

  it("still passes a plugin whose install Claude recorded no version for", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets({ CLAUDE_CONFIG_DIR: hostWithoutPluginVersions }),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    expect(check(checks, "skill plugins").status).toBe("ok");
    expect(check(checks, "skill plugins").detail).toBe("mattpocock-skills (no version)");
  });

  it("names every missing plugin in one check, and how to install them", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets({ CLAUDE_CONFIG_DIR: hostWithNoPlugins }),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    const plugins = check(checks, "skill plugins");
    expect(plugins.status).toBe("failed");
    for (const key of SKILL_PLUGINS) expect(plugins.detail).toContain(key);
    expect(plugins.detail).toContain("/plugin install");
  });

  it("passes the tracker doc check on a repo that commits its tracker doc", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    expect(check(checks, "tracker doc").status).toBe("ok");
    expect(check(checks, "tracker doc").detail).toContain(TRACKER_DOC_PATH);
  });

  it("fails a repo that commits no tracker doc, without stopping the checks after it", async () => {
    const repoRoot = await repoWith(validConfig);
    await rm(join(repoRoot, TRACKER_DOC_PATH));

    const checks = await runDoctorChecks({
      repoRoot,
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    expect(check(checks, "tracker doc").status).toBe("failed");
    expect(check(checks, "tracker doc").detail).toContain(TRACKER_DOC_PATH);
    expect(check(checks, "docker daemon").status).toBe("ok");
  });

  it("asks git only what the checks need, in the repo it was pointed at", async () => {
    const repoRoot = await repoWith(validConfig);
    const calls: string[][] = [];
    const git = async (args: readonly string[]) => {
      calls.push([...args]);
      return await ignoringGit(args);
    };

    await runDoctorChecks({
      repoRoot,
      env: envWithSecrets(),
      git,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    expect(calls).toEqual([
      ["-C", repoRoot, "check-ignore", "-q", CREDENTIAL_FILE_PATH],
      ["-C", repoRoot, "symbolic-ref", "--short", "HEAD"],
      ["-C", repoRoot, "rev-parse", "--verify", "--quiet", "HEAD"],
    ]);
  });

  it("reports an invalid config and skips the checks that need it", async () => {
    const checks = await runDoctorChecks({
      // A config still carrying the deleted defaultBranch key, which is the
      // migration every repo on an older relay has to make.
      repoRoot: await repoWith(`export default { defaultBranch: "main" };`),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    expect(check(checks, "config").status).toBe("failed");
    expect(check(checks, "sandbox image").status).toBe("skipped");
    expect(check(checks, "docker daemon").status).toBe("skipped");
    // Both prerequisites read only the host's own state, so neither is ever
    // skipped for something earlier in the report.
    expect(check(checks, "skill plugins").status).toBe("ok");
    expect(check(checks, "tracker doc").status).toBe("ok");
  });
});
