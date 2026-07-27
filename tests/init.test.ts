import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CONFIG_FILE_NAME, UNSET_GREEN_GATE, loadConfig } from "../src/config.js";
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

  it("detects a Maven gate from pom.xml", async () => {
    const repoRoot = await tempRepo();
    await writeFile(join(repoRoot, "pom.xml"), "<project/>", "utf8");

    const verdicts = await runInitChecks({ repoRoot, git: githubClone().git });

    expect(verdicts[0]?.outcome).toBe("written");
    expect(verdicts[0]?.detail).toContain("./mvnw verify");
    const config = await loadConfig(repoRoot);
    expect(config.greenGate).toBe("./mvnw verify");
    expect(config.defaultBranch).toBe("main");
  });

  it("detects a uv gate from pyproject.toml", async () => {
    const repoRoot = await tempRepo();
    await writeFile(join(repoRoot, "pyproject.toml"), '[project]\nname = "x"\n', "utf8");

    await runInitChecks({ repoRoot, git: githubClone().git });

    const config = await loadConfig(repoRoot);
    expect(config.greenGate).toBe("uv run pytest");
  });

  it("prefers verify, then ci, then test from package.json scripts", async () => {
    const repoRoot = await tempRepo();
    await writeFile(
      join(repoRoot, "package.json"),
      JSON.stringify({
        scripts: { test: "vitest run", ci: "npm run lint", verify: "npm run all" },
      }),
      "utf8",
    );

    await runInitChecks({ repoRoot, git: githubClone().git });

    const config = await loadConfig(repoRoot);
    expect(config.greenGate).toBe("npm run verify");
  });

  it("falls back to ci when verify is absent", async () => {
    const repoRoot = await tempRepo();
    await writeFile(
      join(repoRoot, "package.json"),
      JSON.stringify({ scripts: { test: "vitest run", ci: "npm run lint" } }),
      "utf8",
    );

    await runInitChecks({ repoRoot, git: githubClone().git });

    const config = await loadConfig(repoRoot);
    expect(config.greenGate).toBe("npm run ci");
  });

  it("falls back to test when neither verify nor ci is present", async () => {
    const repoRoot = await tempRepo();
    await writeFile(
      join(repoRoot, "package.json"),
      JSON.stringify({ scripts: { test: "vitest run" } }),
      "utf8",
    );

    await runInitChecks({ repoRoot, git: githubClone().git });

    const config = await loadConfig(repoRoot);
    expect(config.greenGate).toBe("npm run test");
  });

  it("prefers pom.xml over a package.json in the same repo", async () => {
    const repoRoot = await tempRepo();
    await writeFile(join(repoRoot, "pom.xml"), "<project/>", "utf8");
    await writeFile(
      join(repoRoot, "package.json"),
      JSON.stringify({ scripts: { test: "eslint ." } }),
      "utf8",
    );

    await runInitChecks({ repoRoot, git: githubClone().git });

    const config = await loadConfig(repoRoot);
    expect(config.greenGate).toBe("./mvnw verify");
  });

  it("writes the ticket-01 sentinel for a repo matching none of the three", async () => {
    const repoRoot = await tempRepo();

    const verdicts = await runInitChecks({ repoRoot, git: githubClone().git });

    expect(verdicts[0]?.outcome).toBe("written");
    await expect(loadConfig(repoRoot)).rejects.toThrow(/relay init/i);
    const written = await readFile(join(repoRoot, CONFIG_FILE_NAME), "utf8");
    expect(written).toContain(UNSET_GREEN_GATE);
  });

  it("writes the sentinel for a package.json with none of the preferred scripts", async () => {
    const repoRoot = await tempRepo();
    await writeFile(
      join(repoRoot, "package.json"),
      JSON.stringify({ scripts: { build: "tsc" } }),
      "utf8",
    );

    await runInitChecks({ repoRoot, git: githubClone().git });

    const written = await readFile(join(repoRoot, CONFIG_FILE_NAME), "utf8");
    expect(written).toContain(UNSET_GREEN_GATE);
  });

  it("reads defaultBranch from the clone's origin/HEAD", async () => {
    const repoRoot = await tempRepo();
    await writeFile(
      join(repoRoot, "package.json"),
      JSON.stringify({ scripts: { test: "vitest run" } }),
      "utf8",
    );

    await runInitChecks({ repoRoot, git: githubClone("trunk").git });

    const config = await loadConfig(repoRoot);
    expect(config.defaultBranch).toBe("trunk");
  });

  it("writes only greenGate and defaultBranch, echoing no other default", async () => {
    const repoRoot = await tempRepo();

    await runInitChecks({ repoRoot, git: githubClone().git });

    const written = await readFile(join(repoRoot, CONFIG_FILE_NAME), "utf8");
    expect(written).not.toContain("branchPrefix");
    expect(written).not.toContain("roleTimeoutMs");
    expect(written).not.toContain("models");
  });

  it("marks a detected gate with a comment asking for confirmation", async () => {
    const repoRoot = await tempRepo();
    await writeFile(join(repoRoot, "pom.xml"), "<project/>", "utf8");

    await runInitChecks({ repoRoot, git: githubClone().git });

    const written = await readFile(join(repoRoot, CONFIG_FILE_NAME), "utf8");
    expect(written).toMatch(/confirm/i);
  });

  it("keeps an existing config rather than overwriting it, and reports it kept", async () => {
    const repoRoot = await tempRepo();
    await writeFile(
      join(repoRoot, CONFIG_FILE_NAME),
      `export default { greenGate: "make test", defaultBranch: "main" };`,
      "utf8",
    );

    const verdicts = await runInitChecks({ repoRoot, git: githubClone().git });

    expect(verdicts).toEqual([
      { file: CONFIG_FILE_NAME, outcome: "kept", detail: "already exists" },
    ]);
    const config = await loadConfig(repoRoot);
    expect(config.greenGate).toBe("make test");
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
      expect(printed).toMatch(/confirm/i);
      expect(printed).toMatch(/label/i);
      expect(printed).toMatch(/GH_TOKEN/);
      expect(printed).toMatch(/relay doctor/);
    } finally {
      log.mockRestore();
    }
  });
});
