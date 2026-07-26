import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { docker as dockerSandbox } from "@ai-hero/sandcastle/sandboxes/docker";
import { relayConfigSchema } from "../src/config.js";
import { DOCKER_SOCKET_PATH } from "../src/docker-host.js";
import {
  ATLASSIAN_MCP_URL,
  atlassianMcpConfig,
  passBranch,
  sandboxEnv,
  sandboxMounts,
  sandboxOptions,
  writeMcpConfigDir,
} from "../src/sandbox.js";
import type { Secrets } from "../src/secrets.js";

// The real provider resolves mounts against the host filesystem, which a unit
// test of the wiring has no business needing.
vi.mock("@ai-hero/sandcastle/sandboxes/docker", () => ({ docker: vi.fn() }));

const secrets: Secrets = {
  atlassian: { email: "sa@example.com", token: "ATSTT-token" },
  gitlabToken: "glpat-token",
  claude: { variable: "CLAUDE_CODE_OAUTH_TOKEN", token: "claude-token" },
};

const plugins = [
  { name: "kipu-all", hostPath: "/host/kipu-all", sandboxPath: "/opt/relay/plugins/kipu-all" },
];

const config = (defaultBranch = "main") =>
  relayConfigSchema.parse({
    greenGate: "./mvnw verify",
    defaultBranch,
    jira: { baseUrl: "https://example.atlassian.net" },
  });

describe("atlassianMcpConfig", () => {
  it("wires the remote HTTP server with the bearer taken from the environment", () => {
    const parsed = JSON.parse(atlassianMcpConfig());
    expect(parsed.mcpServers.atlassian).toEqual({
      type: "http",
      url: ATLASSIAN_MCP_URL,
      headers: { Authorization: "Bearer ${ATLASSIAN_SA_TOKEN}" },
    });
  });

  it("never writes the token itself into the file", async () => {
    const dir = await writeMcpConfigDir();
    const written = await readFile(join(dir, "atlassian.json"), "utf8");
    expect(written).toBe(atlassianMcpConfig());
    expect(written).not.toContain("ATSTT-token");
  });
});

describe("sandboxMounts", () => {
  it("mounts the docker socket, each plugin read-only, and the MCP config dir", () => {
    expect(sandboxMounts({ plugins, mcpConfigDir: "/tmp/relay-mcp" })).toEqual([
      { hostPath: DOCKER_SOCKET_PATH, sandboxPath: DOCKER_SOCKET_PATH },
      { hostPath: "/host/kipu-all", sandboxPath: "/opt/relay/plugins/kipu-all", readonly: true },
      { hostPath: "/tmp/relay-mcp", sandboxPath: "/opt/relay/mcp", readonly: true },
    ]);
  });
});

describe("sandboxEnv", () => {
  it("injects the Testcontainers host and the credentials the sandbox needs", () => {
    expect(sandboxEnv({ secrets, testcontainersHost: "host.docker.internal" })).toEqual({
      TESTCONTAINERS_HOST_OVERRIDE: "host.docker.internal",
      ATLASSIAN_SA_TOKEN: "ATSTT-token",
      GITLAB_TOKEN: "glpat-token",
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
  it("prefixes the work-item key with the configured branch prefix", () => {
    expect(passBranch(config(), "PSD-123")).toBe("agent/PSD-123");
  });
});

describe("sandboxOptions", () => {
  function optionsFor(defaultBranch: string) {
    return sandboxOptions({
      repoRoot: "/repo",
      config: config(defaultBranch),
      secrets,
      branch: "agent/PSD-123",
      host: {
        image: "relay-sandbox:repo",
        socketGid: 0,
        testcontainersHost: "host.docker.internal",
        plugins,
        mcpConfigDir: "/tmp/relay-mcp",
      },
    });
  }

  it("opens a fresh worktree on its own branch, cut from the default branch", () => {
    const options = optionsFor("trunk");
    expect(options.cwd).toBe("/repo");
    expect(options.branch).toBe("agent/PSD-123");
    expect(options.baseBranch).toBe("trunk");
  });

  it("initialises submodules in the worktree before anything builds", () => {
    const options = optionsFor("main");
    expect(options.hooks?.host?.onWorktreeReady).toEqual([
      { command: "git submodule update --init --recursive" },
    ]);
  });

  it("runs the resolved image with the socket group, mounts and env", () => {
    optionsFor("main");
    expect(dockerSandbox).toHaveBeenCalledWith({
      imageName: "relay-sandbox:repo",
      groups: [0],
      mounts: sandboxMounts({ plugins, mcpConfigDir: "/tmp/relay-mcp" }),
      env: sandboxEnv({ secrets, testcontainersHost: "host.docker.internal" }),
    });
  });
});

