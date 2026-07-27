import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  CONFIG_FILE_PATH,
  DEFAULT_DOCKERFILE_PATH,
  loadConfig,
  RELAY_DIR,
} from "../../src/config.js";
import { ConfigError } from "../../src/errors.js";
import { ExitCode } from "../../src/exit-codes.js";
import { runInit, runInitChecks, type InitVerdict } from "../../src/init/init.js";
import { GITIGNORE_FILE_NAME } from "../../src/host/worktree-dir.js";

async function tempRepo(): Promise<string> {
  return mkdtemp(join(tmpdir(), "relay-init-"));
}

/** A `GitRunner` fake for a GitHub clone whose origin/HEAD names `branch`. */
function githubClone(branch = "main") {
  const calls: string[][] = [];
  const git = async (args: readonly string[]) => {
    calls.push([...args]);
    if (args.includes("--is-inside-work-tree")) return "true";
    if (args.includes("get-url")) return "https://github.com/owner/repo.git";
    if (args.includes("symbolic-ref")) return `refs/remotes/origin/${branch}`;
    throw new Error(`unexpected git ${args.join(" ")}`);
  };
  return { git, calls };
}

/** A `GitRunner` fake for a repo whose `origin` is not GitHub. */
function nonGitHubClone() {
  const git = async (args: readonly string[]) => {
    if (args.includes("--is-inside-work-tree")) return "true";
    if (args.includes("get-url")) return "https://gitlab.com/owner/repo.git";
    throw new Error(`unexpected git ${args.join(" ")}`);
  };
  return { git };
}

/** A `GitRunner` fake for a directory that is not a git repo at all. */
function notARepo() {
  const git = async (args: readonly string[]) => {
    if (args.includes("--is-inside-work-tree")) {
      throw new Error("fatal: not a git repository");
    }
    throw new Error(`unexpected git ${args.join(" ")}`);
  };
  return { git };
}

/** A `gh` fake for an authenticated host whose repo holds `existing` labels. */
function fakeGh(existing: readonly string[] = []) {
  const calls: string[][] = [];
  const gh = async (args: readonly string[]) => {
    calls.push([...args]);
    if (args[0] === "--version") return "gh version 2.62.0 (2024-11-14)";
    if (args[0] === "auth") return "✓ Logged in to github.com account octocat";
    if (args[0] === "label" && args[1] === "list") {
      return JSON.stringify(existing.map((name) => ({ name })));
    }
    if (args[0] === "label" && args[1] === "create") return "";
    throw new Error(`unexpected gh ${args.join(" ")}`);
  };
  return { gh, calls };
}

/** A host with no `gh` at all: every invocation fails the way `execFile` does. */
const missingGh = async () => {
  throw new Error("spawn gh ENOENT");
};

/** A `gh` that is on the PATH but has no credential GitHub accepts. */
const unauthenticatedGh = async (args: readonly string[]) => {
  if (args[0] === "--version") return "gh version 2.62.0 (2024-11-14)";
  throw new Error("You are not logged into any GitHub hosts. Run gh auth login to authenticate.");
};

/** A `gh` GitHub answers and refuses — a token without write access. */
const refusingGh = async (args: readonly string[]) => {
  if (args[0] === "--version") return "gh version 2.62.0 (2024-11-14)";
  if (args[0] === "auth") return "✓ Logged in to github.com account octocat";
  if (args[0] === "label" && args[1] === "list") return "[]";
  throw new Error("HTTP 403: Resource not accessible by personal access token");
};

/** Every label verdict, which follows the three file verdicts. */
function labelVerdicts(verdicts: readonly InitVerdict[]): InitVerdict[] {
  const files = new Set([CONFIG_FILE_PATH, DEFAULT_DOCKERFILE_PATH, GITIGNORE_FILE_NAME]);
  return verdicts.filter((verdict) => !files.has(verdict.subject));
}

function verdict(verdicts: readonly InitVerdict[], subject: string): InitVerdict {
  const found = verdicts.find((candidate) => candidate.subject === subject);
  if (!found) throw new Error(`No ${subject} verdict in ${verdicts.length} verdicts`);
  return found;
}

const ALL_LABELS = [
  "ready-for-agent",
  "agent-in-progress",
  "agent-in-review",
  "agent-blocked",
  "needs-triage",
  "needs-info",
  "ready-for-human",
  "wontfix",
];

describe("runInitChecks", () => {
  it("refuses when the directory is not a git repo, writing nothing", async () => {
    const repoRoot = await tempRepo();
    await expect(runInitChecks({ repoRoot, git: notARepo().git })).rejects.toThrow(ConfigError);
    expect(await readdir(repoRoot)).toEqual([]);
  });

  it("refuses when origin is not GitHub, writing nothing", async () => {
    const repoRoot = await tempRepo();
    await expect(runInitChecks({ repoRoot, git: nonGitHubClone().git })).rejects.toThrow(
      ConfigError,
    );
    expect(await readdir(repoRoot)).toEqual([]);
  });

  it("prefers pom.xml over a package.json in the same repo", async () => {
    const repoRoot = await tempRepo();
    await writeFile(join(repoRoot, "pom.xml"), "<project/>", "utf8");
    await writeFile(
      join(repoRoot, "package.json"),
      JSON.stringify({ scripts: { test: "eslint ." } }),
      "utf8",
    );

    const verdicts = await runInitChecks({ repoRoot, git: githubClone().git, gh: fakeGh().gh });

    const recipe = verdicts.find((v) => v.subject === DEFAULT_DOCKERFILE_PATH);
    expect(recipe?.detail).toBe("wrote the java sandbox recipe");
  });

  it("reads defaultBranch from the clone's origin/HEAD", async () => {
    const repoRoot = await tempRepo();

    await runInitChecks({ repoRoot, git: githubClone("trunk").git, gh: fakeGh().gh });

    const config = await loadConfig(repoRoot);
    expect(config.defaultBranch).toBe("trunk");
  });

  it("writes only defaultBranch, echoing no other default", async () => {
    const repoRoot = await tempRepo();

    const verdicts = await runInitChecks({ repoRoot, git: githubClone().git, gh: fakeGh().gh });

    expect(verdicts[0]?.outcome).toBe("written");
    const written = await readFile(join(repoRoot, CONFIG_FILE_PATH), "utf8");
    expect(written).not.toContain("greenGate");
    expect(written).not.toContain("branchPrefix");
    expect(written).not.toContain("roleTimeoutMs");
    expect(written).not.toContain("models");
    const config = await loadConfig(repoRoot);
    expect(config.defaultBranch).toBe("main");
  });

  it("keeps an existing config rather than overwriting it, and reports it kept", async () => {
    const repoRoot = await tempRepo();
    await mkdir(join(repoRoot, RELAY_DIR), { recursive: true });
    await writeFile(
      join(repoRoot, CONFIG_FILE_PATH),
      `export default { defaultBranch: "main" };`,
      "utf8",
    );

    const verdicts = await runInitChecks({ repoRoot, git: githubClone().git, gh: fakeGh().gh });

    expect(verdicts[0]).toEqual({
      subject: CONFIG_FILE_PATH,
      outcome: "kept",
      detail: "already exists",
    });
    const config = await loadConfig(repoRoot);
    expect(config.defaultBranch).toBe("main");
  });

  it("writes the java sandbox recipe for a pom.xml repo", async () => {
    const repoRoot = await tempRepo();
    await writeFile(join(repoRoot, "pom.xml"), "<project/>", "utf8");

    const verdicts = await runInitChecks({ repoRoot, git: githubClone().git, gh: fakeGh().gh });

    const recipe = verdicts.find((v) => v.subject === DEFAULT_DOCKERFILE_PATH);
    expect(recipe).toEqual({
      subject: DEFAULT_DOCKERFILE_PATH,
      outcome: "written",
      detail: "wrote the java sandbox recipe",
    });
    const written = await readFile(join(repoRoot, DEFAULT_DOCKERFILE_PATH), "utf8");
    expect(written).toContain("ARG AGENT_UID");
    expect(written).toContain("FROM maven:3-eclipse-temurin-21");
  });

  it("writes the python sandbox recipe for a pyproject.toml repo", async () => {
    const repoRoot = await tempRepo();
    await writeFile(join(repoRoot, "pyproject.toml"), '[project]\nname = "x"\n', "utf8");

    await runInitChecks({ repoRoot, git: githubClone().git, gh: fakeGh().gh });

    const written = await readFile(join(repoRoot, DEFAULT_DOCKERFILE_PATH), "utf8");
    expect(written).toContain("FROM ghcr.io/astral-sh/uv:python3.12-trixie");
  });

  it("writes the node sandbox recipe for a package.json repo", async () => {
    const repoRoot = await tempRepo();
    await writeFile(
      join(repoRoot, "package.json"),
      JSON.stringify({ scripts: { test: "vitest run" } }),
      "utf8",
    );

    await runInitChecks({ repoRoot, git: githubClone().git, gh: fakeGh().gh });

    const written = await readFile(join(repoRoot, DEFAULT_DOCKERFILE_PATH), "utf8");
    expect(written).toContain("FROM node:lts");
  });

  it("writes no recipe for a repo matching none of the three, and says where to write one", async () => {
    const repoRoot = await tempRepo();

    const verdicts = await runInitChecks({ repoRoot, git: githubClone().git, gh: fakeGh().gh });

    const recipe = verdicts.find((v) => v.subject === DEFAULT_DOCKERFILE_PATH);
    expect(recipe?.outcome).toBe("skipped");
    expect(recipe?.detail).toContain(DEFAULT_DOCKERFILE_PATH);
    expect(existsSync(join(repoRoot, DEFAULT_DOCKERFILE_PATH))).toBe(false);
  });

  it("keeps an existing sandbox recipe rather than overwriting it, and reports it kept", async () => {
    const repoRoot = await tempRepo();
    await writeFile(join(repoRoot, "pom.xml"), "<project/>", "utf8");
    await mkdir(join(repoRoot, RELAY_DIR), { recursive: true });
    await writeFile(join(repoRoot, CONFIG_FILE_PATH), "export default {};", "utf8");
    await writeFile(join(repoRoot, DEFAULT_DOCKERFILE_PATH), "FROM scratch\n", "utf8");

    const verdicts = await runInitChecks({ repoRoot, git: githubClone().git, gh: fakeGh().gh });

    const recipe = verdicts.find((v) => v.subject === DEFAULT_DOCKERFILE_PATH);
    expect(recipe).toEqual({
      subject: DEFAULT_DOCKERFILE_PATH,
      outcome: "kept",
      detail: "already exists",
    });
    const untouched = await readFile(join(repoRoot, DEFAULT_DOCKERFILE_PATH), "utf8");
    expect(untouched).toBe("FROM scratch\n");
  });

  it("writes the sandbox recipe even when the config already exists", async () => {
    const repoRoot = await tempRepo();
    await writeFile(join(repoRoot, "pom.xml"), "<project/>", "utf8");
    await mkdir(join(repoRoot, RELAY_DIR), { recursive: true });
    await writeFile(
      join(repoRoot, CONFIG_FILE_PATH),
      `export default { defaultBranch: "main" };`,
      "utf8",
    );

    const verdicts = await runInitChecks({ repoRoot, git: githubClone().git, gh: fakeGh().gh });

    expect(verdicts.find((v) => v.subject === CONFIG_FILE_PATH)?.outcome).toBe("kept");
    expect(verdicts.find((v) => v.subject === DEFAULT_DOCKERFILE_PATH)?.outcome).toBe("written");
  });

  it("writes a .gitignore ignoring the worktree directory when the repo has none", async () => {
    const repoRoot = await tempRepo();

    const verdicts = await runInitChecks({ repoRoot, git: githubClone().git, gh: fakeGh().gh });

    expect(verdicts.find((v) => v.subject === ".gitignore")?.outcome).toBe("written");
    const written = await readFile(join(repoRoot, ".gitignore"), "utf8");
    expect(written).toBe("# A relay pass's git worktree.\n.sandcastle/\n");
  });

  it("appends to an existing .gitignore rather than replacing it", async () => {
    const repoRoot = await tempRepo();
    await writeFile(join(repoRoot, ".gitignore"), "node_modules/\ndist\n", "utf8");

    await runInitChecks({ repoRoot, git: githubClone().git, gh: fakeGh().gh });

    const written = await readFile(join(repoRoot, ".gitignore"), "utf8");
    expect(written).toBe("node_modules/\ndist\n\n# A relay pass's git worktree.\n.sandcastle/\n");
  });

  it("leaves a .gitignore that already ignores the worktree directory alone", async () => {
    const repoRoot = await tempRepo();
    await writeFile(join(repoRoot, ".gitignore"), "dist\n/.sandcastle\n", "utf8");

    const verdicts = await runInitChecks({ repoRoot, git: githubClone().git, gh: fakeGh().gh });

    expect(verdicts.find((v) => v.subject === ".gitignore")?.outcome).toBe("kept");
    const untouched = await readFile(join(repoRoot, ".gitignore"), "utf8");
    expect(untouched).toBe("dist\n/.sandcastle\n");
  });

  it("creates every label the repo is missing, colour and description included", async () => {
    const repoRoot = await tempRepo();
    const { gh, calls } = fakeGh();

    const verdicts = await runInitChecks({ repoRoot, git: githubClone().git, gh });

    expect(labelVerdicts(verdicts).map((v) => v.subject)).toEqual(ALL_LABELS);
    expect(labelVerdicts(verdicts).every((v) => v.outcome === "written")).toBe(true);
    expect(calls).toContainEqual([
      "label",
      "create",
      "ready-for-agent",
      "--color",
      "0E8A16",
      "--description",
      "Eligible for a relay pass",
    ]);
  });

  it("keeps a label the repo already has rather than restating its colour", async () => {
    const repoRoot = await tempRepo();
    const { gh, calls } = fakeGh(["ready-for-agent"]);

    const verdicts = await runInitChecks({ repoRoot, git: githubClone().git, gh });

    expect(verdict(verdicts, "ready-for-agent").outcome).toBe("kept");
    expect(calls.some((call) => call.includes("ready-for-agent"))).toBe(false);
    expect(verdict(verdicts, "agent-blocked").outcome).toBe("written");
  });

  it("counts a differently-cased label as already there", async () => {
    const repoRoot = await tempRepo();
    const { gh, calls } = fakeGh(["Ready-For-Agent", "WontFix"]);

    const verdicts = await runInitChecks({ repoRoot, git: githubClone().git, gh });

    expect(verdict(verdicts, "ready-for-agent").outcome).toBe("kept");
    expect(verdict(verdicts, "wontfix").outcome).toBe("kept");
    expect(calls.filter((call) => call[1] === "create")).toHaveLength(6);
  });

  it("never forces an existing label, so hand-tuned colours survive", async () => {
    const repoRoot = await tempRepo();
    const { gh, calls } = fakeGh();

    await runInitChecks({ repoRoot, git: githubClone().git, gh });

    expect(calls.some((call) => call.includes("--force"))).toBe(false);
  });

  it("skips the labels when there is no gh to create them with, and still writes the files", async () => {
    const repoRoot = await tempRepo();

    const verdicts = await runInitChecks({ repoRoot, git: githubClone().git, gh: missingGh });

    expect(labelVerdicts(verdicts).every((v) => v.outcome === "skipped")).toBe(true);
    expect(verdict(verdicts, "ready-for-agent").detail).toContain("no `gh`");
    expect(verdict(verdicts, CONFIG_FILE_PATH).outcome).toBe("written");
  });

  it("skips the labels when gh has no credential GitHub accepts", async () => {
    const repoRoot = await tempRepo();

    const verdicts = await runInitChecks({
      repoRoot,
      git: githubClone().git,
      gh: unauthenticatedGh,
    });

    expect(labelVerdicts(verdicts).every((v) => v.outcome === "skipped")).toBe(true);
    expect(verdict(verdicts, "ready-for-agent").detail).toContain("credential");
  });

  it("reports a refused label as failed, carrying GitHub's reason", async () => {
    const repoRoot = await tempRepo();

    const verdicts = await runInitChecks({ repoRoot, git: githubClone().git, gh: refusingGh });

    expect(labelVerdicts(verdicts).every((v) => v.outcome === "failed")).toBe(true);
    expect(verdict(verdicts, "ready-for-agent").detail).toContain("403");
  });

  it("stages and commits nothing", async () => {
    const repoRoot = await tempRepo();
    const { git, calls } = githubClone();

    await runInitChecks({ repoRoot, git, gh: fakeGh().gh });

    expect(calls.some((call) => call.includes("add") || call.includes("commit"))).toBe(false);
  });
});

describe("runInit", () => {
  it("exits 0 on a repo it successfully bootstraps", async () => {
    const repoRoot = await tempRepo();
    const code = await runInit({ repoRoot, git: githubClone().git, gh: fakeGh().gh });
    expect(code).toBe(ExitCode.Success);
  });

  it("prints what remains manual and names relay doctor as the next step", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const repoRoot = await tempRepo();
      await runInit({ repoRoot, git: githubClone().git, gh: fakeGh().gh });
      const printed = log.mock.calls.map((call) => String(call[0])).join("\n");
      expect(printed).toMatch(/AGENTS\.md/);
      expect(printed).toMatch(/GH_TOKEN/);
      expect(printed).toMatch(/relay doctor/);
      // The labels are no longer an operator's job, so they are reported as
      // done rather than listed as remaining.
      expect(printed).toMatch(/ready-for-agent/);
      expect(printed.split("Still yours to do")[1]).not.toMatch(/label/i);
    } finally {
      log.mockRestore();
    }
  });

  it("still exits 0 when a label could not be created — the files are written", async () => {
    const repoRoot = await tempRepo();
    const code = await runInit({ repoRoot, git: githubClone().git, gh: refusingGh });
    expect(code).toBe(ExitCode.Success);
  });
});
