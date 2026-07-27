import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { CONFIG_FILE_NAME, DEFAULT_DOCKERFILE_PATH, UNSET_GREEN_GATE } from "./config.js";
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
  "confirm the green gate relay.config.ts detected (or fill it in if it's still the sentinel)",
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

  const { stack, gate } = await detectStack(repoRoot);

  return [
    await writeConfigFile({ repoRoot, git, gate }),
    await writeSandboxRecipe({ repoRoot, stack }),
  ];
}

async function writeConfigFile({
  repoRoot,
  git,
  gate,
}: {
  repoRoot: string;
  git: GitRunner;
  gate: GateDetection;
}): Promise<InitVerdict> {
  const configPath = join(repoRoot, CONFIG_FILE_NAME);
  if (existsSync(configPath)) {
    return { file: CONFIG_FILE_NAME, outcome: "kept", detail: "already exists" };
  }

  const branch = await defaultBranch({ repoRoot, git });
  await writeFile(configPath, configSource({ gate, branch }), "utf8");

  return {
    file: CONFIG_FILE_NAME,
    outcome: "written",
    detail: gate.detected
      ? `detected green gate \`${gate.value}\` — confirm it`
      : "green gate could not be detected — left as the sentinel `relay doctor` will refuse",
  };
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

interface GateDetection {
  value: string;
  detected: boolean;
}

/** The language a sandbox recipe template is chosen for. */
type Stack = "java" | "python" | "node";

interface StackDetection {
  stack: Stack | undefined;
  gate: GateDetection;
}

/**
 * The stack and green gate detected from the repo's manifest, by fixed
 * precedence: Maven, then `uv`, then npm. A Maven or `uv` repo always yields
 * its command; a `package.json` with none of the preferred scripts still
 * yields the Node stack, but the sentinel gate rather than a guess. A repo
 * matching none of the three yields neither.
 */
async function detectStack(repoRoot: string): Promise<StackDetection> {
  if (existsSync(join(repoRoot, "pom.xml"))) {
    return { stack: "java", gate: { value: "./mvnw verify", detected: true } };
  }
  if (existsSync(join(repoRoot, "pyproject.toml"))) {
    return { stack: "python", gate: { value: "uv run pytest", detected: true } };
  }

  const packageJsonPath = join(repoRoot, "package.json");
  if (existsSync(packageJsonPath)) {
    const scripts = await readPackageScripts(packageJsonPath);
    for (const name of ["verify", "ci", "test"]) {
      if (scripts[name]) {
        return { stack: "node", gate: { value: `npm run ${name}`, detected: true } };
      }
    }
    return { stack: "node", gate: { value: UNSET_GREEN_GATE, detected: false } };
  }

  return { stack: undefined, gate: { value: UNSET_GREEN_GATE, detected: false } };
}

async function readPackageScripts(packageJsonPath: string): Promise<Record<string, string>> {
  const raw = await readFile(packageJsonPath, "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (parsed && typeof parsed === "object" && "scripts" in parsed) {
    const scripts = (parsed as { scripts?: unknown }).scripts;
    if (scripts && typeof scripts === "object") return scripts as Record<string, string>;
  }
  return {};
}

/**
 * `relay.config.ts` carrying only `greenGate` and `defaultBranch` — every
 * other field has a package default, and echoing them back out would freeze
 * them against future defaults.
 */
function configSource({ gate, branch }: { gate: GateDetection; branch: string }): string {
  const gateLine = gate.detected
    ? `  // detected from the repo's manifest — confirm this is really your green gate\n  greenGate: ${JSON.stringify(gate.value)},`
    : `  greenGate: ${JSON.stringify(gate.value)},`;
  return `export default {\n${gateLine}\n  defaultBranch: ${JSON.stringify(branch)},\n};\n`;
}

function label(outcome: InitVerdict["outcome"]): string {
  return { written: "wrote ", kept: "kept  ", skipped: "skip  " }[outcome];
}
