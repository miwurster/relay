import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONFIG_FILE_PATH,
  CREDENTIAL_FILE_PATH,
  DEFAULT_DOCKERFILE_PATH,
  RELAY_DIR,
} from "../../src/config.js";
import type { ResolvedGate } from "../../src/crew/contract.js";
import { type DoctorCheck, runDoctor, runDoctorChecks } from "../../src/doctor/doctor.js";
import { ExitCode } from "../../src/exit-codes.js";
import type { GateProbe } from "../../src/doctor/gate-probe.js";
import { PASS_LABELS, TRIAGE_LABELS } from "../../src/tracker/labels.js";
import { TRACKER_DOC_PATH } from "../../src/tracker/tracker-doc.js";
import { SKILL_PLUGINS } from "../../src/sandbox/skills.js";

const validConfig = `export default {
  landing: "pull-request",
  image: "registry.example.com/relay:1",
};`;

/** The same repo, landing on the base branch itself. */
const mergeConfig = `export default {
  landing: "merge",
  image: "registry.example.com/relay:1",
};`;

const completeSecrets = {
  GH_TOKEN: "gh-token",
  CLAUDE_CODE_OAUTH_TOKEN: "oauth-token",
};

/**
 * A repo root holding the given `.relay/config.ts`, if any, a wired-up
 * `.gitignore`, and the tracker doc every tracker-facing role reads first.
 */
async function repoWith(configSource: string | undefined): Promise<string> {
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
async function claudeConfigDirWith(installed: unknown): Promise<string> {
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
const hostWithEveryPlugin = await claudeConfigDirWith({
  version: 2,
  plugins: Object.fromEntries(
    SKILL_PLUGINS.map((key, index) => [
      key,
      [{ scope: "user", installPath: `/plugins/${key}`, version: `1.${index}.0` }],
    ]),
  ),
});

/** A host whose Claude has none of the plugins a pass mounts. */
const hostWithNoPlugins = await claudeConfigDirWith({ version: 2, plugins: {} });

/** A host whose Claude recorded an install without the version it installed. */
const hostWithoutPluginVersions = await claudeConfigDirWith({
  version: 2,
  plugins: Object.fromEntries(
    SKILL_PLUGINS.map((key) => [key, [{ scope: "user", installPath: `/plugins/${key}` }]]),
  ),
});

/** An env carrying every secret, so no credential file is needed. */
const envWithSecrets = (overrides: Record<string, string> = {}): NodeJS.ProcessEnv => ({
  ...completeSecrets,
  CLAUDE_CONFIG_DIR: hostWithEveryPlugin,
  ...overrides,
});

/** An env carrying no secret at all, on a host that still has its plugins. */
const envWithoutSecrets = (): NodeJS.ProcessEnv => ({ CLAUDE_CONFIG_DIR: hostWithEveryPlugin });

/**
 * Every check doctor reports, in the order it reports them. The report is these
 * same sixteen lines whatever the host looks like: a check doctor cannot reach
 * is skipped, so nothing that failed ever shortens the list.
 */
const EVERY_CHECK = [
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
const ignoringGit = async (args: readonly string[]) =>
  args.includes("symbolic-ref") ? "main" : "";

/** A `GitRunner` for a repo that does not ignore it — `check-ignore` exits non-zero. */
const notIgnoringGit = async (args: readonly string[]) => {
  if (!args.includes("check-ignore")) return ignoringGit(args);
  throw new Error(`git ${args.join(" ")} failed: Command failed`);
};

/** A `GitRunner` whose worktree carries uncommitted work. */
const dirtyGit = async (args: readonly string[]) =>
  args.includes("status") ? " M src/doctor/doctor.ts" : await ignoringGit(args);

/** A `GitRunner` on a detached `HEAD` — `symbolic-ref` has no branch to name. */
const detachedGit = async (args: readonly string[]) => {
  if (!args.includes("symbolic-ref")) return "";
  throw new Error("git symbolic-ref --short HEAD failed: fatal: ref HEAD is not a symbolic ref");
};

/** A `GitRunner` on a branch with no commits yet — `rev-parse HEAD` fails. */
const unbornGit = async (args: readonly string[]) => {
  if (!args.includes("rev-parse")) return await ignoringGit(args);
  throw new Error("git rev-parse --verify --quiet HEAD failed: Command failed");
};

/** Answers each docker invocation with a canned line, recording the calls. */
function fakeDocker(answers: string[] = []) {
  const calls: string[][] = [];
  const docker = async (args: readonly string[]) => {
    calls.push([...args]);
    return answers.shift() ?? "";
  };
  return { docker, calls };
}

/** A healthy host's answers: the image's id, the socket gid, the server version. */
const healthyDocker = () => fakeDocker(["sha256:abc", "0", "29.6.2"]);

/** Answers each `gh` invocation with a canned line, recording the calls. */
function fakeGh(answers: string[] = []) {
  const calls: string[][] = [];
  const gh = async (args: readonly string[]) => {
    calls.push([...args]);
    return answers.shift() ?? "";
  };
  return { gh, calls };
}

/** Every label relay's own passes and its agent skills speak in. */
const ALL_LABELS = [...PASS_LABELS, ...TRIAGE_LABELS].map(({ name }) => name);

/**
 * A healthy host's `gh`: a version, a logged-in auth status, a repo holding
 * `labels` — every label in the vocabulary unless a test says less — and a base
 * branch with no ruleset in force on it.
 */
const healthyGh = (labels: readonly string[] = ALL_LABELS) =>
  fakeGh([
    "gh version 2.62.0 (2024-11-14)",
    "✓ Logged in to github.com account octocat",
    JSON.stringify(labels.map((name) => ({ name }))),
    "[]",
  ]);

/** A `gh` whose repo has a ruleset requiring a pull request on every branch. */
const ghWithPullRequestRuleset = () =>
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
const unauthenticatedGh = async (args: readonly string[]) => {
  if (args[0] === "--version") return "gh version 2.62.0 (2024-11-14)";
  throw new Error("You are not logged into any GitHub hosts. Run gh auth login to authenticate.");
};

/** A host with no `gh` at all: every invocation fails the way `execFile` does. */
const missingGh = async () => {
  throw new Error("spawn gh ENOENT");
};

/**
 * A probe answering with the gate it was given, recording the calls. No doctor
 * test opens a sandbox or spends a session: the probe is the whole seam.
 */
function fakeProbe(gate: ResolvedGate) {
  const calls: { repoRoot: string }[] = [];
  const probe: GateProbe = async ({ repoRoot }) => {
    calls.push({ repoRoot });
    return gate;
  };
  return { probe, calls };
}

/** A repo that declares its gate in its own docs. */
const declaredProbe = fakeProbe({
  command: "npm run verify",
  provenance: "declared",
  source: "AGENTS.md, under Verifying",
}).probe;

/** A repo that declares nothing, leaving the resolver to guess. */
const inferredProbe = fakeProbe({
  command: "./mvnw verify",
  provenance: "inferred",
  source: "pom.xml is a Maven build",
}).probe;

/**
 * A sink recording every chunk written to it, so a test reads the exact report
 * bytes — the pending lines and the escapes that erase them included.
 */
function fakeSink(isTTY: boolean) {
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
const pendingLine = (name: string) => `   run   ${name}`;

/** Every check named by a verdict line, in the order the report wrote them. */
function reportedNames(chunks: readonly string[]): string[] {
  return chunks.flatMap((chunk) => {
    const [, name] = /^ {2}.{6} (.+?): /.exec(chunk) ?? [];
    return name === undefined ? [] : [name];
  });
}

function check(checks: readonly DoctorCheck[], name: string): DoctorCheck {
  const found = checks.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`No ${name} check in ${checks.map((c) => c.name).join(", ")}`);
  return found;
}

describe("runDoctorChecks", () => {
  // Under `merge` landing, which is the one mode where no check is skipped.
  it("reports every check as ok on a wired-up repo", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(mergeConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    expect(checks.map((c) => c.name)).toEqual(EVERY_CHECK);
    expect(checks.every((c) => c.status === "ok")).toBe(true);
  });

  it("reports the same checks in the same order on a host with nothing wired up", async () => {
    const repoRoot = await repoWith(undefined);
    await rm(join(repoRoot, ".gitignore"));
    await rm(join(repoRoot, TRACKER_DOC_PATH));

    const checks = await runDoctorChecks({
      repoRoot,
      env: { CLAUDE_CONFIG_DIR: hostWithNoPlugins },
      git: notIgnoringGit,
      docker: async () => {
        throw new Error("Cannot connect to the Docker daemon at unix:///var/run/docker.sock");
      },
      gh: missingGh,
      probe: declaredProbe,
    });

    expect(checks.map((c) => c.name)).toEqual(EVERY_CHECK);
    expect(checks.every((c) => c.status === "failed" || c.status === "skipped")).toBe(true);
  });

  it("names the resolved image so a human can eyeball it", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    expect(check(checks, "sandbox image").detail).toContain("registry.example.com/relay:1");
    expect(check(checks, "docker daemon").detail).toContain("29.6.2");
  });

  it("reports a missing secret without stopping at the first failure", async () => {
    const env = envWithSecrets();
    delete env["GH_TOKEN"];

    const checks = await runDoctorChecks({
      repoRoot: await repoWith(validConfig),
      env,
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    expect(check(checks, "secrets").status).toBe("failed");
    expect(check(checks, "secrets").detail).toContain("GH_TOKEN");
    expect(check(checks, "docker daemon").status).toBe("ok");
  });

  it("reports a repo whose .gitignore misses the worktree directory", async () => {
    const repoRoot = await repoWith(validConfig);
    await rm(join(repoRoot, ".gitignore"));

    const checks = await runDoctorChecks({
      repoRoot,
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    expect(check(checks, "worktree ignored").status).toBe("failed");
    expect(check(checks, "worktree ignored").detail).toContain(".sandcastle/");
    expect(check(checks, "docker daemon").status).toBe("ok");
  });

  it("names where each secret resolved from, and prints no value", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    const detail = check(checks, "secrets").detail;
    expect(detail).toBe("GH_TOKEN and CLAUDE_CODE_OAUTH_TOKEN from the environment");
    expect(detail).not.toContain("gh-token");
    expect(detail).not.toContain("oauth-token");
  });

  it("distinguishes a secret from the credential file from one from the environment", async () => {
    const repoRoot = await repoWith(validConfig);
    await writeFile(join(repoRoot, CREDENTIAL_FILE_PATH), "GH_TOKEN=from-file\n", "utf8");

    const checks = await runDoctorChecks({
      repoRoot,
      env: envWithSecrets({ GH_TOKEN: "" }),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    expect(check(checks, "secrets").detail).toBe(
      `GH_TOKEN from ${CREDENTIAL_FILE_PATH}, CLAUDE_CODE_OAUTH_TOKEN from the environment`,
    );
  });

  it("reads the credential file out of the repo doctor was pointed at", async () => {
    const repoRoot = await repoWith(validConfig);
    await writeFile(
      join(repoRoot, CREDENTIAL_FILE_PATH),
      "GH_TOKEN=from-file\nANTHROPIC_API_KEY=from-file\n",
      "utf8",
    );

    const checks = await runDoctorChecks({
      repoRoot,
      env: envWithoutSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    expect(check(checks, "secrets").status).toBe("ok");
    expect(check(checks, "secrets").detail).toBe(
      `GH_TOKEN and ANTHROPIC_API_KEY from ${CREDENTIAL_FILE_PATH}`,
    );
  });

  it("fails a repo where git does not ignore the credential file", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: notIgnoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    expect(check(checks, "credentials ignored").status).toBe("failed");
    expect(check(checks, "credentials ignored").detail).toContain(CREDENTIAL_FILE_PATH);
    expect(check(checks, "docker daemon").status).toBe("ok");
  });

  it("names every plugin a pass mounts, and the version installed", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    expect(check(checks, "skill plugins").status).toBe("ok");
    expect(check(checks, "skill plugins").detail).toBe(
      "relay-skills 1.0.0, mattpocock-skills 1.1.0",
    );
  });

  it("still passes a plugin whose install Claude recorded no version for", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets({ CLAUDE_CONFIG_DIR: hostWithoutPluginVersions }),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    expect(check(checks, "skill plugins").status).toBe("ok");
    expect(check(checks, "skill plugins").detail).toBe(
      "relay-skills (no version), mattpocock-skills (no version)",
    );
  });

  it("names every missing plugin in one check, and how to install them", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets({ CLAUDE_CONFIG_DIR: hostWithNoPlugins }),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    const plugins = check(checks, "skill plugins");
    expect(plugins.status).toBe("failed");
    for (const key of SKILL_PLUGINS) expect(plugins.detail).toContain(key);
    expect(plugins.detail).toContain("/plugin install");
  });

  it("passes the tracker doc check on a repo that commits its tracker doc", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    expect(check(checks, "tracker doc").status).toBe("ok");
    expect(check(checks, "tracker doc").detail).toContain(TRACKER_DOC_PATH);
  });

  it("fails a repo that commits no tracker doc, without stopping the checks after it", async () => {
    const repoRoot = await repoWith(validConfig);
    await rm(join(repoRoot, TRACKER_DOC_PATH));

    const checks = await runDoctorChecks({
      repoRoot,
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    expect(check(checks, "tracker doc").status).toBe("failed");
    expect(check(checks, "tracker doc").detail).toContain(TRACKER_DOC_PATH);
    expect(check(checks, "docker daemon").status).toBe("ok");
  });

  it("asks git only what the checks need, in the repo it was pointed at", async () => {
    const repoRoot = await repoWith(validConfig);
    const calls: string[][] = [];
    const git = async (args: readonly string[]) => {
      calls.push([...args]);
      return await ignoringGit(args);
    };

    await runDoctorChecks({
      repoRoot,
      env: envWithSecrets(),
      git,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    expect(calls).toEqual([
      ["-C", repoRoot, "check-ignore", "-q", CREDENTIAL_FILE_PATH],
      ["-C", repoRoot, "symbolic-ref", "--short", "HEAD"],
      ["-C", repoRoot, "rev-parse", "--verify", "--quiet", "HEAD"],
    ]);
  });

  it("reports an invalid config and skips the checks that need it", async () => {
    const checks = await runDoctorChecks({
      // A config still carrying the deleted defaultBranch key, which is the
      // migration every repo on an older relay has to make.
      repoRoot: await repoWith(`export default { defaultBranch: "main" };`),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    expect(check(checks, "config").status).toBe("failed");
    expect(check(checks, "sandbox image").status).toBe("skipped");
    expect(check(checks, "docker daemon").status).toBe("skipped");
    // Both prerequisites read only the host's own state, so neither is ever
    // skipped for something earlier in the report.
    expect(check(checks, "skill plugins").status).toBe("ok");
    expect(check(checks, "tracker doc").status).toBe("ok");
  });

  it("reports an unbuildable image and skips the daemon check that needs it", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(`export default { landing: "pull-request" };`),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    expect(check(checks, "sandbox image").status).toBe("failed");
    expect(check(checks, "sandbox image").detail).toContain(DEFAULT_DOCKERFILE_PATH);
    expect(check(checks, "docker daemon").status).toBe("skipped");
  });

  it("reports a prebuilt ref that is on neither the host nor a registry", async () => {
    const docker = async () => {
      throw new Error("manifest unknown: manifest tagged 1 not found");
    };

    const checks = await runDoctorChecks({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    expect(check(checks, "sandbox image").status).toBe("failed");
    expect(check(checks, "sandbox image").detail).toContain("manifest unknown");
    expect(check(checks, "docker daemon").status).toBe("skipped");
  });

  it("reports a daemon the non-root sandbox user cannot reach", async () => {
    const docker = async (args: readonly string[]) => {
      if (args[0] === "image") return "sha256:abc";
      if (args.includes("stat")) return "0";
      throw new Error("permission denied while trying to connect to the Docker daemon socket");
    };

    const checks = await runDoctorChecks({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    expect(check(checks, "docker daemon").status).toBe("failed");
    expect(check(checks, "docker daemon").detail).toContain("permission denied");
  });

  it("builds the repo's dockerfile rather than assuming an image is there", async () => {
    const root = await repoWith(`export default { landing: "pull-request" };`);
    await mkdir(join(root, RELAY_DIR), { recursive: true });
    await writeFile(join(root, DEFAULT_DOCKERFILE_PATH), "FROM scratch\n", "utf8");
    const { docker, calls } = healthyDocker();

    const checks = await runDoctorChecks({
      repoRoot: root,
      env: envWithSecrets(),
      git: ignoringGit,
      docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    expect(check(checks, "sandbox image").status).toBe("ok");
    expect(calls[0]?.[0]).toBe("build");
  });

  it("names the host's gh version and the account it is logged in as", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    expect(check(checks, "gh installed").detail).toContain("2.62.0");
    expect(check(checks, "gh authenticated").detail).toContain("github.com");
  });

  it("reports a missing gh, skips the auth check, and still runs the docker checks", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: missingGh,
      probe: declaredProbe,
    });

    expect(check(checks, "gh installed").status).toBe("failed");
    expect(check(checks, "gh installed").detail).toContain("PATH");
    expect(check(checks, "gh authenticated").status).toBe("skipped");
    expect(check(checks, "docker daemon").status).toBe("ok");
  });

  it("reports a present-but-unauthenticated gh as a failure of its own", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: unauthenticatedGh,
      probe: declaredProbe,
    });

    expect(check(checks, "gh installed").status).toBe("ok");
    expect(check(checks, "gh authenticated").status).toBe("failed");
    expect(check(checks, "gh authenticated").detail).toContain("gh auth login");
    expect(check(checks, "docker daemon").status).toBe("ok");
  });

  it("reports the gh checks even when the config is invalid", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(`export default { landing: "pull-request" };`),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    expect(check(checks, "gh installed").status).toBe("ok");
    expect(check(checks, "gh authenticated").status).toBe("ok");
  });

  it("asks gh only what the checks need", async () => {
    const { gh, calls } = healthyGh();

    await runDoctorChecks({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh,
      probe: declaredProbe,
    });

    expect(calls).toEqual([
      ["--version"],
      ["auth", "status"],
      ["label", "list", "--json", "name", "--limit", "200"],
    ]);
  });

  it("fails on a missing pass label, which would kill a pass mid-flight", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh(ALL_LABELS.filter((name) => name !== "agent-in-progress")).gh,
      probe: declaredProbe,
    });

    expect(check(checks, "labels").status).toBe("failed");
    expect(check(checks, "labels").detail).toContain("agent-in-progress");
    expect(check(checks, "triage labels").status).toBe("ok");
  });

  it("only warns on a missing triage label, which a repo may rename", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh(PASS_LABELS.map(({ name }) => name)).gh,
      probe: declaredProbe,
    });

    expect(check(checks, "labels").status).toBe("ok");
    expect(check(checks, "triage labels").status).toBe("warning");
    expect(check(checks, "triage labels").detail).toContain("needs-triage");
  });

  it("counts a differently-cased label as present", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh(ALL_LABELS.map((name) => name.toUpperCase())).gh,
      probe: declaredProbe,
    });

    expect(check(checks, "labels").status).toBe("ok");
    expect(check(checks, "triage labels").status).toBe("ok");
  });

  it("reads the labels on a gh that prints its auth status on stderr", async () => {
    const gh = async (args: readonly string[]) => {
      if (args[0] === "--version") return "gh version 2.62.0 (2024-11-14)";
      if (args[0] === "auth") return "";
      return JSON.stringify(ALL_LABELS.map((name) => ({ name })));
    };

    const checks = await runDoctorChecks({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh,
      probe: declaredProbe,
    });

    expect(check(checks, "gh authenticated").status).toBe("ok");
    expect(check(checks, "labels").status).toBe("ok");
    expect(check(checks, "triage labels").status).toBe("ok");
  });

  it("skips both label checks when gh has no credential to read them with", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: unauthenticatedGh,
      probe: declaredProbe,
    });

    expect(check(checks, "labels").status).toBe("skipped");
    expect(check(checks, "triage labels").status).toBe("skipped");
  });

  it("skips both label checks when there is no gh at all", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: missingGh,
      probe: declaredProbe,
    });

    expect(check(checks, "labels").status).toBe("skipped");
    expect(check(checks, "triage labels").status).toBe("skipped");
  });

  it("reports a refused label read as a failure of both checks", async () => {
    const gh = async (args: readonly string[]) => {
      if (args[0] === "--version") return "gh version 2.62.0 (2024-11-14)";
      if (args[0] === "auth") return "✓ Logged in to github.com account octocat";
      throw new Error("HTTP 404: Not Found");
    };

    const checks = await runDoctorChecks({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh,
      probe: declaredProbe,
    });

    expect(check(checks, "labels").status).toBe("failed");
    expect(check(checks, "labels").detail).toContain("404");
    expect(check(checks, "triage labels").status).toBe("failed");
  });

  it("names the command a pass will verify with, and the doc it was declared in", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    expect(check(checks, "gate").status).toBe("ok");
    expect(check(checks, "gate").detail).toContain("npm run verify");
    expect(check(checks, "gate").detail).toContain("AGENTS.md, under Verifying");
  });

  it("warns on a gate relay had to infer, and says what it inferred it from", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: inferredProbe,
    });

    expect(check(checks, "gate").status).toBe("warning");
    expect(check(checks, "gate").detail).toContain("./mvnw verify");
    expect(check(checks, "gate").detail).toContain("pom.xml is a Maven build");
  });

  it("probes the repo doctor was pointed at", async () => {
    const repoRoot = await repoWith(validConfig);
    const { probe, calls } = fakeProbe({
      command: "make test",
      provenance: "declared",
      source: "README.md",
    });

    await runDoctorChecks({
      repoRoot,
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe,
    });

    expect(calls).toEqual([{ repoRoot }]);
  });

  it("reports a probe that failed without stopping the checks after it", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: async () => {
        throw new Error("the resolver ended without a gate block");
      },
    });

    expect(check(checks, "gate").status).toBe("failed");
    expect(check(checks, "gate").detail).toContain("without a gate block");
    expect(check(checks, "docker daemon").status).toBe("ok");
  });

  it("skips the gate check when the config it would open a sandbox from is invalid", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(`export default { landing: "pull-request" };`),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    expect(check(checks, "gate").status).toBe("skipped");
    expect(check(checks, "docker daemon").status).toBe("skipped");
  });

  it("skips the gate check when a secret the resolver's leg needs is missing", async () => {
    const env = envWithSecrets();
    delete env["CLAUDE_CODE_OAUTH_TOKEN"];

    const checks = await runDoctorChecks({
      repoRoot: await repoWith(validConfig),
      env,
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    expect(check(checks, "gate").status).toBe("skipped");
    expect(check(checks, "docker daemon").status).toBe("ok");
  });

  it("skips the gate check when there is no image to run it in", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(`export default { landing: "pull-request" };`),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    expect(check(checks, "sandbox image").status).toBe("failed");
    expect(check(checks, "gate").status).toBe("skipped");
    expect(check(checks, "docker daemon").status).toBe("skipped");
  });

  it("reports the landing and the branch a pass would land on", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(mergeConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    expect(check(checks, "landing").status).toBe("ok");
    expect(check(checks, "landing").detail).toContain("merge");
    expect(check(checks, "landing").detail).toContain("main");
  });

  it("reports the branch a pull-request pass would target", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    expect(check(checks, "landing").status).toBe("ok");
    expect(check(checks, "landing").detail).toContain("pull-request");
    expect(check(checks, "landing").detail).toContain("main");
  });

  it("fails the landing check on a detached HEAD, which names no branch", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(mergeConfig),
      env: envWithSecrets(),
      git: detachedGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    expect(check(checks, "landing").status).toBe("failed");
    expect(check(checks, "landing").detail).toContain("detached");
    expect(check(checks, "docker daemon").status).toBe("ok");
  });

  it("fails the landing check on a branch with no commits to be cut from", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(mergeConfig),
      env: envWithSecrets(),
      git: unbornGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    expect(check(checks, "landing").status).toBe("failed");
    expect(check(checks, "landing").detail).toContain("no commits yet");
  });

  it("skips the merge-only checks when the landing check found no branch", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(mergeConfig),
      env: envWithSecrets(),
      git: detachedGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    expect(check(checks, "base branch ruleset").status).toBe("skipped");
    expect(check(checks, "worktree clean").status).toBe("skipped");
  });

  it("passes the ruleset check on a base branch no ruleset guards", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(mergeConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    expect(check(checks, "base branch ruleset").status).toBe("ok");
    expect(check(checks, "base branch ruleset").detail).toContain("main");
  });

  it("fails a base branch whose ruleset requires a pull request, and names it", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(mergeConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: ghWithPullRequestRuleset().gh,
      probe: declaredProbe,
    });

    expect(check(checks, "base branch ruleset").status).toBe("failed");
    expect(check(checks, "base branch ruleset").detail).toContain("42");
    expect(check(checks, "base branch ruleset").detail).toContain("miwurster/relay");
    expect(check(checks, "docker daemon").status).toBe("ok");
  });

  it("asks the rulesets endpoint about the base branch, not a dry-run push", async () => {
    const { gh, calls } = healthyGh();

    await runDoctorChecks({
      repoRoot: await repoWith(mergeConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh,
      probe: declaredProbe,
    });

    expect(calls).toContainEqual(["api", "repos/{owner}/{repo}/rules/branches/main"]);
  });

  it("skips the ruleset check when no credential can ask GitHub about it", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(mergeConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: unauthenticatedGh,
      probe: declaredProbe,
    });

    expect(check(checks, "base branch ruleset").status).toBe("skipped");
    expect(check(checks, "worktree clean").status).toBe("ok");
  });

  it("only warns on a dirty worktree, which a pass reads at its own start", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(mergeConfig),
      env: envWithSecrets(),
      git: dirtyGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    expect(check(checks, "worktree clean").status).toBe("warning");
    expect(check(checks, "worktree clean").detail).toContain("uncommitted work");
  });

  it("skips both merge-only checks under pull-request landing", async () => {
    const { gh, calls } = healthyGh();

    const checks = await runDoctorChecks({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: dirtyGit,
      docker: healthyDocker().docker,
      gh,
      probe: declaredProbe,
    });

    expect(check(checks, "base branch ruleset").status).toBe("skipped");
    expect(check(checks, "worktree clean").status).toBe("skipped");
    expect(calls.flat()).not.toContain("api");
  });

  it("skips the landing check and the merge-only checks when the config is invalid", async () => {
    const checks = await runDoctorChecks({
      repoRoot: await repoWith(`export default { defaultBranch: "main" };`),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });

    expect(check(checks, "landing").status).toBe("skipped");
    expect(check(checks, "base branch ruleset").status).toBe("skipped");
    expect(check(checks, "worktree clean").status).toBe("skipped");
  });
});

describe("runDoctor", () => {
  it("succeeds when every check passes", async () => {
    const code = await runDoctor({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });
    expect(code).toBe(ExitCode.Success);
  });

  it("exits with the error code when any check fails", async () => {
    const env = envWithSecrets();
    delete env["GH_TOKEN"];

    const code = await runDoctor({
      repoRoot: await repoWith(validConfig),
      env,
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });
    expect(code).toBe(ExitCode.Error);
  });

  it("exits with the error code when gh is not authenticated", async () => {
    const code = await runDoctor({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: unauthenticatedGh,
      probe: declaredProbe,
    });
    expect(code).toBe(ExitCode.Error);
  });

  it("fails a repo where the credential file is not ignored", async () => {
    const code = await runDoctor({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: notIgnoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });
    expect(code).toBe(ExitCode.Error);
  });

  it("fails a repo whose label vocabulary a pass would die on", async () => {
    const code = await runDoctor({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh(ALL_LABELS.filter((name) => name !== "agent-blocked")).gh,
      probe: declaredProbe,
    });
    expect(code).toBe(ExitCode.Error);
  });

  it("succeeds on missing triage labels — a repo may speak its own vocabulary", async () => {
    const code = await runDoctor({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh(PASS_LABELS.map(({ name }) => name)).gh,
      probe: declaredProbe,
    });
    expect(code).toBe(ExitCode.Success);
  });

  it("prints one line per check", async () => {
    const { out, chunks } = fakeSink(false);

    await runDoctor({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
      out,
    });

    const printed = chunks.join("");
    for (const name of EVERY_CHECK) {
      expect(printed).toContain(`${name}: `);
    }
  });

  it("announces a check before it runs and erases that line with the verdict", async () => {
    const { out, chunks } = fakeSink(true);

    await runDoctor({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
      out,
    });

    expect(chunks.join("")).toContain(`${pendingLine("gate")}\r\u001b[K    ok   gate: `);
  });

  it("writes each verdict before the next check starts", async () => {
    const { out, chunks } = fakeSink(true);
    const written: string[] = [];
    const probe: GateProbe = async () => {
      written.push(chunks.join(""));
      return { command: "npm run verify", provenance: "declared", source: "AGENTS.md" };
    };

    await runDoctor({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe,
      out,
    });

    // The gate's own pending line is out, and every earlier verdict with it —
    // so the report was arriving while the slowest check was still running.
    expect(written[0]).toContain("sandbox image: ");
    expect(written[0]).toContain(pendingLine("gate"));
    expect(written[0]).not.toContain("gate: ");
  });

  it("announces nothing for a check that never runs", async () => {
    const { out, chunks } = fakeSink(true);

    await runDoctor({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
      out,
    });

    const printed = chunks.join("");
    expect(printed).toContain("base branch ruleset: this repo lands through a pull request");
    expect(printed).not.toContain(pendingLine("base branch ruleset"));
  });

  it("announces nothing at all where no line can be erased", async () => {
    const { out, chunks } = fakeSink(false);

    await runDoctor({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
      out,
    });

    const printed = chunks.join("");
    expect(printed).not.toContain("\u001b");
    expect(printed).not.toMatch(/^ {3}run {3}/m);
    expect(reportedNames(chunks)).toEqual(EVERY_CHECK);
  });

  it("succeeds on an inferred gate — a guess is imperfect, not broken", async () => {
    const code = await runDoctor({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: inferredProbe,
    });
    expect(code).toBe(ExitCode.Success);
  });

  it("succeeds on a dirty worktree — a pass reads it again at its own start", async () => {
    const code = await runDoctor({
      repoRoot: await repoWith(mergeConfig),
      env: envWithSecrets(),
      git: dirtyGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: declaredProbe,
    });
    expect(code).toBe(ExitCode.Success);
  });

  it("fails a merge repo whose base branch requires a pull request", async () => {
    const code = await runDoctor({
      repoRoot: await repoWith(mergeConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: ghWithPullRequestRuleset().gh,
      probe: declaredProbe,
    });
    expect(code).toBe(ExitCode.Error);
  });

  it("prints a warning distinctly from an ok and from a failure", async () => {
    const { out, chunks } = fakeSink(false);

    await runDoctor({
      repoRoot: await repoWith(validConfig),
      env: envWithSecrets(),
      git: ignoringGit,
      docker: healthyDocker().docker,
      gh: healthyGh().gh,
      probe: inferredProbe,
      out,
    });
    const gateLine = chunks.find((chunk) => chunk.includes("gate: "));

    expect(gateLine).toMatch(/warn/i);
    expect(gateLine).not.toMatch(/\bok\b|FAILED/);
  });
});
