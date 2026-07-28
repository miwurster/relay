import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CREDENTIAL_FILE_PATH, RELAY_DIR } from "../../src/config.js";
import { ConfigError } from "../../src/errors.js";
import { loadSecrets } from "../../src/host/secrets.js";

const complete = {
  GH_TOKEN: "gh-token",
  CLAUDE_CODE_OAUTH_TOKEN: "oauth-token",
};

/** A repo root holding a `.relay/.env` with the given contents. */
async function repoWithCredentials(contents: string): Promise<string> {
  const repoRoot = await mkdtemp(join(tmpdir(), "relay-secrets-"));
  await mkdir(join(repoRoot, RELAY_DIR), { recursive: true });
  await writeFile(join(repoRoot, CREDENTIAL_FILE_PATH), contents, "utf8");
  return repoRoot;
}

/** A repo root with no credential file at all. */
async function repoWithoutCredentials(): Promise<string> {
  return mkdtemp(join(tmpdir(), "relay-secrets-"));
}

describe("loadSecrets", () => {
  it("reads every secret from the credential file", async () => {
    const repoRoot = await repoWithCredentials(`# relay credentials
GH_TOKEN="gh-token"

ANTHROPIC_API_KEY=api-key
`);
    const secrets = await loadSecrets({ repoRoot, env: {} });
    expect(secrets.githubToken).toBe("gh-token");
    expect(secrets.claude).toEqual({
      variable: "ANTHROPIC_API_KEY",
      token: "api-key",
    });
  });

  it("lets an environment variable override the credential file", async () => {
    const repoRoot = await repoWithCredentials(
      Object.entries(complete)
        .map(([key, value]) => `${key}=${value}`)
        .join("\n"),
    );
    const secrets = await loadSecrets({ repoRoot, env: { GH_TOKEN: "from-env" } });
    expect(secrets.githubToken).toBe("from-env");
  });

  it("resolves from the environment alone when the repo has no credential file", async () => {
    const secrets = await loadSecrets({
      repoRoot: await repoWithoutCredentials(),
      env: { ...complete },
    });
    expect(secrets.githubToken).toBe("gh-token");
  });

  it("prefers the OAuth token over an API key when both are present", async () => {
    const secrets = await loadSecrets({
      repoRoot: await repoWithoutCredentials(),
      env: { ...complete, ANTHROPIC_API_KEY: "api-key" },
    });
    expect(secrets.claude.variable).toBe("CLAUDE_CODE_OAUTH_TOKEN");
  });

  it("reports every missing secret at once, naming the credential file", async () => {
    const repoRoot = await repoWithoutCredentials();
    const failure = loadSecrets({ repoRoot, env: {} });
    await expect(failure).rejects.toThrow(ConfigError);
    await expect(failure).rejects.toThrow(/GH_TOKEN/);
    await expect(failure).rejects.toThrow(/CLAUDE_CODE_OAUTH_TOKEN/);
    await expect(failure).rejects.toThrow(/\.relay\/\.env/);
  });

  it("treats a blank value as missing", async () => {
    const repoRoot = await repoWithCredentials("GH_TOKEN=   ");
    const { GH_TOKEN: _blank, ...rest } = complete;
    await expect(loadSecrets({ repoRoot, env: rest })).rejects.toThrow(/GH_TOKEN/);
  });

  it("reads no credential from the operator's home directory", async () => {
    const repoRoot = await repoWithoutCredentials();
    await expect(
      loadSecrets({ repoRoot, env: { XDG_CONFIG_HOME: "/tmp/xdg", HOME: "/home/dev" } }),
    ).rejects.toThrow(ConfigError);
  });

  describe("sources", () => {
    it("names the credential file for every variable it resolved", async () => {
      const repoRoot = await repoWithCredentials(
        Object.entries(complete)
          .map(([key, value]) => `${key}=${value}`)
          .join("\n"),
      );

      const { sources } = await loadSecrets({ repoRoot, env: {} });

      expect(sources).toEqual([
        { variable: "GH_TOKEN", from: "file" },
        { variable: "CLAUDE_CODE_OAUTH_TOKEN", from: "file" },
      ]);
    });

    it("names the environment for every variable it resolved", async () => {
      const { sources } = await loadSecrets({
        repoRoot: await repoWithoutCredentials(),
        env: { ...complete },
      });

      expect(sources).toEqual([
        { variable: "GH_TOKEN", from: "environment" },
        { variable: "CLAUDE_CODE_OAUTH_TOKEN", from: "environment" },
      ]);
    });

    it("distinguishes the two when the secrets come from both places", async () => {
      const repoRoot = await repoWithCredentials("CLAUDE_CODE_OAUTH_TOKEN=oauth-token");

      const { sources } = await loadSecrets({ repoRoot, env: { GH_TOKEN: "from-env" } });

      expect(sources).toEqual([
        { variable: "GH_TOKEN", from: "environment" },
        { variable: "CLAUDE_CODE_OAUTH_TOKEN", from: "file" },
      ]);
    });

    it("carries no value, only variable names", async () => {
      const repoRoot = await repoWithCredentials(
        Object.entries(complete)
          .map(([key, value]) => `${key}=${value}`)
          .join("\n"),
      );

      const { sources } = await loadSecrets({ repoRoot, env: {} });

      expect(JSON.stringify(sources)).not.toContain("gh-token");
      expect(JSON.stringify(sources)).not.toContain("oauth-token");
    });
  });
});
