import { describe, expect, it, vi } from "vitest";
import { docker as dockerSandbox } from "@ai-hero/sandcastle/sandboxes/docker";
import { relayConfigSchema } from "../../src/config.js";
import { DOCKER_SOCKET_PATH } from "../../src/sandbox/docker-host.js";
import {
  passBranch,
  sandboxEnv,
  sandboxMounts,
  sandboxOptions,
} from "../../src/sandbox/sandbox.js";
import type { Secrets } from "../../src/host/secrets.js";

// The real provider resolves mounts against the host filesystem, which a unit
// test of the wiring has no business needing.
vi.mock("@ai-hero/sandcastle/sandboxes/docker", () => ({ docker: vi.fn() }));

const secrets: Secrets = {
  githubToken: "gh-token",
  claude: { variable: "CLAUDE_CODE_OAUTH_TOKEN", token: "claude-token" },
  sources: [
    { variable: "GH_TOKEN", from: "environment" },
    { variable: "CLAUDE_CODE_OAUTH_TOKEN", from: "environment" },
  ],
};

const plugins = [
  {
    name: "mattpocock-skills",
    hostPath: "/host/mattpocock-skills",
    sandboxPath: "/opt/relay/plugins/mattpocock-skills",
  },
];

const config = relayConfigSchema.parse({ landing: "pull-request" });

describe("sandboxMounts", () => {
  it("mounts the docker socket and each plugin read-only, and nothing else", () => {
    expect(sandboxMounts({ plugins })).toEqual([
      { hostPath: DOCKER_SOCKET_PATH, sandboxPath: DOCKER_SOCKET_PATH },
      {
        hostPath: "/host/mattpocock-skills",
        sandboxPath: "/opt/relay/plugins/mattpocock-skills",
        readonly: true,
      },
    ]);
  });
});

describe("sandboxEnv", () => {
  it("carries the Testcontainers host and the two credentials the sandbox needs", () => {
    expect(sandboxEnv({ secrets, testcontainersHost: "host.docker.internal" })).toEqual({
      TESTCONTAINERS_HOST_OVERRIDE: "host.docker.internal",
      GH_TOKEN: "gh-token",
      CLAUDE_CODE_OAUTH_TOKEN: "claude-token",
    });
  });

  it("injects the Claude credential under the variable it was resolved from", () => {
    const env = sandboxEnv({
      secrets: { ...secrets, claude: { variable: "ANTHROPIC_API_KEY", token: "sk-key" } },
      testcontainersHost: "172.17.0.1",
    });
    expect(env["ANTHROPIC_API_KEY"]).toBe("sk-key");
    expect(env["CLAUDE_CODE_OAUTH_TOKEN"]).toBeUndefined();
  });
});

describe("passBranch", () => {
  it("prefixes the work item with the configured branch prefix", () => {
    expect(passBranch(config, 123)).toBe("agent/123");
  });
});

describe("sandboxOptions", () => {
  function optionsFor(baseBranch: string) {
    return sandboxOptions({
      repoRoot: "/repo",
      secrets,
      branch: "agent/123",
      baseBranch,
      host: {
        image: "relay-sandbox:repo",
        socketGid: 0,
        testcontainersHost: "host.docker.internal",
        plugins,
      },
    });
  }

  it("opens a fresh worktree on its own branch, cut from the base branch", () => {
    const options = optionsFor("trunk");
    expect(options.cwd).toBe("/repo");
    expect(options.branch).toBe("agent/123");
    expect(options.baseBranch).toBe("trunk");
  });

  it("initialises submodules in the worktree before anything builds", () => {
    const options = optionsFor("main");
    expect(options.hooks?.host?.onWorktreeReady).toEqual([
      { command: "git submodule update --init --recursive" },
    ]);
  });

  it("claims the repo root docker fabricated for the `.git` mount, non-recursively", () => {
    const options = optionsFor("main");
    expect(options.hooks?.sandbox?.onSandboxReady?.[0]).toEqual({
      command: `chown ${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000} /repo`,
      sudo: true,
    });
  });

  it("installs the lockfile's dependencies after the chown, so the gate's command exists", () => {
    const options = optionsFor("main");
    const install = options.hooks?.sandbox?.onSandboxReady?.[1];
    expect(install?.command).toContain("pnpm install --frozen-lockfile");
    expect(install?.command).toContain("npm ci");
    expect(install?.command).toContain("uv sync --frozen");
    expect(options.hooks?.sandbox?.onSandboxReady).toHaveLength(2);
  });

  it("runs the resolved image with the socket group, mounts and env", () => {
    optionsFor("main");
    expect(dockerSandbox).toHaveBeenCalledWith({
      imageName: "relay-sandbox:repo",
      groups: [0],
      mounts: sandboxMounts({ plugins }),
      env: sandboxEnv({ secrets, testcontainersHost: "host.docker.internal" }),
    });
  });
});
