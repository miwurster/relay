import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Landing } from "../src/config.js";
import { passRecordDir } from "../src/crew/leg-record.js";
import { ConfigError } from "../src/errors.js";
import { loadSecrets, type Secrets } from "../src/host/secrets.js";
import { digestRecords } from "../src/archive/digest.js";
import { BASE_BRANCH, CLONE_DIR, REHEARSAL_REPO } from "./rehearsal-repo.js";
import type { Scenario } from "./scenarios.js";
import { seedRehearsalRepo } from "./seed.js";

/** relay's own checkout: what is built, and where the credentials are read from. */
const RELAY_ROOT = join(import.meta.dirname, "..");

/** The built CLI a rehearsal runs, which is why the build comes first. */
const RELAY_CLI = join(RELAY_ROOT, "dist", "main.js");

/**
 * Where a run's digest is filed. Gitignored: a record of a session is not a repo
 * artefact, and a committed one would leave the worktree dirty, which a `merge`
 * landing refuses.
 */
const RUNS_DIR = join(RELAY_ROOT, "rehearsal", "runs");

/** What one rehearsal leaves behind, for the operator to read or diff. */
export interface Rehearsal {
  /** relay's own exit code, reported in the digest rather than passed on. */
  exitCode: number;
  /** The file the digest was filed in. */
  runFile: string;
}

/**
 * One rehearsal, end to end: build relay, seed the scenario, run a pass over it
 * in the rehearsal clone, then print and file the digest.
 *
 * From any state — repo absent, half-seeded, or left behind by a crashed pass —
 * because every step it composes is idempotent on its own. The three steps stay
 * separately invokable, so a contributor can seed, drive relay by hand with an
 * ad-hoc flag, poke the clone mid-flight, and digest afterwards.
 *
 * Both arguments arrive resolved, from the command line that took them, so a
 * mistyped name is refused before a build is spent on it.
 */
export async function rehearse({
  scenario,
  landing,
}: {
  scenario: Scenario;
  landing: Landing;
}): Promise<Rehearsal> {
  // Resolved here as well as in the seed, because the pass runs in the clone —
  // which carries a `.relay/config.ts` but deliberately no credential file — so
  // the secrets have to be handed to it out of relay's own environment.
  const secrets = await loadSecrets({ repoRoot: RELAY_ROOT });

  await buildRelay();
  // One scenario, so one seeded work item: a rehearsal never takes `all`, because
  // its passes would run one after another over one clone and only the first would
  // be cut from genesis.
  const [{ workItem }] = await seedRehearsalRepo({ scenarios: [scenario], landing });
  const startedAt = new Date();
  const exitCode = await runPassInClone({ workItem, secrets });

  const digest = [
    heading({ scenario: scenario.name, landing, workItem, startedAt, exitCode }),
    await digestRecords(passRecordDir(CLONE_DIR, workItem)),
  ].join("\n");

  const runFile = await fileDigest({ scenario: scenario.name, landing, startedAt, digest });
  console.log(`\n${digest}`);
  step(`digest filed in ${runFile}`);
  return { exitCode, runFile };
}

/**
 * Build relay, so the pass runs the change under rehearsal rather than whatever
 * was in `dist/` from last time.
 */
async function buildRelay(): Promise<void> {
  step("building relay");
  const code = await streamed("npm", ["run", "build"], { cwd: RELAY_ROOT });
  if (code !== 0) {
    throw new ConfigError(`\`npm run build\` exited ${code}, so there is nothing to rehearse.`);
  }
}

/**
 * Run one pass over the seeded work item, in the rehearsal clone, with relay's
 * output going straight to the terminal.
 *
 * Inherited stdio rather than captured: a rehearsal is watched while it runs, and
 * a pass buffered until the end would answer "does this feel better" only after
 * it stopped mattering.
 */
async function runPassInClone({
  workItem,
  secrets,
}: {
  workItem: number;
  secrets: Secrets;
}): Promise<number> {
  step(`running relay over #${workItem} in ${CLONE_DIR}`);
  return await streamed("node", [RELAY_CLI, String(workItem)], {
    cwd: CLONE_DIR,
    env: {
      ...process.env,
      GH_TOKEN: secrets.githubToken,
      [secrets.claude.variable]: secrets.claude.token,
    },
  });
}

/**
 * What the digest's own sections cannot know: which scenario ran, under which
 * landing, over which work item, when, and how relay exited.
 *
 * The exit code is here rather than passed on as the rehearsal's own, because a
 * blocked pass is an ordinary rehearsal outcome and not a failure of the rig. It
 * is in the file so that a landed rehearsal and a blocked one are still
 * distinguishable in a digest read a week later.
 */
function heading({
  scenario,
  landing,
  workItem,
  startedAt,
  exitCode,
}: {
  scenario: string;
  landing: Landing;
  workItem: number;
  startedAt: Date;
  exitCode: number;
}): string {
  return [
    `rehearsal: ${scenario}`,
    `landing: ${landing}`,
    `repo: ${REHEARSAL_REPO} (${BASE_BRANCH})`,
    `work item: #${workItem}`,
    `started: ${startedAt.toISOString()}`,
    `relay exit code: ${exitCode}`,
    "",
  ].join("\n");
}

/**
 * File the digest under the rig, named by scenario, landing and start time, so
 * the runs that are actually comparable sit side by side and diff.
 *
 * The landing is in the name rather than only in the heading because a `merge`
 * run and a `pull-request` run over one scenario differ in the legs they even
 * have — diffing the two says nothing, and a name that sorted them together
 * would invite it.
 */
async function fileDigest({
  scenario,
  landing,
  startedAt,
  digest,
}: {
  scenario: string;
  landing: Landing;
  startedAt: Date;
  digest: string;
}): Promise<string> {
  await mkdir(RUNS_DIR, { recursive: true });
  const path = join(RUNS_DIR, `${scenario}-${landing}-${stamp(startedAt)}.txt`);
  await writeFile(path, digest, "utf8");
  return path;
}

/** An ISO instant a filename can carry, on every platform. */
function stamp(at: Date): string {
  return at
    .toISOString()
    .replace(/\.\d+Z$/, "")
    .replaceAll(":", "-");
}

/** A child process whose output is the terminal's, answering with its exit code. */
async function streamed(
  command: string,
  args: readonly string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv },
): Promise<number> {
  const child = spawn(command, [...args], { ...options, stdio: "inherit" });
  return await new Promise<number>((resolve, reject) => {
    child.on("error", reject);
    // A signalled child has no code of its own. Reported as the shell's own
    // convention rather than as a 0 that would read as a landed pass.
    child.on("close", (code, signal) => {
      resolve(code ?? (signal ? 128 : 1));
    });
  });
}

function step(message: string): void {
  console.log(`rehearse: ${message}`);
}
