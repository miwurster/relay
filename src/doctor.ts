import { CONFIG_FILE_NAME, loadConfig, type RelayConfig } from "./config.js";
import { ConfigError, reasonOf } from "./errors.js";
import { ExitCode } from "./exit-codes.js";
import { type DockerRunner, dockerDaemonVersionInSandbox, runDocker } from "./docker-host.js";
import type { ResolvedGate } from "./crew.js";
import { type GateProbe, probeGate } from "./gate-probe.js";
import { type GhRunner, ghAuthStatus, ghLabelNames, ghVersion, runGh } from "./github.js";
import { missingLabels, PASS_LABELS, TRIAGE_LABELS, type LabelSpec } from "./labels.js";
import { resolveSandboxImage, verifyPrebuiltImage } from "./sandbox-image.js";
import { loadSecrets } from "./secrets.js";
import {
  GITIGNORE_FILE_NAME,
  ignoresWorktreeDir,
  readGitignore,
  WORKTREE_DIR,
} from "./worktree-dir.js";

/** Why the daemon and gate checks cannot run when an earlier check failed. */
const NO_IMAGE = "no sandbox image to run the check in";

/** Why the label checks cannot run: nothing on this host can ask GitHub. */
const NO_CREDENTIAL = "no `gh` credential to read this repo's labels with";

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

export interface DoctorOptions {
  repoRoot?: string;
  env?: NodeJS.ProcessEnv;
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
 */
export async function runDoctorChecks({
  repoRoot = process.cwd(),
  env = process.env,
  docker = runDocker,
  gh = runGh,
  probe = probeGate,
}: DoctorOptions = {}): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];

  const config = await record(
    checks,
    "config",
    () => loadConfig(repoRoot),
    () => `${CONFIG_FILE_NAME} is valid`,
  );

  await record(
    checks,
    "worktree ignored",
    () => assertWorktreeDirIgnored(repoRoot),
    () => `${GITIGNORE_FILE_NAME} ignores \`${WORKTREE_DIR}/\``,
  );

  const secrets = await record(
    checks,
    "secrets",
    () => loadSecrets(env),
    () => "every required secret resolves",
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

  if (!config) {
    skip(checks, "sandbox image", `no valid ${CONFIG_FILE_NAME} to read the image from`);
    skip(checks, "gate", `no valid ${CONFIG_FILE_NAME} to open a sandbox from`);
    skip(checks, "docker daemon", NO_IMAGE);
    return checks;
  }

  const image = await record(
    checks,
    "sandbox image",
    () => resolvableImage({ repoRoot, config, docker }),
    (resolved) => `${resolved.ref} — ${resolved.how}`,
  );

  if (!image) {
    skip(checks, "gate", NO_IMAGE);
    skip(checks, "docker daemon", NO_IMAGE);
    return checks;
  }

  if (secrets) {
    await record(
      checks,
      "gate",
      () => probe({ repoRoot, config, secrets }),
      gateDetail,
      (gate) => (gate.provenance === "declared" ? "ok" : "warning"),
    );
  } else {
    skip(checks, "gate", "no credential to run the resolver's leg on");
  }

  await record(
    checks,
    "docker daemon",
    () => dockerDaemonVersionInSandbox({ image: image.ref, docker }),
    (version: string) => `reachable as the non-root sandbox user — server ${version}`,
  );

  return checks;
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
}): Promise<{ ref: string; how: string }> {
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
