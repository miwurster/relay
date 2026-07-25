import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createSandbox, type CreateSandboxOptions, type Sandbox } from "@ai-hero/sandcastle";
import { docker as dockerSandbox } from "@ai-hero/sandcastle/sandboxes/docker";
import type { RelayConfig } from "./config.js";
import {
  detectDockerSocketGid,
  DOCKER_SOCKET_PATH,
  resolveSandboxImage,
  resolveTestcontainersHost,
} from "./sandbox-image.js";
import type { Secrets } from "./secrets.js";
import { resolveSkillPlugins, type SkillPlugin } from "./skills.js";

/** The remote Atlassian MCP server the in-sandbox roles reach Jira through. */
export const ATLASSIAN_MCP_URL = "https://mcp.atlassian.com/v1/mcp";

/** Where the mounted Atlassian MCP config appears inside the sandbox. */
export const SANDBOX_MCP_CONFIG_PATH = "/opt/relay/mcp/atlassian.json";

/**
 * A fresh git worktree does not populate submodules, and a target repo that
 * keeps generated resources in one fails to build without them.
 */
const SUBMODULE_INIT = "git submodule update --init --recursive";

/** An open sandbox and the teardown that also removes its host-side MCP config. */
export interface RelaySandbox {
  readonly sandbox: Sandbox;
  close(): Promise<void>;
}

/**
 * The Atlassian MCP config the sandbox roles run with.
 *
 * The service-account bearer is referenced as an environment variable rather
 * than written out, so the token exists in the sandbox's environment only and
 * never on disk. Passing the header suppresses the interactive OAuth flow,
 * which is what makes the remote server usable headless.
 */
export function atlassianMcpConfig(): string {
  const config = {
    mcpServers: {
      atlassian: {
        type: "http",
        url: ATLASSIAN_MCP_URL,
        headers: { Authorization: "Bearer ${ATLASSIAN_SA_TOKEN}" },
      },
    },
  };
  return `${JSON.stringify(config, undefined, 2)}\n`;
}

/** Write the MCP config to a fresh host directory and return that directory. */
export async function writeMcpConfigDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "relay-mcp-"));
  await writeFile(join(dir, "atlassian.json"), atlassianMcpConfig(), "utf8");
  return dir;
}

/**
 * Everything the sandbox mounts at runtime: nothing here is baked into the
 * image, so skills stay at the operator's installed version and credentials
 * stay out of the image.
 */
export function sandboxMounts({
  plugins,
  mcpConfigDir,
}: {
  plugins: readonly SkillPlugin[];
  mcpConfigDir: string;
}) {
  return [
    { hostPath: DOCKER_SOCKET_PATH, sandboxPath: DOCKER_SOCKET_PATH },
    ...plugins.map((plugin) => ({
      hostPath: plugin.hostPath,
      sandboxPath: plugin.sandboxPath,
      readonly: true,
    })),
    { hostPath: mcpConfigDir, sandboxPath: dirname(SANDBOX_MCP_CONFIG_PATH), readonly: true },
  ];
}

/**
 * The sandbox environment: the host address Testcontainers must dial, and the
 * credentials the in-sandbox tools authenticate with (MCP bearer, `glab`,
 * `claude`).
 */
export function sandboxEnv({
  secrets,
  testcontainersHost,
}: {
  secrets: Secrets;
  testcontainersHost: string;
}): Record<string, string> {
  return {
    TESTCONTAINERS_HOST_OVERRIDE: testcontainersHost,
    ATLASSIAN_SA_TOKEN: secrets.atlassian.token,
    GITLAB_TOKEN: secrets.gitlabToken,
    [secrets.claude.variable]: secrets.claude.token,
  };
}

/** The branch one pass runs on. */
export function passBranch(config: RelayConfig, workItemKey: string): string {
  return `${config.branchPrefix}${workItemKey}`;
}

/**
 * The sandbox one pass runs in: a fresh worktree on its own branch, cut from
 * the repo's default branch, with the runtime mounts wired.
 *
 * The socket's in-container group is added to the non-root sandbox user so the
 * green gate's Testcontainers tier can reach the host daemon.
 */
export function sandboxOptions({
  repoRoot,
  config,
  secrets,
  branch,
  image,
  socketGid,
  testcontainersHost,
  plugins,
  mcpConfigDir,
}: {
  repoRoot: string;
  config: RelayConfig;
  secrets: Secrets;
  branch: string;
  image: string;
  socketGid: number;
  testcontainersHost: string;
  plugins: readonly SkillPlugin[];
  mcpConfigDir: string;
}): CreateSandboxOptions {
  return {
    cwd: repoRoot,
    branch,
    baseBranch: config.defaultBranch,
    hooks: { host: { onWorktreeReady: [{ command: SUBMODULE_INIT }] } },
    sandbox: dockerSandbox({
      imageName: image,
      groups: [socketGid],
      mounts: sandboxMounts({ plugins, mcpConfigDir }),
      env: sandboxEnv({ secrets, testcontainersHost }),
    }),
  };
}

/**
 * Open the pass's sandbox: resolve the image prebuilt-ref-first, detect what
 * only the host can tell us (socket group, Testcontainers host), mount the
 * installed skills and the MCP config, and create the worktree.
 */
export async function openSandbox({
  repoRoot,
  config,
  secrets,
  branch,
}: {
  repoRoot: string;
  config: RelayConfig;
  secrets: Secrets;
  branch: string;
}): Promise<RelaySandbox> {
  const image = await resolveSandboxImage({ repoRoot, config });
  const socketGid = await detectDockerSocketGid({ image });
  const testcontainersHost = await resolveTestcontainersHost();
  const plugins = await resolveSkillPlugins();
  const mcpConfigDir = await writeMcpConfigDir();
  const removeMcpConfig = () => rm(mcpConfigDir, { recursive: true, force: true });

  try {
    const sandbox = await createSandbox(
      sandboxOptions({
        repoRoot,
        config,
        secrets,
        branch,
        image,
        socketGid,
        testcontainersHost,
        plugins,
        mcpConfigDir,
      }),
    );

    return {
      sandbox,
      close: async () => {
        await sandbox.close();
        await removeMcpConfig();
      },
    };
  } catch (error) {
    await removeMcpConfig();
    throw error;
  }
}
