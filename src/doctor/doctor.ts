import {
  CONFIG_FILE_PATH,
  CREDENTIAL_FILE_PATH,
  type Landing,
  loadConfig,
  RELAY_GITIGNORE_PATH,
  type RelayConfig,
} from "../config.js";
import { ConfigError, reasonOf } from "../errors.js";
import { ExitCode } from "../exit-codes.js";
import {
  type DockerRunner,
  dockerDaemonVersionInSandbox,
  runDocker,
} from "../sandbox/docker-host.js";
import type { ResolvedGate } from "../crew/contract.js";
import { type GateProbe, probeGate } from "./gate-probe.js";
import {
  type GhRunner,
  ghAuthStatus,
  ghLabelNames,
  ghVersion,
  pullRequestRuleset,
  runGh,
} from "../tracker/github.js";
import { missingLabels, PASS_LABELS, TRIAGE_LABELS, type LabelSpec } from "../tracker/labels.js";
import { resolveSandboxImage, verifyPrebuiltImage } from "../sandbox/sandbox-image.js";
import { loadSecrets, type Secrets, type SecretSource } from "../host/secrets.js";
import {
  GITIGNORE_FILE_NAME,
  ignoresWorktreeDir,
  readGitignore,
  WORKTREE_DIR,
} from "../host/worktree-dir.js";
import { credentialFileIgnored } from "../host/credential-file.js";
import { currentBranch, isWorktreeDirty, runGit, type GitRunner } from "../host/git.js";

/** Why the label checks cannot run: nothing on this host can ask GitHub. */
const NO_CREDENTIAL = "no `gh` credential to read this repo's labels with";

/** Why the landing checks cannot run: the config they read the landing from is unusable. */
const NO_LANDING_TO_READ = `no valid ${CONFIG_FILE_PATH} to read the landing from`;

/**
 * One preflight check's verdict.
 *
 * `skipped` is for a check whose prerequisite failed — a sandbox image cannot
 * be resolved without a config that parsed. `warning` is for a setup relay can
 * run against but had to guess at, which is imperfect rather than broken, and
 * so is worth saying out loud without failing the run.
 */
export interface DoctorCheck {
  name: string;
  status: "ok" | "warning" | "failed" | "skipped";
  detail: string;
}

/** The image a pass would run, and how doctor proved it is there. */
interface ResolvedImage {
  ref: string;
  how: string;
}

export interface DoctorOptions {
  repoRoot?: string;
  env?: NodeJS.ProcessEnv;
  git?: GitRunner;
  docker?: DockerRunner;
  gh?: GhRunner;
  probe?: GateProbe;
}

/**
 * Run the opt-in preflight and report every check.
 *
 * Unlike a real run, which fails fast on config and secrets and lets the deep
 * failures surface where they are used, doctor runs the deep checks eagerly so
 * an operator sees their whole setup in one go. Any failure is exit 2.
 */
export async function runDoctor(options: DoctorOptions = {}): Promise<ExitCode> {
  const checks = await runDoctorChecks(options);
  console.log("relay doctor");
  for (const check of checks) {
    console.log(`  ${label(check.status)} ${check.name}: ${check.detail}`);
  }

  const failed = checks.filter((check) => check.status === "failed");
  if (failed.length === 0) return ExitCode.Success;
  console.log(`\nrelay doctor: ${failed.length} of ${checks.length} checks failed.`);
  return ExitCode.Error;
}

/**
 * Every check, in dependency order: a failing one is reported and the run
 * carries on, so a missing secret and an unreachable daemon are found together.
 *
 * Each check that builds on an earlier one guards on that check's value and
 * says, in its own words, what it wanted the value for — so a prerequisite
 * that failed skips its dependents without any path shortening the report.
 * The checks are hand-wired rather than declared as a graph a runner resolves:
 * at fourteen checks the graph would cost more in generics than the guards cost
 * in lines.
 */
export async function runDoctorChecks({
  repoRoot = process.cwd(),
  env = process.env,
  git = runGit,
  docker = runDocker,
  gh = runGh,
  probe = probeGate,
}: DoctorOptions = {}): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];

  const config = await record(
    checks,
    "config",
    () => loadConfig(repoRoot),
    () => `${CONFIG_FILE_PATH} is valid`,
  );

  await record(
    checks,
    "worktree ignored",
    () => assertWorktreeDirIgnored(repoRoot),
    () => `${GITIGNORE_FILE_NAME} ignores \`${WORKTREE_DIR}/\``,
  );

  await record(
    checks,
    "credentials ignored",
    () => assertCredentialFileIgnored({ repoRoot, git }),
    () => `git ignores \`${CREDENTIAL_FILE_PATH}\``,
  );

  const secrets = await record(
    checks,
    "secrets",
    () => loadSecrets({ repoRoot, env }),
    secretsDetail,
  );

  const installedGh = await record(
    checks,
    "gh installed",
    () => ghVersion(gh),
    (version: string) => `${version} on this host's PATH`,
  );

  let authenticated: string | undefined;
  if (installedGh) {
    authenticated = await record(
      checks,
      "gh authenticated",
      () => ghAuthStatus(gh),
      (status: string) => loggedInLine(status),
    );
  } else {
    skip(checks, "gh authenticated", "no `gh` on this host to ask for a credential");
  }

  // Success, not a non-empty answer: older `gh` prints its auth status on
  // stderr, and an empty stdout there must not read as no credential.
  if (authenticated !== undefined) {
    checks.push(...(await labelChecks(gh)));
  } else {
    skip(checks, "labels", NO_CREDENTIAL);
    skip(checks, "triage labels", NO_CREDENTIAL);
  }

  const baseBranch = await recordLanding({ checks, config, repoRoot, git });

  // Both of these ask about landing on the base branch itself, which only
  // `merge` landing does — under `pull-request` they are skipped rather than
  // answered as passing.
  if (config?.landing === "merge" && baseBranch !== undefined) {
    if (authenticated === undefined) {
      skip(checks, "base branch ruleset", NO_CREDENTIAL_FOR_RULESETS);
    } else {
      await record(
        checks,
        "base branch ruleset",
        () => assertBranchIsLandable({ branch: baseBranch, gh }),
        () => `no ruleset on ${baseBranch} requires a pull request`,
      );
    }

    await record(
      checks,
      "worktree clean",
      () => isWorktreeDirty({ repoRoot, git }),
      worktreeDetail,
      (dirty) => (dirty ? "warning" : "ok"),
    );
  } else {
    const why = whyNotLandingOnBase(config);
    skip(checks, "base branch ruleset", why);
    skip(checks, "worktree clean", why);
  }

  let image: ResolvedImage | undefined;
  if (config) {
    image = await record(
      checks,
      "sandbox image",
      () => resolvableImage({ repoRoot, config, docker }),
      (resolved) => `${resolved.ref} — ${resolved.how}`,
    );
  } else {
    skip(checks, "sandbox image", `no valid ${CONFIG_FILE_PATH} to read the image from`);
  }

  // An image resolves only from a config that parsed, so a missing image is
  // what an operator sees either way — with the config failure a line above it.
  if (config && image && secrets) {
    await record(
      checks,
      "gate",
      () => probe({ repoRoot, config, secrets }),
      gateDetail,
      (gate) => (gate.provenance === "declared" ? "ok" : "warning"),
    );
  } else {
    const why = image
      ? "no credential to run the resolver's leg on"
      : "no sandbox image to open a sandbox from";
    skip(checks, "gate", why);
  }

  if (image) {
    await record(
      checks,
      "docker daemon",
      () => dockerDaemonVersionInSandbox({ image: image.ref, docker }),
      (version: string) => `reachable as the non-root sandbox user — server ${version}`,
    );
  } else {
    skip(checks, "docker daemon", "no sandbox image to reach the daemon from");
  }

  return checks;
}

/**
 * What a pass would land and where, and the base branch every check after it
 * asks about — or `undefined` when there is no branch to name.
 *
 * The landing comes from the config and the branch from this host's checkout
 * ([ADR-0016](../../docs/adr/0016-the-base-branch-is-the-hosts-checkout.md)), so
 * a detached or unborn `HEAD` fails here: a pass has nothing to be cut from.
 */
async function recordLanding({
  checks,
  config,
  repoRoot,
  git,
}: {
  checks: DoctorCheck[];
  config: RelayConfig | undefined;
  repoRoot: string;
  git: GitRunner;
}): Promise<string | undefined> {
  if (!config) {
    skip(checks, "landing", NO_LANDING_TO_READ);
    return undefined;
  }
  return record(
    checks,
    "landing",
    () => currentBranch({ repoRoot, git }),
    (branch: string) => landingDetail(config.landing, branch),
  );
}

/** What a pass would do with the branch this host is standing on. */
function landingDetail(landing: Landing, baseBranch: string): string {
  if (landing === "merge") {
    return `\`merge\` — a green pass would land on ${baseBranch} and push it`;
  }
  return `\`pull-request\` — a green pass would open a pull request against ${baseBranch}`;
}

/**
 * Why the two `merge`-only checks were not answered. A repo that lands through
 * a pull request is not a repo that nearly failed them: relay pushes only its
 * own pass branch there, and never touches this host's worktree.
 */
function whyNotLandingOnBase(config: RelayConfig | undefined): string {
  if (!config) return NO_LANDING_TO_READ;
  if (config.landing !== "merge") return "this repo lands through a pull request";
  return "no base branch resolved to ask about";
}

/** Why the ruleset check cannot run: nothing on this host can ask GitHub. */
const NO_CREDENTIAL_FOR_RULESETS = "no `gh` credential to read this branch's rulesets with";

/**
 * A base branch relay is allowed to push to. A ruleset requiring a pull request
 * makes `merge` landing impossible rather than awkward, so it fails here — not
 * after a gate, a rebase and a re-gate have all been paid for.
 */
async function assertBranchIsLandable({
  branch,
  gh,
}: {
  branch: string;
  gh: GhRunner;
}): Promise<void> {
  const ruleset = await pullRequestRuleset({ branch, gh });
  if (!ruleset) return;
  throw new ConfigError(
    `ruleset ${ruleset.id} on ${ruleset.source} requires a pull request on ${branch}, and this ` +
      "repo lands on that branch itself — relay cannot push there at all. Either switch to " +
      '`landing: "pull-request"`, or exempt relay\'s token from that ruleset.',
  );
}

/**
 * Whether this host has uncommitted work. A warning only: doctor runs whenever
 * an operator likes, and the worktree that decides anything is the one a pass
 * finds at its own start.
 */
function worktreeDetail(dirty: boolean): string {
  if (!dirty) return "no uncommitted work on this host";
  return (
    "your worktree has uncommitted work in it, and a pass that lands on this branch refuses " +
    "one — commit or stash it before you start a pass."
  );
}

/**
 * What this repo's label vocabulary looks like, read in one call and graded
 * twice.
 *
 * A pass label nobody created is a failure: `gh` resolves every `--add-label`
 * name against the repo's labels, so the pass would die mid-flight applying
 * one. A triage label nobody created is only a warning — relay's own code
 * never reads them, and `docs/agents/triage-labels.md` invites a repo to use
 * its own vocabulary instead.
 */
async function labelChecks(gh: GhRunner): Promise<DoctorCheck[]> {
  let existing: string[];
  try {
    existing = await ghLabelNames(gh);
  } catch (error) {
    const detail = reasonOf(error);
    return [
      { name: "labels", status: "failed", detail },
      { name: "triage labels", status: "failed", detail },
    ];
  }

  return [
    labelCheck({ name: "labels", wanted: PASS_LABELS, existing, whenAbsent: "failed" }),
    labelCheck({
      name: "triage labels",
      wanted: TRIAGE_LABELS,
      existing,
      whenAbsent: "warning",
    }),
  ];
}

function labelCheck({
  name,
  wanted,
  existing,
  whenAbsent,
}: {
  name: string;
  wanted: readonly LabelSpec[];
  existing: readonly string[];
  whenAbsent: "failed" | "warning";
}): DoctorCheck {
  const missing = missingLabels({ wanted, existing });
  if (missing.length === 0) {
    return { name, status: "ok", detail: `this repo has all ${wanted.length}` };
  }
  return {
    name,
    status: whenAbsent,
    detail: `this repo is missing ${missing.map((spec) => spec.name).join(", ")} — \`relay init\` creates them`,
  };
}

/**
 * A pass cuts its worktree inside the repo, so a `.gitignore` that does not
 * ignore it leaves every pass showing up as untracked noise. `relay init`
 * writes the line now, but a repo migrated before it did never got one.
 */
async function assertWorktreeDirIgnored(repoRoot: string): Promise<void> {
  if (ignoresWorktreeDir(await readGitignore(repoRoot))) return;
  throw new ConfigError(
    `${GITIGNORE_FILE_NAME} does not ignore \`${WORKTREE_DIR}/\`, where a pass cuts its ` +
      "worktree — add it, or re-run `relay init`.",
  );
}

/**
 * The credential file holds the tokens a pass runs on, so a repo that does not
 * ignore it is one `git add` away from publishing them. A hard failure, checked
 * unconditionally and whether or not the file is there yet: a repo set up
 * before `relay init` wrote the rule never got one, and relay should refuse
 * before the dangerous file exists rather than after.
 */
async function assertCredentialFileIgnored({
  repoRoot,
  git,
}: {
  repoRoot: string;
  git: GitRunner;
}): Promise<void> {
  if (await credentialFileIgnored({ repoRoot, git })) return;
  throw new ConfigError(
    `git does not ignore \`${CREDENTIAL_FILE_PATH}\`, which holds this repo's credentials — ` +
      `add \`.env\` to ${RELAY_GITIGNORE_PATH}, or re-run \`relay init\`. ` +
      "If the file is already committed, rotate those tokens.",
  );
}

/** Where each place a secret resolved from is named in doctor's report. */
const SECRET_PLACES: readonly [SecretSource["from"], string][] = [
  ["file", CREDENTIAL_FILE_PATH],
  ["environment", "the environment"],
];

/**
 * Which variables resolved and from where — names only, never values, so the
 * report is safe to paste into an issue.
 *
 * Grouped by place so the ordinary case reads as one phrase, and an operator
 * who filled the credential file in but sees `the environment` knows their
 * shell is winning before they go looking for a typo in the file.
 */
function secretsDetail(secrets: Secrets): string {
  return SECRET_PLACES.map(([from, place]) => ({
    place,
    variables: secrets.sources.filter((source) => source.from === from),
  }))
    .filter(({ variables }) => variables.length > 0)
    .map(({ place, variables }) => `${joinWithAnd(variables.map((s) => s.variable))} from ${place}`)
    .join(", ");
}

/** `a`, or `a and b`, or `a, b and c`. */
function joinWithAnd(names: readonly string[]): string {
  if (names.length < 2) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/**
 * The account line out of `gh auth status`, which names the host and login an
 * operator has to recognise. Older `gh` releases print the status on stderr, so
 * the detail must survive an empty stdout.
 */
function loggedInLine(status: string): string {
  const line = status.split("\n").find((candidate) => /logged in to/i.test(candidate));
  return line?.trim() ?? "`gh auth status` accepted this host's credential";
}

/**
 * The image a pass would run, proven rather than assumed: a configured ref is
 * looked up on the host or in its registry, and a repo without one has its
 * dockerfile actually built — the only honest way to report it as buildable.
 */
async function resolvableImage({
  repoRoot,
  config,
  docker,
}: {
  repoRoot: string;
  config: RelayConfig;
  docker: DockerRunner;
}): Promise<ResolvedImage> {
  if (config.image) {
    const source = await verifyPrebuiltImage({ image: config.image, docker });
    return {
      ref: config.image,
      how: source === "host" ? "prebuilt, present on this host" : "prebuilt, pullable",
    };
  }
  const built = await resolveSandboxImage({ repoRoot, config, docker });
  return { ref: built, how: `built from ${config.dockerfile}` };
}

/**
 * The command a pass would verify this branch with, and where relay got it.
 * A gate nobody declared still runs, so the operator is told rather than
 * stopped — declaring it is how they make relay stop guessing.
 */
function gateDetail(gate: ResolvedGate): string {
  if (gate.provenance === "declared") return `\`${gate.command}\` — declared in ${gate.source}`;
  return (
    `\`${gate.command}\` — no doc declares a gate, so relay inferred it from ${gate.source}. ` +
    "Declare it in your docs to be sure a pass verifies what you verify."
  );
}

/**
 * Run one check and record its verdict, handing back its value for the checks
 * that build on it — or `undefined` when it failed. A check that succeeded is
 * `ok` unless `statusOf` grades its value otherwise.
 */
async function record<T>(
  checks: DoctorCheck[],
  name: string,
  run: () => Promise<T>,
  describe: (value: T) => string,
  statusOf: (value: T) => "ok" | "warning" = () => "ok",
): Promise<T | undefined> {
  try {
    const value = await run();
    checks.push({ name, status: statusOf(value), detail: describe(value) });
    return value;
  } catch (error) {
    checks.push({ name, status: "failed", detail: reasonOf(error) });
    return undefined;
  }
}

function skip(checks: DoctorCheck[], name: string, why: string): void {
  checks.push({ name, status: "skipped", detail: why });
}

function label(status: DoctorCheck["status"]): string {
  return { ok: "  ok  ", warning: " warn ", failed: "FAILED", skipped: " skip " }[status];
}
