import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigError } from "../src/errors.js";
import { loadConfig } from "../src/config.js";

const minimalConfig = `export default {
  defaultBranch: "main",
};`;

async function repoWith(configSource: string | undefined): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "relay-config-"));
  if (configSource !== undefined) {
    await writeFile(join(root, "relay.config.ts"), configSource, "utf8");
  }
  return root;
}

describe("loadConfig", () => {
  it("loads an authored TypeScript config from the repo root", async () => {
    const config = await loadConfig(await repoWith(minimalConfig));
    expect(config.defaultBranch).toBe("main");
  });

  it("applies the package defaults a repo did not override", async () => {
    const config = await loadConfig(await repoWith(minimalConfig));
    expect(config.branchPrefix).toBe("agent/");
    expect(config.roleTimeoutMs).toBe(45 * 60 * 1000);
    expect(config.dockerfile).toBe("docker/relay.Dockerfile");
    expect(config.image).toBeUndefined();
    expect(config.models.gateResolver).toBe("claude-haiku-4-5");
    expect(config.models.planner).toBe("claude-opus-4-8");
    expect(config.models.implementer).toBe("claude-sonnet-5");
    expect(config.models.inDepthCodeReview).toBe("claude-fable-5");
    expect(config.models.greenGate).toBe("claude-sonnet-5");
  });

  it("lets a repo override a default without dropping the others", async () => {
    const root = await repoWith(`export default {
      defaultBranch: "trunk",
      branchPrefix: "relay/",
      image: "registry.example.com/relay:1",
      models: { implementer: "claude-opus-4-8", gateResolver: "claude-sonnet-5" },
    };`);
    const config = await loadConfig(root);
    expect(config.models.gateResolver).toBe("claude-sonnet-5");
    expect(config.branchPrefix).toBe("relay/");
    expect(config.image).toBe("registry.example.com/relay:1");
    expect(config.models.implementer).toBe("claude-opus-4-8");
    expect(config.models.planner).toBe("claude-opus-4-8");
    expect(config.models.fixer).toBe("claude-sonnet-5");
  });

  it("rejects a missing config file", async () => {
    await expect(loadConfig(await repoWith(undefined))).rejects.toThrow(ConfigError);
  });

  it("rejects a config that omits a required field", async () => {
    const root = await repoWith(`export default {};`);
    await expect(loadConfig(root)).rejects.toThrow(/defaultBranch/);
  });

  it("rejects a config still carrying the deleted greenGate field", async () => {
    const root = await repoWith(`export default {
      greenGate: "make test",
      defaultBranch: "main",
    };`);
    await expect(loadConfig(root)).rejects.toThrow(ConfigError);
  });

  it("rejects non-secret tracker ids that belong in issue-tracker.md", async () => {
    const root = await repoWith(`export default {
      defaultBranch: "main",
      projectKey: "PSD",
    };`);
    await expect(loadConfig(root)).rejects.toThrow(ConfigError);
  });

  it("rejects a config that carries a secret", async () => {
    const root = await repoWith(`export default {
      defaultBranch: "main",
      githubToken: "shh",
    };`);
    await expect(loadConfig(root)).rejects.toThrow(ConfigError);
  });

  it("names a leftover jira block, so migrating a repo cannot half-succeed", async () => {
    const root = await repoWith(`export default {
      defaultBranch: "main",
      jira: { baseUrl: "https://example.atlassian.net" },
    };`);
    await expect(loadConfig(root)).rejects.toThrow(/jira/);
  });
});
