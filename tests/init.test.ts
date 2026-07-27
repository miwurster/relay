import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CONFIG_FILE_NAME, loadConfig } from "../src/config.js";
import { ConfigError } from "../src/errors.js";
import { ExitCode } from "../src/exit-codes.js";
import { runInit, runInitChecks } from "../src/init.js";

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

    const verdicts = await runInitChecks({ repoRoot, git: githubClone().git });

    const recipe = verdicts.find((v) => v.file === "docker/relay.Dockerfile");
    expect(recipe?.detail).toBe("wrote the java sandbox recipe");
  });

  it("reads defaultBranch from the clone's origin/HEAD", async () => {
    const repoRoot = await tempRepo();

    await runInitChecks({ repoRoot, git: githubClone("trunk").git });

    const config = await loadConfig(repoRoot);
    expect(config.defaultBranch).toBe("trunk");
  });

  it("writes only defaultBranch, echoing no other default", async () => {
    const repoRoot = await tempRepo();

    const verdicts = await runInitChecks({ repoRoot, git: githubClone().git });

    expect(verdicts[0]?.outcome).toBe("written");
    const written = await readFile(join(repoRoot, CONFIG_FILE_NAME), "utf8");
    expect(written).not.toContain("greenGate");
    expect(written).not.toContain("branchPrefix");
    expect(written).not.toContain("roleTimeoutMs");
    expect(written).not.toContain("models");
    const config = await loadConfig(repoRoot);
    expect(config.defaultBranch).toBe("main");
  });

  it("keeps an existing config rather than overwriting it, and reports it kept", async () => {
    const repoRoot = await tempRepo();
    await writeFile(
      join(repoRoot, CONFIG_FILE_NAME),
      `export default { defaultBranch: "main" };`,
      "utf8",
    );

    const verdicts = await runInitChecks({ repoRoot, git: githubClone().git });

    expect(verdicts[0]).toEqual({
      file: CONFIG_FILE_NAME,
      outcome: "kept",
      detail: "already exists",
    });
    const config = await loadConfig(repoRoot);
    expect(config.defaultBranch).toBe("main");
  });

  it("writes the java sandbox recipe for a pom.xml repo", async () => {
    const repoRoot = await tempRepo();
    await writeFile(join(repoRoot, "pom.xml"), "<project/>", "utf8");

    const verdicts = await runInitChecks({ repoRoot, git: githubClone().git });

    const recipe = verdicts.find((v) => v.file === "docker/relay.Dockerfile");
    expect(recipe).toEqual({
      file: "docker/relay.Dockerfile",
      outcome: "written",
      detail: "wrote the java sandbox recipe",
    });
    const written = await readFile(join(repoRoot, "docker/relay.Dockerfile"), "utf8");
    expect(written).toContain("ARG AGENT_UID");
    expect(written).toContain("FROM maven:3-eclipse-temurin-21");
  });

  it("writes the python sandbox recipe for a pyproject.toml repo", async () => {
    const repoRoot = await tempRepo();
    await writeFile(join(repoRoot, "pyproject.toml"), '[project]\nname = "x"\n', "utf8");

    await runInitChecks({ repoRoot, git: githubClone().git });

    const written = await readFile(join(repoRoot, "docker/relay.Dockerfile"), "utf8");
    expect(written).toContain("FROM ghcr.io/astral-sh/uv:python3.12-trixie");
  });

  it("writes the node sandbox recipe for a package.json repo", async () => {
    const repoRoot = await tempRepo();
    await writeFile(
      join(repoRoot, "package.json"),
      JSON.stringify({ scripts: { test: "vitest run" } }),
      "utf8",
    );

    await runInitChecks({ repoRoot, git: githubClone().git });

    const written = await readFile(join(repoRoot, "docker/relay.Dockerfile"), "utf8");
    expect(written).toContain("FROM node:lts");
  });

  it("writes no recipe for a repo matching none of the three, and says where to write one", async () => {
    const repoRoot = await tempRepo();

    const verdicts = await runInitChecks({ repoRoot, git: githubClone().git });

    const recipe = verdicts.find((v) => v.file === "docker/relay.Dockerfile");
    expect(recipe?.outcome).toBe("skipped");
    expect(recipe?.detail).toContain("docker/relay.Dockerfile");
    expect(existsSync(join(repoRoot, "docker/relay.Dockerfile"))).toBe(false);
  });

  it("keeps an existing sandbox recipe rather than overwriting it, and reports it kept", async () => {
    const repoRoot = await tempRepo();
    await writeFile(join(repoRoot, "pom.xml"), "<project/>", "utf8");
    await writeFile(join(repoRoot, CONFIG_FILE_NAME), "export default {};", "utf8");
    await mkdir(join(repoRoot, "docker"), { recursive: true });
    await writeFile(join(repoRoot, "docker/relay.Dockerfile"), "FROM scratch\n", "utf8");

    const verdicts = await runInitChecks({ repoRoot, git: githubClone().git });

    const recipe = verdicts.find((v) => v.file === "docker/relay.Dockerfile");
    expect(recipe).toEqual({
      file: "docker/relay.Dockerfile",
      outcome: "kept",
      detail: "already exists",
    });
    const untouched = await readFile(join(repoRoot, "docker/relay.Dockerfile"), "utf8");
    expect(untouched).toBe("FROM scratch\n");
  });

  it("writes the sandbox recipe even when the config already exists", async () => {
    const repoRoot = await tempRepo();
    await writeFile(join(repoRoot, "pom.xml"), "<project/>", "utf8");
    await writeFile(
      join(repoRoot, CONFIG_FILE_NAME),
      `export default { defaultBranch: "main" };`,
      "utf8",
    );

    const verdicts = await runInitChecks({ repoRoot, git: githubClone().git });

    expect(verdicts.find((v) => v.file === CONFIG_FILE_NAME)?.outcome).toBe("kept");
    expect(verdicts.find((v) => v.file === "docker/relay.Dockerfile")?.outcome).toBe("written");
  });

  it("writes a .gitignore ignoring the worktree directory when the repo has none", async () => {
    const repoRoot = await tempRepo();

    const verdicts = await runInitChecks({ repoRoot, git: githubClone().git });

    expect(verdicts.find((v) => v.file === ".gitignore")?.outcome).toBe("written");
    const written = await readFile(join(repoRoot, ".gitignore"), "utf8");
    expect(written).toBe("# A relay pass's git worktree.\n.sandcastle/\n");
  });

  it("appends to an existing .gitignore rather than replacing it", async () => {
    const repoRoot = await tempRepo();
    await writeFile(join(repoRoot, ".gitignore"), "node_modules/\ndist\n", "utf8");

    await runInitChecks({ repoRoot, git: githubClone().git });

    const written = await readFile(join(repoRoot, ".gitignore"), "utf8");
    expect(written).toBe("node_modules/\ndist\n\n# A relay pass's git worktree.\n.sandcastle/\n");
  });

  it("leaves a .gitignore that already ignores the worktree directory alone", async () => {
    const repoRoot = await tempRepo();
    await writeFile(join(repoRoot, ".gitignore"), "dist\n/.sandcastle\n", "utf8");

    const verdicts = await runInitChecks({ repoRoot, git: githubClone().git });

    expect(verdicts.find((v) => v.file === ".gitignore")?.outcome).toBe("kept");
    const untouched = await readFile(join(repoRoot, ".gitignore"), "utf8");
    expect(untouched).toBe("dist\n/.sandcastle\n");
  });

  it("stages and commits nothing", async () => {
    const repoRoot = await tempRepo();
    const { git, calls } = githubClone();

    await runInitChecks({ repoRoot, git });

    expect(calls.some((call) => call.includes("add") || call.includes("commit"))).toBe(false);
  });
});

describe("runInit", () => {
  it("exits 0 on a repo it successfully bootstraps", async () => {
    const repoRoot = await tempRepo();
    const code = await runInit({ repoRoot, git: githubClone().git });
    expect(code).toBe(ExitCode.Success);
  });

  it("prints what remains manual and names relay doctor as the next step", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const repoRoot = await tempRepo();
      await runInit({ repoRoot, git: githubClone().git });
      const printed = log.mock.calls.map((call) => String(call[0])).join("\n");
      expect(printed).toMatch(/AGENTS\.md/);
      expect(printed).toMatch(/label/i);
      expect(printed).toMatch(/GH_TOKEN/);
      expect(printed).toMatch(/relay doctor/);
    } finally {
      log.mockRestore();
    }
  });
});
