import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_DOCKERFILE_PATH, RELAY_DIR } from "../../src/config.js";
import { runDoctorChecks } from "../../src/doctor/doctor.js";
import { sandboxImageName } from "../../src/sandbox/sandbox-image.js";
import {
  validConfig,
  mergeConfig,
  repoWith,
  envWithSecrets,
  ignoringGit,
  detachedGit,
  unbornGit,
  healthyDocker,
  healthyGh,
  fakeProbe,
  declaredProbe,
  inferredProbe,
  check,
} from "./doctor-fixtures.js";

describe("runDoctorChecks — what a pass would run in and verify with: the image, the daemon and the gate", () => {
  it("names the resolved image so a human can eyeball it", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    expect(check(checks, "sandbox image").detail).toContain("registry.example.com/relay:1");
    expect(check(checks, "sandbox image").detail).toContain("prebuilt, present on this host");
    expect(check(checks, "docker daemon").detail).toContain("29.6.2");
  });

  it("reports a prebuilt ref proven in its registry rather than on this host", async () => {
    const docker = async (args: readonly string[]) => {
      if (args[0] === "image") throw new Error("Error: No such image");
      if (args[0] === "manifest") return '{"schemaVersion":2}';
      if (args.includes("stat")) return "0";
      return "29.6.2";
    };

    const checks = await runDoctorChecks({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    expect(check(checks, "sandbox image").status).toBe("ok");
    expect(check(checks, "sandbox image").detail).toContain("prebuilt, pullable");
  });

  it("reports an unbuildable image and skips the daemon check that needs it", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(`export default { landing: "pull-request" };`),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    expect(check(checks, "sandbox image").status).toBe("failed");
    expect(check(checks, "sandbox image").detail).toContain(DEFAULT_DOCKERFILE_PATH);
    expect(check(checks, "docker daemon").status).toBe("skipped");
  });

  it("reports a prebuilt ref that is on neither the host nor a registry", async () => {
    const docker = async () => {
      throw new Error("manifest unknown: manifest tagged 1 not found");
    };

    const checks = await runDoctorChecks({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    expect(check(checks, "sandbox image").status).toBe("failed");
    expect(check(checks, "sandbox image").detail).toContain("manifest unknown");
    expect(check(checks, "docker daemon").status).toBe("skipped");
  });

  it("reports a daemon the non-root sandbox user cannot reach", async () => {
    const docker = async (args: readonly string[]) => {
      if (args[0] === "image") return "sha256:abc";
      if (args.includes("stat")) return "0";
      throw new Error("permission denied while trying to connect to the Docker daemon socket");
    };

    const checks = await runDoctorChecks({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    expect(check(checks, "docker daemon").status).toBe("failed");
    expect(check(checks, "docker daemon").detail).toContain("permission denied");
  });

  it("builds the repo's dockerfile rather than assuming an image is there", async () => {
    const root = await repoWith(`export default { landing: "pull-request" };`);
    await mkdir(join(root, RELAY_DIR), { recursive: true });
    await writeFile(join(root, DEFAULT_DOCKERFILE_PATH), "FROM scratch\n", "utf8");
    const { docker, calls } = healthyDocker();

    const checks = await runDoctorChecks({
      repoRoot: root,
      env: envWithSecrets(),
      git: ignoringGit,
      docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    expect(check(checks, "sandbox image").status).toBe("ok");
    expect(calls[0]?.[0]).toBe("build");
  });

  it("builds a recipe repo's image once, and hands that image to the gate probe", async () => {
    const root = await repoWith(`export default { landing: "pull-request" };`);
    await mkdir(join(root, RELAY_DIR), { recursive: true });
    await writeFile(join(root, DEFAULT_DOCKERFILE_PATH), "FROM scratch\n", "utf8");
    const { docker, calls } = healthyDocker();
    const { probe, calls: probed } = fakeProbe({
      command: "npm run verify",
      provenance: "declared",
      source: "AGENTS.md",
    });

    const checks = await runDoctorChecks({
      repoRoot: root,
      env: envWithSecrets(),
      git: ignoringGit,
      docker,
      gh: healthyGh().gh,
      probe,
    });

    expect(calls.filter((call) => call[0] === "build")).toHaveLength(1);
    expect(probed[0]?.image).toBe(sandboxImageName(root));
    expect(check(checks, "sandbox image").detail).toContain(sandboxImageName(root));
  });

  it("hands the gate probe the prebuilt ref it proved, and reports that same ref", async () => {
    const { probe, calls } = fakeProbe({
      command: "npm run verify",
      provenance: "declared",
      source: "AGENTS.md",
    });

    const checks = await runDoctorChecks({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe,
    });

    expect(calls[0]?.image).toBe("registry.example.com/relay:1");
    expect(check(checks, "sandbox image").detail).toContain(calls[0]?.image);
  });

  it("names the command a pass will verify with, and the doc it was declared in", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    expect(check(checks, "gate").status).toBe("ok");
    expect(check(checks, "gate").detail).toContain("npm run verify");
    expect(check(checks, "gate").detail).toContain("AGENTS.md, under Verifying");
  });

  it("warns on a gate relay had to infer, and says what it inferred it from", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: inferredProbe,
    });

    expect(check(checks, "gate").status).toBe("warning");
    expect(check(checks, "gate").detail).toContain("./mvnw verify");
    expect(check(checks, "gate").detail).toContain("pom.xml is a Maven build");
  });

  it("probes the repo doctor was pointed at", async () => {
    const repoRoot = await repoWith(validConfig);
    const { probe, calls } = fakeProbe({
      command: "make test",
      provenance: "declared",
      source: "README.md",
    });

    await runDoctorChecks({
      repoRoot,
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe,
    });

    expect(calls).toEqual([
      { repoRoot, baseBranch: "main", image: "registry.example.com/relay:1" },
    ]);
  });

  it("reports a probe that failed without stopping the checks after it", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: async () => {
        throw new Error("the resolver ended without a gate block");
      },
    });

    expect(check(checks, "gate").status).toBe("failed");
    expect(check(checks, "gate").detail).toContain("without a gate block");
    expect(check(checks, "docker daemon").status).toBe("ok");
  });

  it("skips the gate check when the config it would open a sandbox from is invalid", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(`export default { landing: "pull-request" };`),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    expect(check(checks, "gate").status).toBe("skipped");
    expect(check(checks, "docker daemon").status).toBe("skipped");
  });

  it("skips the gate check when a secret the resolver's leg needs is missing", async () => {
    const env = envWithSecrets();
    delete env["CLAUDE_CODE_OAUTH_TOKEN"];

    const checks = await runDoctorChecks({
      repoRoot: await repoWith(validConfig),
      env,
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    expect(check(checks, "gate").status).toBe("skipped");
    expect(check(checks, "docker daemon").status).toBe("ok");
  });

  it("skips the gate check when there is no image to run it in", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(`export default { landing: "pull-request" };`),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    expect(check(checks, "sandbox image").status).toBe("failed");
    expect(check(checks, "gate").status).toBe("skipped");
    expect(check(checks, "docker daemon").status).toBe("skipped");
  });

  it("skips the gate check on a detached HEAD, which the landing check already failed", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(mergeConfig),
      env: envWithSecrets(),
      git: detachedGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    expect(checks.filter((c) => c.status === "failed").map((c) => c.name)).toEqual(["landing"]);
    expect(check(checks, "gate").status).toBe("skipped");
    expect(check(checks, "gate").detail).toContain("no base branch");
  });

  it("reads the same way on an unborn HEAD, which names a branch with no commits", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(mergeConfig),
      env: envWithSecrets(),
      git: unbornGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    expect(checks.filter((c) => c.status === "failed").map((c) => c.name)).toEqual(["landing"]);
    expect(check(checks, "gate").status).toBe("skipped");
    expect(check(checks, "gate").detail).toContain("no base branch");
  });
});
