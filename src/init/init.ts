import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  CONFIG_FILE_PATH,
  CREDENTIAL_EXAMPLE_FILE_PATH,
  CREDENTIAL_FILE_PATH,
  DEFAULT_DOCKERFILE_PATH,
  RELAY_GITIGNORE_PATH,
} from "../config.js";
import { ConfigError, reasonOf } from "../errors.js";
import { ExitCode } from "../exit-codes.js";
import { isGitHubRemote, isGitRepo, originUrl, runGit, type GitRunner } from "../host/git.js";
import {
  ghAuthStatus,
  ghCreateLabel,
  ghLabelNames,
  ghVersion,
  runGh,
  type GhRunner,
} from "../tracker/github.js";
import { missingLabels, PASS_LABELS, TRIAGE_LABELS, type LabelSpec } from "../tracker/labels.js";
import { readResource } from "../resources.js";
import { GITIGNORE_FILE_NAME, WORKTREE_DIR, WORKTREE_RULE } from "../host/worktree-dir.js";
import { CREDENTIAL_RULE } from "../host/credential-file.js";
import { RECORD_RULE } from "../crew/leg-record.js";
import { ensureIgnored } from "../host/gitignore.js";

/** One thing init considered — a file or a label — and what it did with it. */
export interface InitVerdict {
  subject: string;
  outcome: "written" | "kept" | "skipped" | "failed";
  detail: string;
}

export interface InitOptions {
  repoRoot?: string;
  git?: GitRunner;
  gh?: GhRunner;
}

/**
 * What remains an operator's job once init has written what it could.
 *
 * The credentials are the one step relay cannot take for them: it writes the
 * example and the ignore rule, and provisioning the tokens and pasting them in
 * is theirs.
 */
const MANUAL_STEPS = [
  "declare the green gate command in AGENTS.md",
  `copy ${CREDENTIAL_EXAMPLE_FILE_PATH} to ${CREDENTIAL_FILE_PATH} and fill in ` +
    "GH_TOKEN (a token with write access to this repo) and " +
    "CLAUDE_CODE_OAUTH_TOKEN (or ANTHROPIC_API_KEY)",
].join("\n  - ");

/**
 * Run the bootstrap and report every verdict.
 *
 * Init never overwrites and never stages or commits — it writes the files a
 * repo is missing, appends the one `.gitignore` line a pass needs, creates the
 * labels the repo has none of, and leaves all of it for the operator to review.
 */
export async function runInit(options: InitOptions = {}): Promise<ExitCode> {
  const verdicts = await runInitChecks(options);
  console.log("relay init");
  for (const verdict of verdicts) {
    console.log(`  ${label(verdict.outcome)} ${verdict.subject}: ${verdict.detail}`);
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
  gh = runGh,
}: InitOptions = {}): Promise<InitVerdict[]> {
  await guardGitHubClone({ repoRoot, git });

  const stack = detectStack(repoRoot);

  return [
    await writeConfigFile(repoRoot),
    await writeSandboxRecipe({ repoRoot, stack }),
    await writeCredentialExample(repoRoot),
    await ignoreRelayRuntimeFiles(repoRoot),
    await ignoreWorktreeDir(repoRoot),
    ...(await createLabels(gh)),
  ];
}

/**
 * Create the labels this repo has none of, one verdict per label.
 *
 * A label that is already there is kept untouched, colour and description
 * included: relay fills the gaps in a repo's vocabulary and never re-states
 * what its maintainers already decided.
 */
async function createLabels(gh: GhRunner): Promise<InitVerdict[]> {
  const wanted = [...PASS_LABELS, ...TRIAGE_LABELS];

  const unreachable = await whyGhCannotBeAsked(gh);
  if (unreachable) {
    return wanted.map(({ name }) => ({ subject: name, outcome: "skipped", detail: unreachable }));
  }

  let existing: string[];
  try {
    existing = await ghLabelNames(gh);
  } catch (error) {
    const detail = reasonOf(error);
    return wanted.map(({ name }) => ({ subject: name, outcome: "failed", detail }));
  }

  const missing = new Set(missingLabels({ wanted, existing }).map(({ name }) => name));

  const verdicts: InitVerdict[] = [];
  for (const spec of wanted) {
    if (!missing.has(spec.name)) {
      verdicts.push({ subject: spec.name, outcome: "kept", detail: "this repo already has it" });
      continue;
    }
    verdicts.push(await createLabel({ spec, gh }));
  }
  return verdicts;
}

async function createLabel({ spec, gh }: { spec: LabelSpec; gh: GhRunner }): Promise<InitVerdict> {
  try {
    await ghCreateLabel(spec, gh);
    return { subject: spec.name, outcome: "written", detail: `created #${spec.color}` };
  } catch (error) {
    return { subject: spec.name, outcome: "failed", detail: reasonOf(error) };
  }
}

/**
 * Why the host cannot be asked about labels at all, or nothing when it can.
 *
 * A missing or unauthenticated `gh` means init never got to ask, which is a
 * skip; a `gh` that asked and was refused is a failure, and that verdict is
 * carried by whichever call GitHub refused.
 */
async function whyGhCannotBeAsked(gh: GhRunner): Promise<string | undefined> {
  try {
    await ghVersion(gh);
  } catch {
    return "no `gh` on this host to create labels with";
  }
  try {
    await ghAuthStatus(gh);
  } catch {
    return "`gh` on this host has no credential GitHub accepts";
  }
  return undefined;
}

/**
 * Write the template an operator copies to the credential file.
 *
 * The example only — init never writes the credential file itself, because a
 * file relay created and left empty is indistinguishable from one an operator
 * filled in and got wrong.
 */
async function writeCredentialExample(repoRoot: string): Promise<InitVerdict> {
  const examplePath = join(repoRoot, CREDENTIAL_EXAMPLE_FILE_PATH);
  if (existsSync(examplePath)) {
    return { subject: CREDENTIAL_EXAMPLE_FILE_PATH, outcome: "kept", detail: "already exists" };
  }

  await mkdir(dirname(examplePath), { recursive: true });
  await writeFile(examplePath, await readResource("env.example"), "utf8");

  return {
    subject: CREDENTIAL_EXAMPLE_FILE_PATH,
    outcome: "written",
    detail: `copy it to ${CREDENTIAL_FILE_PATH} and fill it in`,
  };
}

/**
 * Keep the credential file and what a leg recorded out of git, with rules
 * inside relay's own directory rather than lines in the repo's `.gitignore`.
 *
 * Committed on purpose: the rules then protect every clone rather than the one
 * machine that happened to run init, and they sit next to the files they
 * protect. One verdict, because it is one file either way.
 */
async function ignoreRelayRuntimeFiles(repoRoot: string): Promise<InitVerdict> {
  const credentialWritten = await ensureIgnored(repoRoot, CREDENTIAL_RULE);
  const recordsWritten = await ensureIgnored(repoRoot, RECORD_RULE);
  const written = credentialWritten || recordsWritten;
  return {
    subject: RELAY_GITIGNORE_PATH,
    outcome: written ? "written" : "kept",
    detail:
      `${written ? "now" : "already"} ignores \`${CREDENTIAL_FILE_PATH}\` ` +
      "and what a leg recorded",
  };
}

/**
 * A pass cuts its worktree inside the repo it runs on, so the repo has to
 * ignore that directory. The line is appended to whatever `.gitignore` is
 * already there, and writes the file when the repo has none.
 */
async function ignoreWorktreeDir(repoRoot: string): Promise<InitVerdict> {
  const written = await ensureIgnored(repoRoot, WORKTREE_RULE);
  return {
    subject: GITIGNORE_FILE_NAME,
    outcome: written ? "written" : "kept",
    detail: `${written ? "now" : "already"} ignores \`${WORKTREE_DIR}/\``,
  };
}

async function writeConfigFile(repoRoot: string): Promise<InitVerdict> {
  const configPath = join(repoRoot, CONFIG_FILE_PATH);
  if (existsSync(configPath)) {
    return { subject: CONFIG_FILE_PATH, outcome: "kept", detail: "already exists" };
  }

  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, CONFIG_SOURCE, "utf8");

  return {
    subject: CONFIG_FILE_PATH,
    outcome: "written",
    detail: 'landing: "merge", every other setting on its default',
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
    return { subject: DEFAULT_DOCKERFILE_PATH, outcome: "kept", detail: "already exists" };
  }

  if (!stack) {
    return {
      subject: DEFAULT_DOCKERFILE_PATH,
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
    subject: DEFAULT_DOCKERFILE_PATH,
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
 * A `.relay/config.ts` carrying nothing but the landing — every other field has
 * a package default, and echoing those back out would freeze them against
 * future defaults. `landing` has none, because it decides whether relay moves
 * the operator's own branch
 * ([ADR-0015](../../docs/adr/0015-a-repo-declares-how-a-pass-lands.md)), and the
 * branch it moves is read from the host's checkout at pass start
 * ([ADR-0016](../../docs/adr/0016-the-base-branch-is-the-hosts-checkout.md)).
 */
const CONFIG_SOURCE = 'export default {\n  landing: "merge", // or "pull-request"\n};\n';

function label(outcome: InitVerdict["outcome"]): string {
  return { written: "wrote ", kept: "kept  ", skipped: "skip  ", failed: "FAILED" }[outcome];
}
