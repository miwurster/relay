import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { relayConfigSchema } from "../src/config.js";
import { ConfigError, SandboxError } from "../src/errors.js";
import {
  detectDockerSocketGid,
  resolveDockerfile,
  resolveSandboxImage,
  resolveTestcontainersHost,
  sandboxImageName,
} from "../src/sandbox-image.js";

const config = (overrides: Record<string, unknown> = {}) =>
  relayConfigSchema.parse({
    greenGate: "./mvnw verify",
    defaultBranch: "main",
    jira: { baseUrl: "https://example.atlassian.net" },
    ...overrides,
  });

async function repoWithDockerfile(relativePath: string | undefined): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "relay-image-"));
  if (relativePath !== undefined) {
    const path = join(root, relativePath);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, "FROM scratch\n", "utf8");
  }
  return root;
}

/** Records the docker invocations and answers each with a canned line. */
function fakeDocker(answers: string[] = []) {
  const calls: string[][] = [];
  const docker = async (args: readonly string[]) => {
    calls.push([...args]);
    return answers.shift() ?? "";
  };
  return { docker, calls };
}

describe("resolveDockerfile", () => {
  it("resolves the configured path against the repo root", async () => {
    const root = await repoWithDockerfile("docker/relay.Dockerfile");
    expect(resolveDockerfile(root, "docker/relay.Dockerfile")).toBe(
      join(root, "docker/relay.Dockerfile"),
    );
  });

  it("refuses a dockerfile at the repo root", async () => {
    const root = await repoWithDockerfile("Dockerfile");
    expect(() => resolveDockerfile(root, "Dockerfile")).toThrow(/repo root/);
  });

  it("refuses a dockerfile path that escapes the repo", async () => {
    const root = await repoWithDockerfile("docker/relay.Dockerfile");
    expect(() => resolveDockerfile(root, "../elsewhere/relay.Dockerfile")).toThrow(
      /inside the repo/,
    );
  });

  it("rejects a dockerfile that does not exist", async () => {
    const root = await repoWithDockerfile(undefined);
    expect(() => resolveDockerfile(root, "docker/relay.Dockerfile")).toThrow(ConfigError);
  });
});

describe("resolveSandboxImage", () => {
  it("uses the prebuilt image ref without building", async () => {
    const { docker, calls } = fakeDocker();
    const image = await resolveSandboxImage({
      repoRoot: await repoWithDockerfile(undefined),
      config: config({ image: "registry.example.com/relay:1" }),
      docker,
    });
    expect(image).toBe("registry.example.com/relay:1");
    expect(calls).toEqual([]);
  });

  it("builds from the dockerfile path with the host UID/GID as build args", async () => {
    const repoRoot = await repoWithDockerfile("docker/relay.Dockerfile");
    const { docker, calls } = fakeDocker();
    const image = await resolveSandboxImage({
      repoRoot,
      config: config(),
      docker,
      uid: 502,
      gid: 20,
    });
    expect(image).toBe(sandboxImageName(repoRoot));
    expect(calls).toEqual([
      [
        "build",
        "--build-arg",
        "AGENT_UID=502",
        "--build-arg",
        "AGENT_GID=20",
        "--tag",
        sandboxImageName(repoRoot),
        "--file",
        join(repoRoot, "docker/relay.Dockerfile"),
        repoRoot,
      ],
    ]);
  });
});

describe("detectDockerSocketGid", () => {
  it("reads the socket's group as it is seen inside a container", async () => {
    const { docker, calls } = fakeDocker(["0"]);
    expect(await detectDockerSocketGid({ image: "relay:local", docker })).toBe(0);
    expect(calls[0]).toEqual([
      "run",
      "--rm",
      "--user",
      "0",
      "--volume",
      "/var/run/docker.sock:/var/run/docker.sock",
      // The image idles on its entrypoint, so `stat` must replace it.
      "--entrypoint",
      "stat",
      "relay:local",
      "--format",
      "%g",
      "/var/run/docker.sock",
    ]);
  });

  it("fails when the daemon does not answer with a group id", async () => {
    const { docker } = fakeDocker(["no such file"]);
    await expect(detectDockerSocketGid({ image: "relay:local", docker })).rejects.toThrow(
      SandboxError,
    );
  });

  it("fails on empty output rather than falling back to the root group", async () => {
    const { docker } = fakeDocker([""]);
    await expect(detectDockerSocketGid({ image: "relay:local", docker })).rejects.toThrow(
      SandboxError,
    );
  });
});

describe("resolveTestcontainersHost", () => {
  it("uses the Docker Desktop host alias on macOS", async () => {
    const { docker, calls } = fakeDocker();
    expect(await resolveTestcontainersHost({ platform: "darwin", docker })).toBe(
      "host.docker.internal",
    );
    expect(calls).toEqual([]);
  });

  it("uses the bridge gateway address on a Linux daemon", async () => {
    const { docker } = fakeDocker(["172.17.0.1"]);
    expect(await resolveTestcontainersHost({ platform: "linux", docker })).toBe("172.17.0.1");
  });

  it("fails when a Linux daemon reports no bridge gateway", async () => {
    const { docker } = fakeDocker([""]);
    await expect(resolveTestcontainersHost({ platform: "linux", docker })).rejects.toThrow(
      SandboxError,
    );
  });
});
