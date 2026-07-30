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
import { GITIGNORE_FILE_NAME, WORKTREE_DIR, WORKTREE_RULE } from "../host/worktree-dir.js";
import { resolveSkillPlugins, type SkillPlugin } from "../sandbox/skills.js";
import { requireTrackerDoc, TRACKER_DOC_PATH } from "../tracker/tracker-doc.js";
import { credentialFileIgnored } from "../host/credential-file.js";
import { isIgnored } from "../host/gitignore.js";
import { currentBranch, runGit, type GitRunner } from "../host/git.js";
import { whyLandingRefusesWorktree } from "../host/dirty-worktree.js";
import { type CheckReporter, liveReporter, type ReportSink, SILENT_REPORTER } from "./report.js";

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
  reporter?: CheckReporter;
}

/**
 * The checks recorded so far and who to tell as each one starts and resolves.
 * Carried together so a check never has to know whether anyone is listening.
 */
interface Ledger {
  checks: DoctorCheck[];
  reporter: CheckReporter;
}

/**
 * Run the opt-in preflight and report every check.
 *
 * Unlike a real run, which fails fast on config and secrets and lets the deep
 * failures surface where they are used, doctor runs the deep checks eagerly so
 * an operator sees their whole setup in one go. Any failure is exit 2.
 *
 * The report arrives while the checks run rather than in one batch after them,
 * which is the reporter's job — doctor only says where it writes.
 */
export async function runDoctor({
  out = process.stdout,
  ...options
}: Omit<DoctorOptions, "reporter"> & { out?: ReportSink } = {}): Promise<ExitCode> {
  out.write("relay doctor\n");
  const checks = await runDoctorChecks({ ...options, reporter: liveReporter(out) });

  const failed = checks.filter((check) => check.status === "failed");
  if (failed.length === 0) return ExitCode.Success;
  out.write(`\nrelay doctor: ${failed.length} of ${checks.length} checks failed.\n`);
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
 * at sixteen checks the graph would cost more in generics than the guards cost
 * in lines.
 */
export async function runDoctorChecks({
  repoRoot = process.cwd(),
  env = process.env,
  git = runGit,
  docker = runDocker,
  gh = runGh,
  probe = probeGate,
  reporter = SILENT_REPORTER,
}: DoctorOptions = {}): Promise<DoctorCheck[]> {
  const ledger: Ledger = { checks: [], reporter };

  const config = await record(
    ledger,
    "config",
    () => loadConfig(repoRoot),
    () => `${CONFIG_FILE_PATH} is valid`,
  );

  await record(
    ledger,
    "worktree ignored",
    () => assertWorktreeDirIgnored(repoRoot),
    () => `${GITIGNORE_FILE_NAME} ignores \`${WORKTREE_DIR}/\``,
  );

  await record(
    ledger,
    "credentials ignored",
    () => assertCredentialFileIgnored({ repoRoot, git }),
    () => `git ignores \`${CREDENTIAL_FILE_PATH}\``,
  );

  const secrets = await record(
    ledger,
    "secrets",
    () => loadSecrets({ repoRoot, env }),
    secretsDetail,
  );

  // Neither of these depends on anything earlier in the report — they read the
  // host's own state — so neither is ever skipped.
  await record(ledger, "skill plugins", () => resolveSkillPlugins(env), pluginsDetail);

  await record(
    ledger,
    "tracker doc",
    () => requireTrackerDoc(repoRoot),
    () => `this repo commits ${TRACKER_DOC_PATH}`,
  );

  const installedGh = await record(
    ledger,
    "gh installed",
    () => ghVersion(gh),
    (version: string) => `${version} on this host's PATH`,
  );

  let authenticated: string | undefined;
  if (installedGh) {
    authenticated = await record(
      ledger,
      "gh authenticated",
      () => ghAuthStatus(gh),
      (status: string) => loggedInLine(status),
    );
  } else {
    skip(ledger, "gh authenticated", "no `gh` on this host to ask for a credential");
  }

  // Success, not a non-empty answer: older `gh` prints its auth status on
  // stderr, and an empty stdout there must not read as no credential.
  if (authenticated !== undefined) {
    await recordLabelChecks(ledger, gh);
  } else {
    skip(ledger, "labels", NO_CREDENTIAL);
    skip(ledger, "triage labels", NO_CREDENTIAL);
  }

  const landedOn = await recordLanding({ ledger, config, repoRoot, git });

  // Both of these ask about landing on the base branch itself, which only
  // `merge` landing does — under `pull-request` they are skipped rather than
  // answered as passing.
  if ("why" in landedOn) {
    skip(ledger, "base branch ruleset", landedOn.why);
    skip(ledger, "worktree clean", landedOn.why);
  } else {
    const baseBranch = landedOn.branch;
    if (authenticated === undefined) {
      skip(ledger, "base branch ruleset", NO_CREDENTIAL_FOR_RULESETS);
    } else {
      await record(
        ledger,
        "base branch ruleset",
        () => assertBranchIsLandable({ branch: baseBranch, gh }),
        () => `no ruleset on ${baseBranch} requires a pull request`,
      );
    }

    await record(
      ledger,
      "worktree clean",
      () => whyLandingRefusesWorktree({ repoRoot, landing: "merge", baseBranch, git }),
      worktreeDetail,
      (reason) => (reason ? "warning" : "ok"),
    );
  }

  let image: ResolvedImage | undefined;
  if (config) {
    image = await record(
      ledger,
      "sandbox image",
      () => resolvableImage({ repoRoot, config, docker }),
      (resolved) => `${resolved.ref} — ${resolved.how}`,
    );
  } else {
    skip(ledger, "sandbox image", `no valid ${CONFIG_FILE_PATH} to read the image from`);
  }

  // An image resolves only from a config that parsed, so a missing image is
  // what an operator sees either way — with the config failure a line above it.
  if (config && image && secrets) {
    await record(
      ledger,
      "gate",
      () => probe({ repoRoot, config, secrets }),
      gateDetail,
      (gate) => (gate.provenance === "declared" ? "ok" : "warning"),
    );
  } else {
    const why = image
      ? "no credential to run the resolver's leg on"
      : "no sandbox image to open a sandbox from";
    skip(ledger, "gate", why);
  }

  if (image) {
    await record(
      ledger,
      "docker daemon",
      () => dockerDaemonVersionInSandbox({ image: image.ref, docker }),
      (version: string) => `reachable as the non-root sandbox user — server ${version}`,
    );
  } else {
    skip(ledger, "docker daemon", "no sandbox image to reach the daemon from");
  }

  return ledger.checks;
}

/**
 * Either the base branch a pass would land on, or the one reason the
 * `merge`-only checks after it have nothing to ask about. A repo that lands
 * through a pull request is not a repo that nearly failed them: relay pushes
 * only its own pass branch there, and never touches this host's worktree.
 */
type LandedOn = { branch: string } | { why: string };

/**
 * What a pass would land and where, and the base branch every check after it
 * asks about — or why there is none to ask about.
 *
 * The landing comes from the config and the branch from this host's checkout
 * ([ADR-0016](../../docs/adr/0016-the-base-branch-is-the-hosts-checkout.md)), so
 * a detached or unborn `HEAD` fails here: a pass has nothing to be cut from.
 */
async function recordLanding({
  ledger,
  config,
  repoRoot,
  git,
}: {
  ledger: Ledger;
  config: RelayConfig | undefined;
  repoRoot: string;
  git: GitRunner;
}): Promise<LandedOn> {
  if (!config) {
    skip(ledger, "landing", NO_LANDING_TO_READ);
    return { why: NO_LANDING_TO_READ };
  }
  const branch = await record(
    ledger,
    "landing",
    () => currentBranch({ repoRoot, git }),
    (resolved: string) => landingDetail(config.landing, resolved),
  );
  if (config.landing !== "merge") return { why: "this repo lands through a pull request" };
  if (branch === undefined) return { why: "no base branch resolved to ask about" };
  return { branch };
}

/** What a pass would do with the branch this host is standing on. */
function landingDetail(landing: Landing, baseBranch: string): string {
  if (landing === "merge") {
    return `\`merge\` — a green pass would land on ${baseBranch} and push it`;
  }
  return `\`pull-request\` — a green pass would open a pull request against ${baseBranch}`;
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
 * What a pass would refuse this host's worktree over, if anything. A warning
 * only: doctor runs whenever an operator likes, and the worktree that decides
 * anything is the one a pass finds at its own start.
 */
function worktreeDetail(reason: string | undefined): string {
  return reason ?? "no uncommitted work on this host";
}

/**
 * What this repo's label vocabulary looks like, read in one call and graded
 * twice. The call is announced as `labels`, the check it is made for, and
 * `triage labels` resolves off the same answer a moment later.
 *
 * A pass label nobody created is a failure: `gh` resolves every `--add-label`
 * name against the repo's labels, so the pass would die mid-flight applying
 * one. A triage label nobody created is only a warning — relay's own code
 * never reads them, and `docs/agents/triage-labels.md` invites a repo to use
 * its own vocabulary instead.
 */
async function recordLabelChecks(ledger: Ledger, gh: GhRunner): Promise<void> {
  ledger.reporter.started("labels");
  let existing: string[];
  try {
    existing = await ghLabelNames(gh);
  } catch (error) {
    const detail = reasonOf(error);
    add(ledger, { name: "labels", status: "failed", detail });
    add(ledger, { name: "triage labels", status: "failed", detail });
    return;
  }

  add(ledger, labelCheck({ name: "labels", wanted: PASS_LABELS, existing, whenAbsent: "failed" }));
  add(
    ledger,
    labelCheck({
      name: "triage labels",
      wanted: TRIAGE_LABELS,
      existing,
      whenAbsent: "warning",
    }),
  );
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
  if (await isIgnored(repoRoot, WORKTREE_RULE)) return;
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

/**
 * Which plugin versions a pass would mount, so an operator can see which skill
 * versions their legs will actually run. A missing plugin never reaches here:
 * the resolver reports every one of them in one error, which is the detail.
 */
function pluginsDetail(plugins: readonly SkillPlugin[]): string {
  return plugins.map((plugin) => `${plugin.name} ${plugin.version ?? "(no version)"}`).join(", ");
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
  ledger: Ledger,
  name: string,
  run: () => Promise<T>,
  describe: (value: T) => string,
  statusOf: (value: T) => "ok" | "warning" = () => "ok",
): Promise<T | undefined> {
  ledger.reporter.started(name);
  try {
    const value = await run();
    add(ledger, { name, status: statusOf(value), detail: describe(value) });
    return value;
  } catch (error) {
    add(ledger, { name, status: "failed", detail: reasonOf(error) });
    return undefined;
  }
}

/** A check nothing was run for, so nothing announced it either. */
function skip(ledger: Ledger, name: string, why: string): void {
  add(ledger, { name, status: "skipped", detail: why });
}

function add(ledger: Ledger, check: DoctorCheck): void {
  ledger.checks.push(check);
  ledger.reporter.resolved(check);
}
