import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { ConfigError } from "./errors.js";

/** The Claude credential relay injects, under the variable name it was given. */
export interface ClaudeCredential {
  variable: "CLAUDE_CODE_OAUTH_TOKEN" | "ANTHROPIC_API_KEY";
  token: string;
}

/**
 * Every credential a pass needs. The Atlassian service-account pair is used
 * host-side (REST basic auth) and in the sandbox (MCP bearer); the GitLab and
 * Claude credentials are injected into the sandbox only.
 */
export interface Secrets {
  atlassian: { email: string; token: string };
  gitlabToken: string;
  claude: ClaudeCredential;
}

/**
 * The home-dir file relay reads secrets from. No secret ever ships in the
 * package, and nothing is read from the target repo.
 */
export function secretsFilePath(env: NodeJS.ProcessEnv = process.env): string {
  const configHome = env["XDG_CONFIG_HOME"] ?? join(env["HOME"] ?? homedir(), ".config");
  return join(configHome, "relay", ".env");
}

/**
 * Resolve the secrets, preferring real environment variables over the
 * home-dir file so CI and one-off runs can override it.
 *
 * Every missing secret is reported in one `ConfigError` rather than one per
 * run, so an operator fixes their setup in a single pass.
 */
export async function loadSecrets(env: NodeJS.ProcessEnv = process.env): Promise<Secrets> {
  const fromFile = await readEnvFile(secretsFilePath(env));
  const resolve = (name: string) => value(env[name], fromFile[name]);

  const email = resolve("ATLASSIAN_SA_EMAIL");
  const token = resolve("ATLASSIAN_SA_TOKEN");
  const gitlabToken = resolve("GITLAB_TOKEN");
  const claude = resolveClaudeCredential(env, fromFile);

  const missing = [
    email ? undefined : "ATLASSIAN_SA_EMAIL",
    token ? undefined : "ATLASSIAN_SA_TOKEN",
    gitlabToken ? undefined : "GITLAB_TOKEN",
    claude ? undefined : "CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY",
  ].filter((name) => name !== undefined);

  if (!email || !token || !gitlabToken || !claude) {
    throw new ConfigError(
      `Missing secret(s): ${missing.join(", ")}. ` +
        `Set them as environment variables or in ${secretsFilePath(env)}.`,
    );
  }

  return { atlassian: { email, token }, gitlabToken, claude };
}

function resolveClaudeCredential(
  env: NodeJS.ProcessEnv,
  fromFile: Record<string, string>,
): ClaudeCredential | undefined {
  const variables = ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY"] as const;
  for (const variable of variables) {
    const token = value(env[variable], fromFile[variable]);
    if (token) return { variable, token };
  }
  return undefined;
}

/**
 * The environment's value when it carries one, else the file's — trimmed, and
 * `undefined` when neither is set to anything but blanks.
 */
function value(fromEnv: string | undefined, fromFile: string | undefined) {
  return fromEnv?.trim() || fromFile?.trim() || undefined;
}

/**
 * Parse a `KEY=value` file. Blank lines and `#` comments are skipped, and a
 * value may be wrapped in matching single or double quotes. An absent file is
 * not an error — the environment alone may carry every secret.
 */
async function readEnvFile(path: string): Promise<Record<string, string>> {
  let contents: string;
  try {
    contents = await readFile(path, "utf8");
  } catch {
    return {};
  }

  const values: Record<string, string> = {};
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    values[key] = unquote(trimmed.slice(separator + 1).trim());
  }
  return values;
}

function unquote(value: string): string {
  const quoted = /^(["'])(.*)\1$/.exec(value);
  return quoted?.[2] ?? value;
}
