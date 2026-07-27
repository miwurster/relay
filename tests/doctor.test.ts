import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { type DoctorCheck, runDoctor, runDoctorChecks } from "../src/doctor.js";
import { ExitCode } from "../src/exit-codes.js";

const validConfig = `export default {
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

/** Answers each `gh` invocation with a canned line, recording the calls. */
function fakeGh(answers: string[] = []) {
  const calls: string[][] = [];
  const gh = async (args: readonly string[]) => {
    calls.push([...args]);
    return answers.shift() ?? "";
  };
  return { gh, calls };
}

/** A healthy host's `gh`: a version, then a logged-in auth status. */
const healthyGh = () =>
  fakeGh(["gh version 2.62.0 (2024-11-14)", "✓ Logged in to github.com account octocat"]);

/** A `gh` that is on the PATH but has no valid credential. */
const unauthenticatedGh = async (args: readonly string[]) => {
  if (args[0] === "--version") return "gh version 2.62.0 (2024-11-14)";
  throw new Error("You are not logged into any GitHub hosts. Run gh auth login to authenticate.");
};

/** A host with no `gh` at all: every invocation fails the way `execFile` does. */
const missingGh = async () => {
  throw new Error("spawn gh ENOENT");
};

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
      gh: healthyGh().gh,
    });

    expect(checks.map((c) => c.name)).toEqual([
      "config",
      "secrets",
      "gh installed",
      "gh authenticated",
      "sandbox image",
      "docker daemon",
    ]);
    expect(checks.every((c) => c.status === "ok")).toBe(true);
  });

  it("names the resolved image so a human can eyeball it", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(validConfig),
      env: await envWithSecrets(),
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
    });

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
      gh: healthyGh().gh,
    });

    expect(check(checks, "secrets").status).toBe("failed");
    expect(check(checks, "secrets").detail).toContain("GH_TOKEN");
    expect(check(checks, "docker daemon").status).toBe("ok");
  });

  it("reports an invalid config and skips the checks that need it", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(`export default {};`),
      env: await envWithSecrets(),
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
    });

    expect(check(checks, "config").status).toBe("failed");
    expect(check(checks, "sandbox image").status).toBe("skipped");
    expect(check(checks, "docker daemon").status).toBe("skipped");
  });

  it("reports an unbuildable image and skips the daemon check that needs it", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(`export default {
        defaultBranch: "main",
      };`),
      env: await envWithSecrets(),
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
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
      gh: healthyGh().gh,
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
      gh: healthyGh().gh,
    });

    expect(check(checks, "docker daemon").status).toBe("failed");
    expect(check(checks, "docker daemon").detail).toContain("permission denied");
  });

  it("builds the repo's dockerfile rather than assuming an image is there", async () => {
    const root = await repoWith(`export default {
      defaultBranch: "main",
    };`);
    await mkdir(join(root, "docker"), { recursive: true });
    await writeFile(join(root, "docker/relay.Dockerfile"), "FROM scratch\n", "utf8");
    const { docker, calls } = healthyDocker();

    const checks = await runDoctorChecks({
      repoRoot: root,
      env: await envWithSecrets(),
      docker,
      gh: healthyGh().gh,
    });

    expect(check(checks, "sandbox image").status).toBe("ok");
    expect(calls[0]?.[0]).toBe("build");
  });

  it("names the host's gh version and the account it is logged in as", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(validConfig),
      env: await envWithSecrets(),
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
    });

    expect(check(checks, "gh installed").detail).toContain("2.62.0");
    expect(check(checks, "gh authenticated").detail).toContain("github.com");
  });

  it("reports a missing gh, skips the auth check, and still runs the docker checks", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(validConfig),
      env: await envWithSecrets(),
      docker: healthyDocker().docker,
      gh: missingGh,
    });

    expect(check(checks, "gh installed").status).toBe("failed");
    expect(check(checks, "gh installed").detail).toContain("PATH");
    expect(check(checks, "gh authenticated").status).toBe("skipped");
    expect(check(checks, "docker daemon").status).toBe("ok");
  });

  it("reports a present-but-unauthenticated gh as a failure of its own", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(validConfig),
      env: await envWithSecrets(),
      docker: healthyDocker().docker,
      gh: unauthenticatedGh,
    });

    expect(check(checks, "gh installed").status).toBe("ok");
    expect(check(checks, "gh authenticated").status).toBe("failed");
    expect(check(checks, "gh authenticated").detail).toContain("gh auth login");
    expect(check(checks, "docker daemon").status).toBe("ok");
  });

  it("reports the gh checks even when the config is invalid", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(`export default {};`),
      env: await envWithSecrets(),
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
    });

    expect(check(checks, "gh installed").status).toBe("ok");
    expect(check(checks, "gh authenticated").status).toBe("ok");
  });

  it("asks gh only what the two checks need", async () => {
    const { gh, calls } = healthyGh();

    await runDoctorChecks({
      repoRoot: await repoWith(validConfig),
      env: await envWithSecrets(),
      docker: healthyDocker().docker,
      gh,
    });

    expect(calls).toEqual([["--version"], ["auth", "status"]]);
  });
});

describe("runDoctor", () => {
  it("succeeds when every check passes", async () => {
    const code = await runDoctor({
      repoRoot: await repoWith(validConfig),
      env: await envWithSecrets(),
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
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
      gh: healthyGh().gh,
    });
    expect(code).toBe(ExitCode.Error);
  });

  it("exits with the error code when gh is not authenticated", async () => {
    const code = await runDoctor({
      repoRoot: await repoWith(validConfig),
      env: await envWithSecrets(),
      docker: healthyDocker().docker,
      gh: unauthenticatedGh,
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
        gh: healthyGh().gh,
      });
      const printed = log.mock.calls.map((call) => String(call[0])).join("\n");
      for (const name of [
        "config",
        "secrets",
        "gh installed",
        "gh authenticated",
        "sandbox image",
        "docker daemon",
      ]) {
        expect(printed).toContain(name);
      }
    } finally {
      log.mockRestore();
    }
  });
});
