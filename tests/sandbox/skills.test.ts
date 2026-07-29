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

const everyPlugin = {
  version: 2,
  plugins: {
    "mattpocock-skills@claude-plugins-official": [
      { scope: "user", installPath: "/plugins/mattpocock-skills/abc", version: "1.0.0" },
    ],
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
    const plugins = await resolveSkillPlugins(await configDirWith(everyPlugin));
    expect(plugins).toEqual([
      {
        name: "mattpocock-skills",
        version: "1.0.0",
        hostPath: "/plugins/mattpocock-skills/abc",
        sandboxPath: `${SANDBOX_PLUGIN_ROOT}/mattpocock-skills`,
      },
    ]);
  });

  it("rejects an absent installed-plugins file", async () => {
    await expect(resolveSkillPlugins(await configDirWith(undefined))).rejects.toThrow(ConfigError);
  });

  it("names every plugin that is not installed", async () => {
    const env = await configDirWith({ version: 2, plugins: {} });
    await expect(resolveSkillPlugins(env)).rejects.toThrow(
      /mattpocock-skills@claude-plugins-official/,
    );
  });

  it("says how to install what is missing", async () => {
    const env = await configDirWith({ version: 2, plugins: {} });
    await expect(resolveSkillPlugins(env)).rejects.toThrow(/\/plugin install/);
  });

  it("rejects an installed plugin whose entry carries no install path", async () => {
    const env = await configDirWith({
      version: 2,
      plugins: { "mattpocock-skills@claude-plugins-official": [{ scope: "user" }] },
    });
    await expect(resolveSkillPlugins(env)).rejects.toThrow(/mattpocock-skills/);
  });
});
