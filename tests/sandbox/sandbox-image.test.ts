import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_DOCKERFILE_PATH, relayConfigSchema } from "../../src/config.js";
import { ConfigError, SandboxError } from "../../src/errors.js";
import {
  resolveDockerfile,
  resolveSandboxImage,
  sandboxImageName,
  verifyPrebuiltImage,
} from "../../src/sandbox/sandbox-image.js";

const config = (overrides: Record<string, unknown> = {}) =>
  relayConfigSchema.parse({ landing: "pull-request", ...overrides });

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
    const root = await repoWithDockerfile(DEFAULT_DOCKERFILE_PATH);
    expect(resolveDockerfile(root, DEFAULT_DOCKERFILE_PATH)).toBe(
      join(root, DEFAULT_DOCKERFILE_PATH),
    );
  });

  it("refuses a dockerfile at the repo root", async () => {
    const root = await repoWithDockerfile("Dockerfile");
    expect(() => resolveDockerfile(root, "Dockerfile")).toThrow(/repo root/);
  });

  it("refuses a dockerfile path that escapes the repo", async () => {
    const root = await repoWithDockerfile(DEFAULT_DOCKERFILE_PATH);
    expect(() => resolveDockerfile(root, "../elsewhere/relay.Dockerfile")).toThrow(
      /inside the repo/,
    );
  });

  it("rejects a dockerfile that does not exist", async () => {
    const root = await repoWithDockerfile(undefined);
    expect(() => resolveDockerfile(root, DEFAULT_DOCKERFILE_PATH)).toThrow(ConfigError);
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
    const repoRoot = await repoWithDockerfile(DEFAULT_DOCKERFILE_PATH);
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
        join(repoRoot, DEFAULT_DOCKERFILE_PATH),
        repoRoot,
      ],
    ]);
  });
});

describe("verifyPrebuiltImage", () => {
  it("accepts a ref already pulled onto the host", async () => {
    const { docker, calls } = fakeDocker(["sha256:abc"]);
    expect(await verifyPrebuiltImage({ image: "relay:1", docker })).toBe("host");
    expect(calls).toEqual([["image", "inspect", "--format", "{{.Id}}", "relay:1"]]);
  });

  it("falls back to the registry manifest for a ref not pulled yet", async () => {
    const calls: string[][] = [];
    const docker = async (args: readonly string[]) => {
      calls.push([...args]);
      if (args[0] === "image") throw new SandboxError("No such image: relay:1");
      return "{}";
    };
    expect(await verifyPrebuiltImage({ image: "relay:1", docker })).toBe("registry");
    expect(calls[1]).toEqual(["manifest", "inspect", "relay:1"]);
  });

  it("fails when neither the host nor the registry has the ref", async () => {
    const docker = async () => {
      throw new SandboxError("manifest unknown");
    };
    await expect(verifyPrebuiltImage({ image: "relay:1", docker })).rejects.toThrow(SandboxError);
  });
});
