import { existsSync } from "node:fs";
import { join } from "node:path";
import { createJiti } from "jiti";
import { z } from "zod";
import { ConfigError } from "./errors.js";

/**
 * The directory a target repo commits relay's own files in.
 *
 * relay's, not the repo's: a recipe under the repo's `docker/` and a config at
 * its root sit in namespaces the repo owns
 * ([ADR-0013](../docs/adr/0013-relay-owns-a-dot-directory-in-the-target-repo.md)).
 */
export const RELAY_DIR = ".relay";

/** The config file a target repo commits in `.relay`. */
export const CONFIG_FILE_PATH = `${RELAY_DIR}/config.ts`;

/** Where a target repo's sandbox recipe lives unless `dockerfile` overrides it. */
export const DEFAULT_DOCKERFILE_PATH = `${RELAY_DIR}/Dockerfile`;

/**
 * One key per distinct model choice a pass makes, which is not one per role:
 * the reviewer's four lenses each pick their own, and the fixer picks a second
 * one for the attempt it escalates. The defaults are relay's, and a repo may
 * override any of them.
 */
const modelsSchema = z
  .strictObject({
    /** Reading three docs and a manifest is the cheapest judgement of the pass. */
    gateResolver: z.string().default("claude-haiku-4-5"),
    planner: z.string().default("claude-opus-4-8"),
    implementer: z.string().default("claude-sonnet-5"),
    fastCodeReview: z.string().default("claude-opus-4-8"),
    fastSpecReview: z.string().default("claude-opus-4-8"),
    inDepthCodeReview: z.string().default("claude-fable-5"),
    inDepthSpecReview: z.string().default("claude-fable-5"),
    fixer: z.string().default("claude-sonnet-5"),
    /** What the fixer escalates to when its first attempt at a red gate failed. */
    fixerEscalated: z.string().default("claude-opus-4-8"),
    greenGate: z.string().default("claude-sonnet-5"),
    handover: z.string().default("claude-sonnet-5"),
  })
  .prefault({});

/**
 * The typed config surface the host harness reads.
 *
 * Strict on purpose: it carries **no secrets** (those resolve from the
 * home-dir file at runtime) and **no tracker ids** (`gh` infers the repo from
 * the clone's remote), so an unknown key is a mistake worth failing on — which
 * is also how a repo's leftover `jira` block reports itself.
 */
export const relayConfigSchema = z.strictObject({
  /** The branch a pass branches from. */
  defaultBranch: z.string().min(1),
  /** A prebuilt sandbox image; when absent relay builds from `dockerfile`. */
  image: z.string().min(1).optional(),
  /** Repo-relative path to the sandbox Dockerfile, used when `image` is unset. */
  dockerfile: z.string().min(1).default(DEFAULT_DOCKERFILE_PATH),
  branchPrefix: z.string().min(1).default("agent/"),
  roleTimeoutMs: z
    .number()
    .int()
    .positive()
    .default(45 * 60 * 1000),
  models: modelsSchema,
});

export type RelayConfig = z.infer<typeof relayConfigSchema>;

/**
 * Load and validate the target repo's `.relay/config.ts`.
 *
 * The published harness is compiled JS, so the authored TypeScript is loaded
 * through `jiti`. Anything wrong with the file — absent, unloadable, or
 * failing the schema — is a `ConfigError`.
 */
export async function loadConfig(repoRoot: string): Promise<RelayConfig> {
  const configPath = join(repoRoot, CONFIG_FILE_PATH);
  if (!existsSync(configPath)) {
    throw new ConfigError(`No ${CONFIG_FILE_PATH} found at ${configPath}`);
  }

  const exported = await importConfig(configPath);
  const result = relayConfigSchema.safeParse(exported);
  if (!result.success) {
    throw new ConfigError(`Invalid ${CONFIG_FILE_PATH}:\n${formatIssues(result.error)}`);
  }
  return result.data;
}

async function importConfig(configPath: string): Promise<unknown> {
  // Anchored at the config file so its own imports resolve from the target
  // repo, not from wherever the relay package happens to be installed.
  const jiti = createJiti(configPath);
  try {
    return await jiti.import(configPath, { default: true });
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new ConfigError(`Could not load ${configPath}: ${reason}`);
  }
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");
}
