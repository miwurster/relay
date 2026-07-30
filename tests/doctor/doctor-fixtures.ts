import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CONFIG_FILE_PATH } from "../../src/config.js";
import type { ResolvedGate } from "../../src/crew/contract.js";
import type { DoctorCheck } from "../../src/doctor/doctor.js";
import type { GateProbe } from "../../src/doctor/gate-probe.js";
import { PASS_LABELS, TRIAGE_LABELS } from "../../src/tracker/labels.js";
import { TRACKER_DOC_PATH } from "../../src/tracker/tracker-doc.js";
import { SKILL_PLUGINS } from "../../src/sandbox/skills.js";

/**
 * Every fixture doctor's tests run against: the repo roots, the fake `git`,
 * `docker`, `gh` and gate-probe seams, and the report readers.
 *
 * Shared by the four files the checks are grouped into, so a seam is faked once
 * and every group reads the same host.
 */
export const validConfig = `export default {
  landing: "pull-request",
  image: "registry.example.com/relay:1",
};`;

/** The same repo, landing on the base branch itself. */
export const mergeConfig = `export default {
  landing: "merge",
  image: "registry.example.com/relay:1",
};`;

export const completeSecrets = {
  GH_TOKEN: "gh-token",
  CLAUDE_CODE_OAUTH_TOKEN: "oauth-token",
};

/**
 * A repo root holding the given `.relay/config.ts`, if any, a wired-up
 * `.gitignore`, and the tracker doc every tracker-facing role reads first.
 */
export async function repoWith(configSource: string | undefined): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "relay-doctor-"));
  if (configSource !== undefined) {
    const configPath = join(root, CONFIG_FILE_PATH);
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, configSource, "utf8");
  }
  await writeFile(join(root, ".gitignore"), ".sandcastle/\n", "utf8");
  const trackerDoc = join(root, TRACKER_DOC_PATH);
  await mkdir(dirname(trackerDoc), { recursive: true });
  await writeFile(trackerDoc, "# Issue tracker\n", "utf8");
  return root;
}

/**
 * A Claude config directory holding the given installed-plugins file.
 *
 * Every env fixture points at one of these rather than at the real machine's,
 * so the plugin check never reads whatever the host running the suite happens
 * to have installed.
 */
export async function claudeConfigDirWith(installed: unknown): Promise<string> {
  const configDir = await mkdtemp(join(tmpdir(), "relay-doctor-claude-"));
  await mkdir(join(configDir, "plugins"), { recursive: true });
  await writeFile(
    join(configDir, "plugins", "installed_plugins.json"),
    JSON.stringify(installed),
    "utf8",
  );
  return configDir;
}

/** A host with every plugin a pass mounts installed, at a known version. */
export const hostWithEveryPlugin = await claudeConfigDirWith({
  version: 2,
  plugins: Object.fromEntries(
    SKILL_PLUGINS.map((key, index) => [
      key,
      [{ scope: "user", installPath: `/plugins/${key}`, version: `1.${index}.0` }],
    ]),
  ),
});

/** A host whose Claude has none of the plugins a pass mounts. */
export const hostWithNoPlugins = await claudeConfigDirWith({ version: 2, plugins: {} });

/** A host whose Claude recorded an install without the version it installed. */
export const hostWithoutPluginVersions = await claudeConfigDirWith({
  version: 2,
  plugins: Object.fromEntries(
    SKILL_PLUGINS.map((key) => [key, [{ scope: "user", installPath: `/plugins/${key}` }]]),
  ),
});

/** An env carrying every secret, so no credential file is needed. */
export const envWithSecrets = (overrides: Record<string, string> = {}): NodeJS.ProcessEnv => ({
  ...completeSecrets,
  CLAUDE_CONFIG_DIR: hostWithEveryPlugin,
  ...overrides,
});

/** An env carrying no secret at all, on a host that still has its plugins. */
export const envWithoutSecrets = (): NodeJS.ProcessEnv => ({
  CLAUDE_CONFIG_DIR: hostWithEveryPlugin,
});

/**
 * Every check doctor reports, in the order it reports them. The report is these
 * same sixteen lines whatever the host looks like: a check doctor cannot reach
 * is skipped, so nothing that failed ever shortens the list.
 */
export const EVERY_CHECK = [
  "config",
  "worktree ignored",
  "credentials ignored",
  "secrets",
  "skill plugins",
  "tracker doc",
  "gh installed",
  "gh authenticated",
  "labels",
  "triage labels",
  "landing",
  "base branch ruleset",
  "worktree clean",
  "sandbox image",
  "gate",
  "docker daemon",
];

/** A `GitRunner` for a repo that ignores the credential file, clean and on `main`. */
export const ignoringGit = async (args: readonly string[]) =>
  args.includes("symbolic-ref") ? "main" : "";

/** A `GitRunner` for a repo that does not ignore it — `check-ignore` exits non-zero. */
export const notIgnoringGit = async (args: readonly string[]) => {
  if (!args.includes("check-ignore")) return ignoringGit(args);
  throw new Error(`git ${args.join(" ")} failed: Command failed`);
};

/** A `GitRunner` whose worktree carries uncommitted work. */
export const dirtyGit = async (args: readonly string[]) =>
  args.includes("status") ? " M src/doctor/doctor.ts" : await ignoringGit(args);

/** A `GitRunner` on a detached `HEAD` — `symbolic-ref` has no branch to name. */
export const detachedGit = async (args: readonly string[]) => {
  if (!args.includes("symbolic-ref")) return "";
  throw new Error("git symbolic-ref --short HEAD failed: fatal: ref HEAD is not a symbolic ref");
};

/** A `GitRunner` on a branch with no commits yet — `rev-parse HEAD` fails. */
export const unbornGit = async (args: readonly string[]) => {
  if (!args.includes("rev-parse")) return await ignoringGit(args);
  throw new Error("git rev-parse --verify --quiet HEAD failed: Command failed");
};

/** Answers each docker invocation with a canned line, recording the calls. */
export function fakeDocker(answers: string[] = []) {
  const calls: string[][] = [];
  const docker = async (args: readonly string[]) => {
    calls.push([...args]);
    return answers.shift() ?? "";
  };
  return { docker, calls };
}

/** A healthy host's answers: the image's id, the socket gid, the server version. */
export const healthyDocker = () => fakeDocker(["sha256:abc", "0", "29.6.2"]);

/** Answers each `gh` invocation with a canned line, recording the calls. */
export function fakeGh(answers: string[] = []) {
  const calls: string[][] = [];
  const gh = async (args: readonly string[]) => {
    calls.push([...args]);
    return answers.shift() ?? "";
  };
  return { gh, calls };
}

/** Every label relay's own passes and its agent skills speak in. */
export const ALL_LABELS = [...PASS_LABELS, ...TRIAGE_LABELS].map(({ name }) => name);

/**
 * A healthy host's `gh`: a version, a logged-in auth status, a repo holding
 * `labels` — every label in the vocabulary unless a test says less — and a base
 * branch with no ruleset in force on it.
 */
export const healthyGh = (labels: readonly string[] = ALL_LABELS) =>
  fakeGh([
    "gh version 2.62.0 (2024-11-14)",
    "✓ Logged in to github.com account octocat",
    JSON.stringify(labels.map((name) => ({ name }))),
    "[]",
  ]);

/** A `gh` whose repo has a ruleset requiring a pull request on every branch. */
export const ghWithPullRequestRuleset = () =>
  fakeGh([
    "gh version 2.62.0 (2024-11-14)",
    "✓ Logged in to github.com account octocat",
    JSON.stringify(ALL_LABELS.map((name) => ({ name }))),
    JSON.stringify([
      { type: "deletion", ruleset_id: 41, ruleset_source: "miwurster" },
      { type: "pull_request", ruleset_id: 42, ruleset_source: "miwurster/relay" },
    ]),
  ]);

/** A `gh` that is on the PATH but has no valid credential. */
export const unauthenticatedGh = async (args: readonly string[]) => {
  if (args[0] === "--version") return "gh version 2.62.0 (2024-11-14)";
  throw new Error("You are not logged into any GitHub hosts. Run gh auth login to authenticate.");
};

/** A host with no `gh` at all: every invocation fails the way `execFile` does. */
export const missingGh = async () => {
  throw new Error("spawn gh ENOENT");
};

/**
 * A probe answering with the gate it was given, recording the calls. No doctor
 * test opens a sandbox or spends a session: the probe is the whole seam.
 */
export function fakeProbe(gate: ResolvedGate) {
  const calls: { repoRoot: string; baseBranch: string; image: string }[] = [];
  const probe: GateProbe = async ({ repoRoot, baseBranch, image }) => {
    calls.push({ repoRoot, baseBranch, image });
    return gate;
  };
  return { probe, calls };
}

/** A repo that declares its gate in its own docs. */
export const declaredProbe = fakeProbe({
  command: "npm run verify",
  provenance: "declared",
  source: "AGENTS.md, under Verifying",
}).probe;

/** A repo that declares nothing, leaving the resolver to guess. */
export const inferredProbe = fakeProbe({
  command: "./mvnw verify",
  provenance: "inferred",
  source: "pom.xml is a Maven build",
}).probe;

/**
 * A sink recording every chunk written to it, so a test reads the exact report
 * bytes — the pending lines and the escapes that erase them included.
 */
export function fakeSink(isTTY: boolean) {
  const chunks: string[] = [];
  const out = {
    write: (chunk: string) => {
      chunks.push(chunk);
    },
    isTTY,
  };
  return { out, chunks };
}

/** The line a check announces itself with before it runs. */
export const pendingLine = (name: string) => `   run   ${name}`;

/** Every check named by a verdict line, in the order the report wrote them. */
export function reportedNames(chunks: readonly string[]): string[] {
  return chunks.flatMap((chunk) => {
    const [, name] = /^ {2}.{6} (.+?): /.exec(chunk) ?? [];
    return name === undefined ? [] : [name];
  });
}

export function check(checks: readonly DoctorCheck[], name: string): DoctorCheck {
  const found = checks.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`No ${name} check in ${checks.map((c) => c.name).join(", ")}`);
  return found;
}
