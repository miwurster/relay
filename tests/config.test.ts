import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigError } from "../src/errors.js";
import { CONFIG_FILE_PATH, loadConfig } from "../src/config.js";

const minimalConfig = `export default { landing: "pull-request" };`;

async function repoWith(configSource: string | undefined): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "relay-config-"));
  if (configSource !== undefined) {
    const configPath = join(root, CONFIG_FILE_PATH);
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, configSource, "utf8");
  }
  return root;
}

describe("loadConfig", () => {
  it("loads an authored TypeScript config from the repo's relay directory", async () => {
    const config = await loadConfig(
      await repoWith(`export default { landing: "merge", branchPrefix: "relay/" };`),
    );
    expect(config.branchPrefix).toBe("relay/");
  });

  it("loads each landing a repo may declare", async () => {
    const merge = await loadConfig(await repoWith(`export default { landing: "merge" };`));
    const pullRequest = await loadConfig(
      await repoWith(`export default { landing: "pull-request" };`),
    );

    expect(merge.landing).toBe("merge");
    expect(pullRequest.landing).toBe("pull-request");
  });

  it("refuses a config that declares no landing, naming the key", async () => {
    const root = await repoWith(`export default {};`);
    await expect(loadConfig(root)).rejects.toThrow(/landing/);
  });

  it("refuses a landing relay has no shape for", async () => {
    const root = await repoWith(`export default { landing: "rebase" };`);
    await expect(loadConfig(root)).rejects.toThrow(/landing/);
  });

  it("applies the package defaults a repo did not override", async () => {
    const config = await loadConfig(await repoWith(minimalConfig));
    expect(config.branchPrefix).toBe("agent/");
    expect(config.roleTimeoutMs).toBe(45 * 60 * 1000);
    expect(config.dockerfile).toBe(".relay/Dockerfile");
    expect(config.image).toBeUndefined();
    expect(config.models["gate-resolver"]).toBe("claude-haiku-4-5");
    expect(config.models.planner).toBe("claude-opus-5");
    expect(config.models.implementer).toBe("claude-sonnet-5");
    expect(config.models["ticket-review"]).toBe("claude-opus-5");
    expect(config.models["branch-review"]).toBe("claude-fable-5");
    expect(config.models["quality-review"]).toBe("claude-fable-5");
    expect(config.models["green-gate"]).toBe("claude-sonnet-5");
  });

  it("lets a repo override the quality review's model", async () => {
    const root = await repoWith(`export default {
      landing: "merge",
      models: { "quality-review": "claude-opus-5" },
    };`);
    const config = await loadConfig(root);
    expect(config.models["quality-review"]).toBe("claude-opus-5");
    expect(config.models["branch-review"]).toBe("claude-fable-5");
  });

  it("defaults the lander to the model the fixer escalates to", async () => {
    const config = await loadConfig(await repoWith(minimalConfig));
    expect(config.models.lander).toBe(config.models["fixer-escalated"]);
  });

  it("lets a repo override the lander's model", async () => {
    const root = await repoWith(`export default {
      landing: "merge",
      models: { lander: "claude-fable-5" },
    };`);
    const config = await loadConfig(root);
    expect(config.models.lander).toBe("claude-fable-5");
  });

  it("lets a repo override a default without dropping the others", async () => {
    const root = await repoWith(`export default {
      landing: "merge",
      branchPrefix: "relay/",
      image: "registry.example.com/relay:1",
      models: { implementer: "claude-opus-5", "gate-resolver": "claude-sonnet-5" },
    };`);
    const config = await loadConfig(root);
    expect(config.models["gate-resolver"]).toBe("claude-sonnet-5");
    expect(config.branchPrefix).toBe("relay/");
    expect(config.image).toBe("registry.example.com/relay:1");
    expect(config.models.implementer).toBe("claude-opus-5");
    expect(config.models.planner).toBe("claude-opus-5");
    expect(config.models.fixer).toBe("claude-sonnet-5");
  });

  it("rejects a missing config file", async () => {
    await expect(loadConfig(await repoWith(undefined))).rejects.toThrow(ConfigError);
  });

  it("rejects a config still carrying the deleted defaultBranch field", async () => {
    const root = await repoWith(`export default {
      defaultBranch: "main",
    };`);
    await expect(loadConfig(root)).rejects.toThrow(/defaultBranch/);
  });

  it("rejects a config still carrying the deleted greenGate field", async () => {
    const root = await repoWith(`export default {
      greenGate: "make test",
    };`);
    await expect(loadConfig(root)).rejects.toThrow(ConfigError);
  });

  it("rejects a config still setting one of the collapsed review models", async () => {
    const root = await repoWith(`export default {
      landing: "merge",
      models: { inDepthCodeReview: "claude-opus-5" },
    };`);
    await expect(loadConfig(root)).rejects.toThrow(/inDepthCodeReview/);
  });

  it("rejects non-secret tracker ids that belong in issue-tracker.md", async () => {
    const root = await repoWith(`export default {
      projectKey: "PSD",
    };`);
    await expect(loadConfig(root)).rejects.toThrow(ConfigError);
  });

  it("rejects a config that carries a secret", async () => {
    const root = await repoWith(`export default {
      githubToken: "shh",
    };`);
    await expect(loadConfig(root)).rejects.toThrow(ConfigError);
  });

  it("names a leftover jira block, so migrating a repo cannot half-succeed", async () => {
    const root = await repoWith(`export default {
      jira: { baseUrl: "https://example.atlassian.net" },
    };`);
    await expect(loadConfig(root)).rejects.toThrow(/jira/);
  });
});
