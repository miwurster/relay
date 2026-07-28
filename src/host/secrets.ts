import { readFile } from "node:fs/promises";
import { credentialFilePath } from "./credential-file.js";
import { requireAll } from "./required.js";

/** The Claude credential relay injects, under the variable name it was given. */
export interface ClaudeCredential {
  variable: "CLAUDE_CODE_OAUTH_TOKEN" | "ANTHROPIC_API_KEY";
  token: string;
}

/**
 * Which of the two places one variable resolved from. Names only — a source
 * never carries a value, so it is safe to print.
 */
export interface SecretSource {
  variable: string;
  from: "file" | "environment";
}

/**
 * Every credential a pass needs: the GitHub token `gh` authenticates with, and
 * the Claude credential the sandbox's roles run on — plus where each came
 * from, which is what lets doctor report a setup without printing it.
 */
export interface Secrets {
  githubToken: string;
  claude: ClaudeCredential;
  sources: SecretSource[];
}

export interface SecretsOptions {
  repoRoot: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * Resolve the secrets, preferring real environment variables over the
 * credential file so CI and one-off runs can override it.
 *
 * Every missing secret is reported in one `ConfigError` rather than one per
 * run, so an operator fixes their setup in a single pass.
 */
export async function loadSecrets({
  repoRoot,
  env = process.env,
}: SecretsOptions): Promise<Secrets> {
  const fromFile = await readEnvFile(credentialFilePath(repoRoot));
  const sources: SecretSource[] = [];
  const resolve = (variable: string) => {
    const resolved = value(env[variable], fromFile[variable]);
    if (resolved) sources.push({ variable, from: resolved.from });
    return resolved?.token;
  };

  const required = requireAll(
    {
      githubToken: resolve("GH_TOKEN"),
      claude: resolveClaudeCredential(resolve),
    },
    {
      githubToken: "GH_TOKEN",
      claude: "CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY",
    },
    (missing) =>
      `Missing secret(s): ${missing.join(", ")}. ` +
      `Set them as environment variables or in ${credentialFilePath(repoRoot)}.`,
  );

  return { ...required, sources };
}

/**
 * The first Claude variable that resolved, in relay's order of preference.
 * Resolution goes through the caller's `resolve` so the credential records its
 * source alongside the others.
 */
function resolveClaudeCredential(
  resolve: (variable: string) => string | undefined,
): ClaudeCredential | undefined {
  const variables = ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY"] as const;
  for (const variable of variables) {
    const token = resolve(variable);
    if (token) return { variable, token };
  }
  return undefined;
}

/**
 * The environment's value when it carries one, else the file's — trimmed, and
 * `undefined` when neither is set to anything but blanks. The place it came
 * from travels with it, since that is not recoverable afterwards.
 */
function value(
  fromEnv: string | undefined,
  fromFile: string | undefined,
): { token: string; from: SecretSource["from"] } | undefined {
  const environment = fromEnv?.trim();
  if (environment) return { token: environment, from: "environment" };
  const file = fromFile?.trim();
  if (file) return { token: file, from: "file" };
  return undefined;
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
