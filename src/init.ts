import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CONFIG_FILE_NAME, UNSET_GREEN_GATE } from "./config.js";
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

/** One file init considered, and what it did with it. */
export interface InitVerdict {
  file: string;
  outcome: "written" | "kept";
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

  const configPath = join(repoRoot, CONFIG_FILE_NAME);
  if (existsSync(configPath)) {
    return [{ file: CONFIG_FILE_NAME, outcome: "kept", detail: "already exists" }];
  }

  const branch = await defaultBranch({ repoRoot, git });
  const gate = await detectGreenGate(repoRoot);
  await writeFile(configPath, configSource({ gate, branch }), "utf8");

  return [
    {
      file: CONFIG_FILE_NAME,
      outcome: "written",
      detail: gate.detected
        ? `detected green gate \`${gate.value}\` — confirm it`
        : "green gate could not be detected — left as the sentinel `relay doctor` will refuse",
    },
  ];
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

/**
 * The green gate detected from the repo's manifest, by fixed precedence:
 * Maven, then `uv`, then npm. A `package.json` with none of the preferred
 * scripts, or a repo matching none of the three, yields the ticket-01
 * sentinel rather than a guess.
 */
async function detectGreenGate(repoRoot: string): Promise<GateDetection> {
  if (existsSync(join(repoRoot, "pom.xml"))) {
    return { value: "./mvnw verify", detected: true };
  }
  if (existsSync(join(repoRoot, "pyproject.toml"))) {
    return { value: "uv run pytest", detected: true };
  }

  const packageJsonPath = join(repoRoot, "package.json");
  if (existsSync(packageJsonPath)) {
    const scripts = await readPackageScripts(packageJsonPath);
    for (const name of ["verify", "ci", "test"]) {
      if (scripts[name]) return { value: `npm run ${name}`, detected: true };
    }
  }

  return { value: UNSET_GREEN_GATE, detected: false };
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
  return { written: "wrote ", kept: "kept  " }[outcome];
}
