import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { CONFIG_FILE_NAME, DEFAULT_DOCKERFILE_PATH } from "./config.js";
import { ConfigError } from "./errors.js";
import { ExitCode } from "./exit-codes.js";
import {
  defaultBranch,
  isGitHubRemote,
  isGitRepo,
  originUrl,
  runGit,
  type GitRunner,
} from "./git.js";
import { readResource } from "./resources.js";

/** One file init considered, and what it did with it. */
export interface InitVerdict {
  file: string;
  outcome: "written" | "kept" | "skipped";
  detail: string;
}

export interface InitOptions {
  repoRoot?: string;
  git?: GitRunner;
}

/** What remains an operator's job once init has written what it could. */
const MANUAL_STEPS = [
  "declare the green gate command in AGENTS.md",
  "create the label vocabulary: ready-for-agent, agent-in-progress, agent-in-review, agent-blocked",
  "provision a GH_TOKEN with repo access",
].join("\n  - ");

/**
 * Run the bootstrap and report every verdict.
 *
 * Init never overwrites and never stages or commits — it only writes the
 * files a repo is missing and leaves them for the operator to review.
 */
export async function runInit(options: InitOptions = {}): Promise<ExitCode> {
  const verdicts = await runInitChecks(options);
  console.log("relay init");
  for (const verdict of verdicts) {
    console.log(`  ${label(verdict.outcome)} ${verdict.file}: ${verdict.detail}`);
  }
  console.log(`\nStill yours to do:\n  - ${MANUAL_STEPS}`);
  console.log("\nNext: relay doctor");
  return ExitCode.Success;
}

/**
 * Perform the bootstrap and return its per-file verdicts as data.
 *
 * Refuses before writing anything when the directory is not a git repo or its
 * `origin` is not GitHub — relay is GitHub-only by architecture (ADR-0007),
 * and a config written anywhere else can never work.
 */
export async function runInitChecks({
  repoRoot = process.cwd(),
  git = runGit,
}: InitOptions = {}): Promise<InitVerdict[]> {
  await guardGitHubClone({ repoRoot, git });

  const stack = detectStack(repoRoot);

  return [await writeConfigFile({ repoRoot, git }), await writeSandboxRecipe({ repoRoot, stack })];
}

async function writeConfigFile({
  repoRoot,
  git,
}: {
  repoRoot: string;
  git: GitRunner;
}): Promise<InitVerdict> {
  const configPath = join(repoRoot, CONFIG_FILE_NAME);
  if (existsSync(configPath)) {
    return { file: CONFIG_FILE_NAME, outcome: "kept", detail: "already exists" };
  }

  const branch = await defaultBranch({ repoRoot, git });
  await writeFile(configPath, configSource({ branch }), "utf8");

  return { file: CONFIG_FILE_NAME, outcome: "written", detail: `defaultBranch \`${branch}\`` };
}

/** The three sandbox recipe templates shipped as resources, one per stack. */
const SANDBOX_RECIPE_TEMPLATES: Record<Stack, string> = {
  java: "java.Dockerfile",
  python: "python.Dockerfile",
  node: "node.Dockerfile",
};

async function writeSandboxRecipe({
  repoRoot,
  stack,
}: {
  repoRoot: string;
  stack: Stack | undefined;
}): Promise<InitVerdict> {
  const dockerfilePath = join(repoRoot, DEFAULT_DOCKERFILE_PATH);
  if (existsSync(dockerfilePath)) {
    return { file: DEFAULT_DOCKERFILE_PATH, outcome: "kept", detail: "already exists" };
  }

  if (!stack) {
    return {
      file: DEFAULT_DOCKERFILE_PATH,
      outcome: "skipped",
      detail:
        "no recipe written — the repo matched none of Java, Python, or Node; " +
        `write your own at ${DEFAULT_DOCKERFILE_PATH}`,
    };
  }

  const template = await readResource("sandbox-recipes", SANDBOX_RECIPE_TEMPLATES[stack]);
  await mkdir(dirname(dockerfilePath), { recursive: true });
  await writeFile(dockerfilePath, template, "utf8");

  return {
    file: DEFAULT_DOCKERFILE_PATH,
    outcome: "written",
    detail: `wrote the ${stack} sandbox recipe`,
  };
}

async function guardGitHubClone({
  repoRoot,
  git,
}: {
  repoRoot: string;
  git: GitRunner;
}): Promise<void> {
  if (!(await isGitRepo({ repoRoot, git }))) {
    throw new ConfigError(
      `${repoRoot} is not a git repository — relay init has nothing to inspect.`,
    );
  }

  const url = await originUrl({ repoRoot, git });
  if (!url || !isGitHubRemote(url)) {
    throw new ConfigError(
      "This repo's `origin` is not GitHub — relay is GitHub-only by architecture (ADR-0007), " +
        "and a config written here could never work.",
    );
  }
}

/** The language a sandbox recipe template is chosen for. */
type Stack = "java" | "python" | "node";

/**
 * The stack detected from the repo's manifest, by fixed precedence: Maven,
 * then `uv`, then npm. A repo matching none of the three yields none.
 */
function detectStack(repoRoot: string): Stack | undefined {
  if (existsSync(join(repoRoot, "pom.xml"))) {
    return "java";
  }
  if (existsSync(join(repoRoot, "pyproject.toml"))) {
    return "python";
  }
  if (existsSync(join(repoRoot, "package.json"))) {
    return "node";
  }

  return undefined;
}

/**
 * `relay.config.ts` carrying only `defaultBranch` — every other field has a
 * package default, and echoing them back out would freeze them against
 * future defaults.
 */
function configSource({ branch }: { branch: string }): string {
  return `export default {\n  defaultBranch: ${JSON.stringify(branch)},\n};\n`;
}

function label(outcome: InitVerdict["outcome"]): string {
  return { written: "wrote ", kept: "kept  ", skipped: "skip  " }[outcome];
}
