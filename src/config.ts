import { existsSync } from "node:fs";
import { join } from "node:path";
import { createJiti } from "jiti";
import { z } from "zod";
import { ConfigError } from "./errors.js";

/** The config file a target repo commits at its root. */
export const CONFIG_FILE_NAME = "relay.config.ts";

/**
 * What `relay init` writes as the `greenGate` when it could not detect one.
 *
 * The schema refuses it by name, so a setup nobody confirmed fails at load
 * rather than running an unchosen command as the sole evidence for green.
 */
export const UNSET_GREEN_GATE = "<unset: relay init could not detect your green gate>";

/** Where a target repo's sandbox recipe lives unless `dockerfile` overrides it. */
export const DEFAULT_DOCKERFILE_PATH = "docker/relay.Dockerfile";

/**
 * The model each role runs on. Roles are the orchestration graph's roles; the
 * defaults are relay's, and a repo may override any of them.
 */
const modelsSchema = z
  .strictObject({
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
  /**
   * The command whose exit code is the green gate. relay never parses it.
   *
   * It must cover every check the branch is judged on except e2e — static
   * analysis, and the migration and integration test tiers included — because
   * it is the only thing relay runs before it calls a branch green.
   */
  greenGate: z
    .string()
    .min(1)
    .refine((gate) => gate !== UNSET_GREEN_GATE, {
      message:
        "`relay init` left the green gate unset because it could not detect one — " +
        "fill it in with the command that must pass before a branch is called green",
    }),
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
 * Load and validate the target repo's `relay.config.ts`.
 *
 * The published harness is compiled JS, so the authored TypeScript is loaded
 * through `jiti`. Anything wrong with the file — absent, unloadable, or
 * failing the schema — is a `ConfigError`.
 */
export async function loadConfig(repoRoot: string): Promise<RelayConfig> {
  const configPath = join(repoRoot, CONFIG_FILE_NAME);
  if (!existsSync(configPath)) {
    throw new ConfigError(`No ${CONFIG_FILE_NAME} found at ${configPath}`);
  }

  const exported = await importConfig(configPath);
  const result = relayConfigSchema.safeParse(exported);
  if (!result.success) {
    throw new ConfigError(`Invalid ${CONFIG_FILE_NAME}:\n${formatIssues(result.error)}`);
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
