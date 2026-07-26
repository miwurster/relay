import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigError } from "../src/errors.js";
import { loadSecrets, secretsFilePath } from "../src/secrets.js";

const complete = {
  ATLASSIAN_SA_EMAIL: "relay@kipu-quantum.com",
  ATLASSIAN_SA_TOKEN: "sa-token",
  GITLAB_TOKEN: "gl-token",
  CLAUDE_CODE_OAUTH_TOKEN: "oauth-token",
};

/** A config home holding a `relay/.env` with the given contents. */
async function configHomeWith(contents: string): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "relay-secrets-"));
  await mkdir(join(home, "relay"), { recursive: true });
  await writeFile(join(home, "relay", ".env"), contents, "utf8");
  return home;
}

function envWith(overrides: Record<string, string>): NodeJS.ProcessEnv {
  return { ...overrides };
}

describe("secretsFilePath", () => {
  it("points at relay/.env under the XDG config home", () => {
    expect(secretsFilePath(envWith({ XDG_CONFIG_HOME: "/tmp/xdg" }))).toBe("/tmp/xdg/relay/.env");
  });

  it("falls back to ~/.config when XDG_CONFIG_HOME is unset", () => {
    expect(secretsFilePath(envWith({ HOME: "/home/dev" }))).toBe("/home/dev/.config/relay/.env");
  });
});

describe("loadSecrets", () => {
  it("reads every secret from the home-dir file", async () => {
    const home = await configHomeWith(`# relay credentials
ATLASSIAN_SA_EMAIL=relay@kipu-quantum.com
ATLASSIAN_SA_TOKEN="sa-token"

GITLAB_TOKEN='gl-token'
ANTHROPIC_API_KEY=api-key
`);
    const secrets = await loadSecrets(envWith({ XDG_CONFIG_HOME: home }));
    expect(secrets.atlassian).toEqual({
      email: "relay@kipu-quantum.com",
      token: "sa-token",
    });
    expect(secrets.gitlabToken).toBe("gl-token");
    expect(secrets.claude).toEqual({
      variable: "ANTHROPIC_API_KEY",
      token: "api-key",
    });
  });

  it("lets an environment variable override the file", async () => {
    const home = await configHomeWith(
      Object.entries(complete)
        .map(([key, value]) => `${key}=${value}`)
        .join("\n"),
    );
    const secrets = await loadSecrets(envWith({ XDG_CONFIG_HOME: home, GITLAB_TOKEN: "from-env" }));
    expect(secrets.gitlabToken).toBe("from-env");
  });

  it("resolves from the environment alone when no file exists", async () => {
    const home = await mkdtemp(join(tmpdir(), "relay-secrets-"));
    const secrets = await loadSecrets(envWith({ XDG_CONFIG_HOME: home, ...complete }));
    expect(secrets.atlassian.token).toBe("sa-token");
  });

  it("prefers the OAuth token over an API key when both are present", async () => {
    const home = await mkdtemp(join(tmpdir(), "relay-secrets-"));
    const secrets = await loadSecrets(
      envWith({ XDG_CONFIG_HOME: home, ...complete, ANTHROPIC_API_KEY: "api-key" }),
    );
    expect(secrets.claude.variable).toBe("CLAUDE_CODE_OAUTH_TOKEN");
  });

  it("reports every missing secret at once", async () => {
    const home = await mkdtemp(join(tmpdir(), "relay-secrets-"));
    const failure = loadSecrets(
      envWith({ XDG_CONFIG_HOME: home, ATLASSIAN_SA_EMAIL: "relay@kipu-quantum.com" }),
    );
    await expect(failure).rejects.toThrow(ConfigError);
    await expect(failure).rejects.toThrow(/ATLASSIAN_SA_TOKEN/);
    await expect(failure).rejects.toThrow(/GITLAB_TOKEN/);
    await expect(failure).rejects.toThrow(/CLAUDE_CODE_OAUTH_TOKEN/);
  });

  it("treats a blank value as missing", async () => {
    const home = await configHomeWith("GITLAB_TOKEN=   ");
    const { GITLAB_TOKEN: _blank, ...rest } = complete;
    await expect(loadSecrets(envWith({ XDG_CONFIG_HOME: home, ...rest }))).rejects.toThrow(
      /GITLAB_TOKEN/,
    );
  });
});
