import { describe, expect, it } from "vitest";
import {
  assertGhInSandbox,
  detectDockerSocketGid,
  dockerDaemonVersionInSandbox,
  resolveTestcontainersHost,
} from "../src/docker-host.js";
import { SandboxError } from "../src/errors.js";

/** Records the docker invocations and answers each with a canned line. */
function fakeDocker(answers: string[] = []) {
  const calls: string[][] = [];
  const docker = async (args: readonly string[]) => {
    calls.push([...args]);
    return answers.shift() ?? "";
  };
  return { docker, calls };
}

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

describe("assertGhInSandbox", () => {
  it("runs gh in the image and passes when it answers", async () => {
    const { docker, calls } = fakeDocker(["gh version 2.63.2"]);
    await expect(assertGhInSandbox({ image: "relay:local", docker })).resolves.toBeUndefined();
    expect(calls[0]).toEqual(["run", "--rm", "--entrypoint", "gh", "relay:local", "--version"]);
  });

  it("fails with the image name and what the operator must install", async () => {
    const docker = async () => {
      throw new SandboxError("docker run failed: executable file `gh` not found");
    };
    await expect(assertGhInSandbox({ image: "relay:local", docker })).rejects.toThrow(
      /relay:local.*Dockerfile/s,
    );
  });
});

describe("dockerDaemonVersionInSandbox", () => {
  it("asks the daemon for its version as the image's non-root user", async () => {
    const { docker, calls } = fakeDocker(["0", "29.6.2"]);
    expect(await dockerDaemonVersionInSandbox({ image: "relay:local", docker })).toBe("29.6.2");
    expect(calls[1]).toEqual([
      "run",
      "--rm",
      // No `--user`: the check is only worth anything as the image's own
      // non-root user, with the socket's group added the way the pass does it.
      "--group-add",
      "0",
      "--volume",
      "/var/run/docker.sock:/var/run/docker.sock",
      "--entrypoint",
      "docker",
      "relay:local",
      "version",
      "--format",
      "{{.Server.Version}}",
    ]);
  });

  it("fails when the daemon answers with no version at all", async () => {
    const { docker } = fakeDocker(["0", ""]);
    await expect(dockerDaemonVersionInSandbox({ image: "relay:local", docker })).rejects.toThrow(
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
