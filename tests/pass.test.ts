import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigError } from "../src/errors.js";
import { runPass } from "../src/pass.js";
import { TRACKER_DOC_PATH } from "../src/tracker-doc.js";

const validConfig = `export default {
  greenGate: "make test",
  defaultBranch: "main",
  jira: { baseUrl: "https://example.atlassian.net" },
};`;

const trackerDoc = `# Issue tracker: Jira

## Setup constants

- **Jira project key:** \`PSD\`
- **Repo label:** \`repo:qc-catalog\`
`;

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

/** Every secret present, resolved from the environment rather than a file. */
async function withSecrets(): Promise<void> {
  vi.stubEnv("XDG_CONFIG_HOME", await mkdtemp(join(tmpdir(), "relay-home-")));
  for (const secret of secrets) {
    const [key, value] = secret.split("=");
    vi.stubEnv(key!, value!);
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
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

  it("fails when the repo has no tracker doc to scope selection with", async () => {
    await repoWithValidConfig();
    await withSecrets();

    await expect(runPass("PSD-1")).rejects.toThrow(/issue-tracker\.md/);
  });

  it("resolves the tracker scope before reaching Jira", async () => {
    const root = await repoWithValidConfig();
    await mkdir(join(root, TRACKER_DOC_PATH, ".."), { recursive: true });
    await writeFile(join(root, TRACKER_DOC_PATH), trackerDoc, "utf8");
    await withSecrets();
    // No network in tests: the pass gets as far as its first Jira call.
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 401 })));

    await expect(runPass("PSD-1")).rejects.toThrow(/Jira 401/);
  });
});
