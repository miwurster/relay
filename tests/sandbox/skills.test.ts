import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigError } from "../../src/errors.js";
import {
  pluginsFilePath,
  resolveSkillPlugins,
  SANDBOX_PLUGIN_ROOT,
} from "../../src/sandbox/skills.js";

async function configDirWith(installed: unknown): Promise<NodeJS.ProcessEnv> {
  const configDir = await mkdtemp(join(tmpdir(), "relay-claude-"));
  await mkdir(join(configDir, "plugins"), { recursive: true });
  if (installed !== undefined) {
    await writeFile(
      join(configDir, "plugins", "installed_plugins.json"),
      JSON.stringify(installed),
      "utf8",
    );
  }
  return { CLAUDE_CONFIG_DIR: configDir };
}

const bothPlugins = {
  version: 2,
  plugins: {
    "kipu-all@kipu": [{ scope: "user", installPath: "/plugins/kipu-all/2.5.0", version: "2.5.0" }],
    "caveman@caveman": [{ scope: "user", installPath: "/plugins/caveman/abc", version: "1.0.0" }],
  },
};

describe("pluginsFilePath", () => {
  it("honours CLAUDE_CONFIG_DIR over the default home-dir location", () => {
    expect(pluginsFilePath({ CLAUDE_CONFIG_DIR: "/elsewhere/.claude" })).toBe(
      "/elsewhere/.claude/plugins/installed_plugins.json",
    );
  });

  it("falls back to the Claude config dir under HOME", () => {
    expect(pluginsFilePath({ HOME: "/home/dev" })).toBe(
      "/home/dev/.claude/plugins/installed_plugins.json",
    );
  });
});

describe("resolveSkillPlugins", () => {
  it("maps each required plugin to its host install path and sandbox mount path", async () => {
    const plugins = await resolveSkillPlugins(await configDirWith(bothPlugins));
    expect(plugins).toEqual([
      {
        name: "kipu-all",
        hostPath: "/plugins/kipu-all/2.5.0",
        sandboxPath: `${SANDBOX_PLUGIN_ROOT}/kipu-all`,
      },
      {
        name: "caveman",
        hostPath: "/plugins/caveman/abc",
        sandboxPath: `${SANDBOX_PLUGIN_ROOT}/caveman`,
      },
    ]);
  });

  it("rejects an absent installed-plugins file", async () => {
    await expect(resolveSkillPlugins(await configDirWith(undefined))).rejects.toThrow(ConfigError);
  });

  it("names every plugin that is not installed", async () => {
    const env = await configDirWith({ version: 2, plugins: {} });
    await expect(resolveSkillPlugins(env)).rejects.toThrow(/kipu-all@kipu, caveman@caveman/);
  });

  it("rejects an installed plugin whose entry carries no install path", async () => {
    const env = await configDirWith({
      version: 2,
      plugins: { ...bothPlugins.plugins, "caveman@caveman": [{ scope: "user" }] },
    });
    await expect(resolveSkillPlugins(env)).rejects.toThrow(/caveman@caveman/);
  });
});
