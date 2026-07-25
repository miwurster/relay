import { type AgentProvider, claudeCode } from "@ai-hero/sandcastle";
import { RoleError } from "./errors.js";
import { SANDBOX_MCP_CONFIG_PATH } from "./sandbox.js";
import { SANDBOX_PLUGIN_DIRS } from "./skills.js";

/**
 * The agent one role runs as: Claude on the role's model, with the sandbox's
 * mounted plugin skills and Atlassian MCP server loaded.
 *
 * Both are session-scoped CLI flags rather than image or home-directory state,
 * so nothing about them survives the role's run — which is what keeps every
 * role a cold session over the same worktree.
 */
export function roleAgent(model: string): AgentProvider {
  const base = claudeCode(model);
  return {
    ...base,
    buildPrintCommand(options) {
      const printed = base.buildPrintCommand(options);
      return { ...printed, command: withRoleFlags(printed.command) };
    },
  };
}

/** The flags every role's `claude` invocation carries. */
function roleFlags(): string {
  const pluginDirs = SANDBOX_PLUGIN_DIRS.map((dir) => `--plugin-dir ${dir}`);
  return [...pluginDirs, `--mcp-config ${SANDBOX_MCP_CONFIG_PATH}`].join(" ");
}

/**
 * Insert the flags right after the executable. The provider builds one command
 * string and takes no flags of its own, so this is the seam relay has — and a
 * command relay cannot recognise is worth failing on, since a role that
 * silently lost its skills and its tracker access looks like a bad answer.
 */
function withRoleFlags(command: string): string {
  const prefix = "claude ";
  if (!command.startsWith(prefix)) {
    throw new RoleError(`Cannot add relay's flags to an unrecognised agent command: ${command}`);
  }
  return `${prefix}${roleFlags()} ${command.slice(prefix.length)}`;
}
