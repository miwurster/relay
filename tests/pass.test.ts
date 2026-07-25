import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigError } from "../src/errors.js";
import { ExitCode } from "../src/exit-codes.js";
import { runPass } from "../src/pass.js";

const validConfig = `export default {
  greenGate: "make test",
  defaultBranch: "main",
  jira: { baseUrl: "https://example.atlassian.net" },
};`;

const secrets = [
  "ATLASSIAN_SA_EMAIL=relay@kipu-quantum.com",
  "ATLASSIAN_SA_TOKEN=sa-token",
  "GITLAB_TOKEN=gl-token",
  "CLAUDE_CODE_OAUTH_TOKEN=oauth-token",
];

/** A repo root with a valid config, made the process's working directory. */
async function repoWithValidConfig(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "relay-pass-"));
  await writeFile(join(root, "relay.config.ts"), validConfig, "utf8");
  vi.spyOn(process, "cwd").mockReturnValue(root);
  return root;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("runPass", () => {
  it("fails fast when the repo has no config", async () => {
    const empty = await mkdtemp(join(tmpdir(), "relay-pass-"));
    vi.spyOn(process, "cwd").mockReturnValue(empty);
    await expect(runPass("PSD-1")).rejects.toThrow(ConfigError);
  });

  it("fails fast when a secret cannot be resolved", async () => {
    await repoWithValidConfig();
    vi.stubEnv("XDG_CONFIG_HOME", await mkdtemp(join(tmpdir(), "relay-empty-home-")));
    await expect(runPass("PSD-1")).rejects.toThrow(/Missing secret/);
  });

  it("proceeds once config and secrets resolve", async () => {
    await repoWithValidConfig();
    const home = await mkdtemp(join(tmpdir(), "relay-home-"));
    vi.stubEnv("XDG_CONFIG_HOME", home);
    for (const secret of secrets) {
      const [key, value] = secret.split("=");
      vi.stubEnv(key!, value!);
    }
    expect(await runPass("PSD-1")).toBe(ExitCode.Success);
  });
});
