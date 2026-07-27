import { CONFIG_FILE_NAME, loadConfig, type RelayConfig } from "./config.js";
import { ExitCode } from "./exit-codes.js";
import { type DockerRunner, dockerDaemonVersionInSandbox, runDocker } from "./docker-host.js";
import { type GhRunner, ghAuthStatus, ghVersion, runGh } from "./github.js";
import { resolveSandboxImage, verifyPrebuiltImage } from "./sandbox-image.js";
import { loadSecrets } from "./secrets.js";

/** Why the daemon check cannot run when an earlier check failed. */
const NO_IMAGE = "no sandbox image to run the check in";

/**
 * One preflight check's verdict. `skipped` is for a check whose prerequisite
 * failed — a sandbox image cannot be resolved without a config that parsed.
 */
export interface DoctorCheck {
  name: string;
  status: "ok" | "failed" | "skipped";
  detail: string;
}

export interface DoctorOptions {
  repoRoot?: string;
  env?: NodeJS.ProcessEnv;
  docker?: DockerRunner;
  gh?: GhRunner;
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

  if (installedGh) {
    await record(
      checks,
      "gh authenticated",
      () => ghAuthStatus(gh),
      (status: string) => loggedInLine(status),
    );
  } else {
    skip(checks, "gh authenticated", "no `gh` on this host to ask for a credential");
  }

  if (!config) {
    skip(checks, "sandbox image", `no valid ${CONFIG_FILE_NAME} to read the image from`);
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
    skip(checks, "docker daemon", NO_IMAGE);
    return checks;
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
 * Run one check and record its verdict, handing back its value for the checks
 * that build on it — or `undefined` when it failed.
 */
async function record<T>(
  checks: DoctorCheck[],
  name: string,
  run: () => Promise<T>,
  describe: (value: T) => string,
): Promise<T | undefined> {
  try {
    const value = await run();
    checks.push({ name, status: "ok", detail: describe(value) });
    return value;
  } catch (error) {
    checks.push({ name, status: "failed", detail: reason(error) });
    return undefined;
  }
}

function skip(checks: DoctorCheck[], name: string, why: string): void {
  checks.push({ name, status: "skipped", detail: why });
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function label(status: DoctorCheck["status"]): string {
  return { ok: "  ok  ", failed: "FAILED", skipped: " skip " }[status];
}
