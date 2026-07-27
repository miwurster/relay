import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { type DoctorCheck, runDoctor, runDoctorChecks } from "../src/doctor.js";
import { ExitCode } from "../src/exit-codes.js";

const validConfig = `export default {
  greenGate: "./mvnw verify",
  defaultBranch: "main",
  image: "registry.example.com/relay:1",
};`;

const completeSecrets = {
  GH_TOKEN: "gh-token",
  CLAUDE_CODE_OAUTH_TOKEN: "oauth-token",
};

/** A repo root holding the given `relay.config.ts`, if any. */
async function repoWith(configSource: string | undefined): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "relay-doctor-"));
  if (configSource !== undefined) {
    await writeFile(join(root, "relay.config.ts"), configSource, "utf8");
  }
  return root;
}

/** An env carrying every secret, and no home-dir file to fall back to. */
async function envWithSecrets(overrides: Record<string, string> = {}): Promise<NodeJS.ProcessEnv> {
  const configHome = await mkdtemp(join(tmpdir(), "relay-doctor-home-"));
  return { XDG_CONFIG_HOME: configHome, ...completeSecrets, ...overrides };
}

/** Answers each docker invocation with a canned line, recording the calls. */
function fakeDocker(answers: string[] = []) {
  const calls: string[][] = [];
  const docker = async (args: readonly string[]) => {
    calls.push([...args]);
    return answers.shift() ?? "";
  };
  return { docker, calls };
}

/** A healthy host's answers: the image's id, the socket gid, the server version. */
const healthyDocker = () => fakeDocker(["sha256:abc", "0", "29.6.2"]);

function check(checks: readonly DoctorCheck[], name: string): DoctorCheck {
  const found = checks.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`No ${name} check in ${checks.map((c) => c.name).join(", ")}`);
  return found;
}

describe("runDoctorChecks", () => {
  it("reports every check as ok on a wired-up repo", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(validConfig),
      env: await envWithSecrets(),
      docker: healthyDocker().docker,
    });

    expect(checks.map((c) => c.name)).toEqual([
      "config",
      "secrets",
      "sandbox image",
      "docker daemon",
    ]);
    expect(checks.every((c) => c.status === "ok")).toBe(true);
  });

  it("names the green gate and the resolved image so a human can eyeball them", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(validConfig),
      env: await envWithSecrets(),
      docker: healthyDocker().docker,
    });

    expect(check(checks, "config").detail).toContain("./mvnw verify");
    expect(check(checks, "sandbox image").detail).toContain("registry.example.com/relay:1");
    expect(check(checks, "docker daemon").detail).toContain("29.6.2");
  });

  it("reports a missing secret without stopping at the first failure", async () => {
    const env = await envWithSecrets();
    delete env["GH_TOKEN"];

    const checks = await runDoctorChecks({
      repoRoot: await repoWith(validConfig),
      env,
      docker: healthyDocker().docker,
    });

    expect(check(checks, "secrets").status).toBe("failed");
    expect(check(checks, "secrets").detail).toContain("GH_TOKEN");
    expect(check(checks, "docker daemon").status).toBe("ok");
  });

  it("reports an invalid config and skips the checks that need it", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(`export default { greenGate: "" };`),
      env: await envWithSecrets(),
      docker: healthyDocker().docker,
    });

    expect(check(checks, "config").status).toBe("failed");
    expect(check(checks, "sandbox image").status).toBe("skipped");
    expect(check(checks, "docker daemon").status).toBe("skipped");
  });

  it("reports an unbuildable image and skips the daemon check that needs it", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(`export default {
        greenGate: "./mvnw verify",
        defaultBranch: "main",
      };`),
      env: await envWithSecrets(),
      docker: healthyDocker().docker,
    });

    expect(check(checks, "sandbox image").status).toBe("failed");
    expect(check(checks, "sandbox image").detail).toContain("relay.Dockerfile");
    expect(check(checks, "docker daemon").status).toBe("skipped");
  });

  it("reports a prebuilt ref that is on neither the host nor a registry", async () => {
    const docker = async () => {
      throw new Error("manifest unknown: manifest tagged 1 not found");
    };

    const checks = await runDoctorChecks({
      repoRoot: await repoWith(validConfig),
      env: await envWithSecrets(),
      docker,
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
      env: await envWithSecrets(),
      docker,
    });

    expect(check(checks, "docker daemon").status).toBe("failed");
    expect(check(checks, "docker daemon").detail).toContain("permission denied");
  });

  it("builds the repo's dockerfile rather than assuming an image is there", async () => {
    const root = await repoWith(`export default {
      greenGate: "./mvnw verify",
      defaultBranch: "main",
    };`);
    await mkdir(join(root, "docker"), { recursive: true });
    await writeFile(join(root, "docker/relay.Dockerfile"), "FROM scratch\n", "utf8");
    const { docker, calls } = healthyDocker();

    const checks = await runDoctorChecks({ repoRoot: root, env: await envWithSecrets(), docker });

    expect(check(checks, "sandbox image").status).toBe("ok");
    expect(calls[0]?.[0]).toBe("build");
  });
});

describe("runDoctor", () => {
  it("succeeds when every check passes", async () => {
    const code = await runDoctor({
      repoRoot: await repoWith(validConfig),
      env: await envWithSecrets(),
      docker: healthyDocker().docker,
    });
    expect(code).toBe(ExitCode.Success);
  });

  it("exits with the error code when any check fails", async () => {
    const env = await envWithSecrets();
    delete env["GH_TOKEN"];

    const code = await runDoctor({
      repoRoot: await repoWith(validConfig),
      env,
      docker: healthyDocker().docker,
    });
    expect(code).toBe(ExitCode.Error);
  });

  it("prints one line per check", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await runDoctor({
        repoRoot: await repoWith(validConfig),
        env: await envWithSecrets(),
        docker: healthyDocker().docker,
      });
      const printed = log.mock.calls.map((call) => String(call[0])).join("\n");
      for (const name of ["config", "secrets", "sandbox image", "docker daemon"]) {
        expect(printed).toContain(name);
      }
    } finally {
      log.mockRestore();
    }
  });
});
