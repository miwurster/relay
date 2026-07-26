import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
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

/** The mount points a role loads its skills from, in the sandbox's filesystem. */
export const SANDBOX_PLUGIN_DIRS = SKILL_PLUGINS.map((key) => sandboxPluginPath(pluginName(key)));

function pluginName(key: string): string {
  return key.split("@")[0] ?? key;
}

function sandboxPluginPath(name: string): string {
  return `${SANDBOX_PLUGIN_ROOT}/${name}`;
}

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
export async function resolveSkillPlugins(env: NodeJS.ProcessEnv = process.env): Promise<SkillPlugin[]> {
  const path = pluginsFilePath(env);
  const installed = await readInstalledPlugins(path);

  const plugins: SkillPlugin[] = [];
  const missing: string[] = [];
  for (const key of SKILL_PLUGINS) {
    const name = pluginName(key);
    // A plugin may be installed at more than one scope; the first entry
    // carrying an install path wins.
    const hostPath = installed.plugins[key]?.find((entry) => entry.installPath)?.installPath;
    if (hostPath) {
      plugins.push({ name, hostPath, sandboxPath: sandboxPluginPath(name) });
    } else {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    throw new ConfigError(
      `Plugin(s) not installed: ${missing.join(", ")}. ` + `relay mounts their skills into the sandbox; install them first (see ${path}).`,
    );
  }
  return plugins;
}

/**
 * Only what relay reads: a plugin key maps to its install entries, and an
 * entry may carry the host directory Claude installed it in. Loose on purpose
 * — the file is Claude's, and it may grow fields relay knows nothing about.
 */
const installedPluginsSchema = z.looseObject({
  plugins: z.record(z.string(), z.array(z.looseObject({ installPath: z.string().min(1).optional() }))).default({}),
});

async function readInstalledPlugins(path: string): Promise<z.infer<typeof installedPluginsSchema>> {
  try {
    return installedPluginsSchema.parse(JSON.parse(await readFile(path, "utf8")));
  } catch {
    throw new ConfigError(
      `Could not read Claude's installed plugins at ${path}. ` + "relay mounts plugin skills from the host's Claude installation.",
    );
  }
}
