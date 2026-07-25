import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { ConfigError } from "./errors.js";

/**
 * The installed Claude plugins whose skills the pass's roles run, as
 * `<plugin>@<marketplace>` keys.
 *
 * Skills are never baked into the sandbox image: the host's installed plugin
 * directories are bind-mounted and each role passes `--plugin-dir`, so a role
 * runs the same skill version the operator has installed. Proven in spike 02.
 */
export const SKILL_PLUGINS = ["kipu-all@kipu", "caveman@caveman"] as const;

/** Where the mounted plugin directories appear inside the sandbox. */
export const SANDBOX_PLUGIN_ROOT = "/opt/relay/plugins";

/** One host plugin directory and the sandbox path it is mounted at. */
export interface SkillPlugin {
  name: string;
  hostPath: string;
  sandboxPath: string;
}

/** The file Claude records its installed plugins in, and their install paths. */
export function pluginsFilePath(env: NodeJS.ProcessEnv = process.env): string {
  const configDir = env["CLAUDE_CONFIG_DIR"] ?? join(env["HOME"] ?? homedir(), ".claude");
  return join(configDir, "plugins", "installed_plugins.json");
}

/**
 * Resolve every required plugin to the host directory it is installed in.
 *
 * A plugin relay cannot find is an operator setup problem, so all of them are
 * reported in one `ConfigError` rather than one per run.
 */
export async function resolveSkillPlugins(
  env: NodeJS.ProcessEnv = process.env,
): Promise<SkillPlugin[]> {
  const path = pluginsFilePath(env);
  const installed = await readInstalledPlugins(path);

  const plugins: SkillPlugin[] = [];
  const missing: string[] = [];
  for (const key of SKILL_PLUGINS) {
    const name = key.split("@")[0] ?? key;
    const hostPath = installPath(installed, key);
    if (hostPath) {
      plugins.push({ name, hostPath, sandboxPath: `${SANDBOX_PLUGIN_ROOT}/${name}` });
    } else {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    throw new ConfigError(
      `Plugin(s) not installed: ${missing.join(", ")}. ` +
        `relay mounts their skills into the sandbox; install them first (see ${path}).`,
    );
  }
  return plugins;
}

async function readInstalledPlugins(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new ConfigError(
      `Could not read Claude's installed plugins at ${path}. ` +
        "relay mounts plugin skills from the host's Claude installation.",
    );
  }
}

/**
 * The install path Claude recorded for a plugin key, from the first entry that
 * carries one — a plugin may be installed at more than one scope.
 */
function installPath(installed: unknown, key: string): string | undefined {
  const entries = (installed as { plugins?: Record<string, unknown> })?.plugins?.[key];
  if (!Array.isArray(entries)) return undefined;
  for (const entry of entries) {
    const path = (entry as { installPath?: unknown })?.installPath;
    if (typeof path === "string" && path) return path;
  }
  return undefined;
}
