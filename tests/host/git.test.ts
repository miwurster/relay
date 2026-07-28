import { describe, expect, it } from "vitest";
import { currentBranch, isGitHubRemote, isGitRepo, originUrl } from "../../src/host/git.js";
import { ConfigError } from "../../src/errors.js";

/** A fake `GitRunner` answering canned responses keyed by the joined args. */
function fakeGit(answers: Record<string, string | Error>) {
  const calls: string[][] = [];
  const git = async (args: readonly string[]) => {
    calls.push([...args]);
    const key = args.join(" ");
    const answer = answers[key];
    if (answer === undefined) throw new Error(`unexpected git ${key}`);
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { git, calls };
}

describe("isGitHubRemote", () => {
  it("accepts the https form", () => {
    expect(isGitHubRemote("https://github.com/owner/repo.git")).toBe(true);
  });

  it("accepts the ssh form", () => {
    expect(isGitHubRemote("git@github.com:owner/repo.git")).toBe(true);
  });

  it("rejects a non-GitHub remote", () => {
    expect(isGitHubRemote("https://gitlab.com/owner/repo.git")).toBe(false);
  });
});

describe("isGitRepo", () => {
  it("is true when git confirms a working tree", async () => {
    const { git } = fakeGit({ "-C /repo rev-parse --is-inside-work-tree": "true" });
    expect(await isGitRepo({ repoRoot: "/repo", git })).toBe(true);
  });

  it("is false when git refuses", async () => {
    const { git } = fakeGit({
      "-C /repo rev-parse --is-inside-work-tree": new Error("not a git repository"),
    });
    expect(await isGitRepo({ repoRoot: "/repo", git })).toBe(false);
  });
});

describe("originUrl", () => {
  it("returns the remote url", async () => {
    const { git } = fakeGit({
      "-C /repo remote get-url origin": "https://github.com/owner/repo.git",
    });
    expect(await originUrl({ repoRoot: "/repo", git })).toBe("https://github.com/owner/repo.git");
  });

  it("is undefined when there is no origin", async () => {
    const { git } = fakeGit({
      "-C /repo remote get-url origin": new Error("No such remote 'origin'"),
    });
    expect(await originUrl({ repoRoot: "/repo", git })).toBeUndefined();
  });
});

describe("currentBranch", () => {
  const HEAD_BRANCH = "-C /repo symbolic-ref --short HEAD";
  const HEAD_COMMIT = "-C /repo rev-parse --verify --quiet HEAD";

  it("reads the branch the host has checked out", async () => {
    const { git } = fakeGit({ [HEAD_BRANCH]: "spike/foo", [HEAD_COMMIT]: "a".repeat(40) });
    expect(await currentBranch({ repoRoot: "/repo", git })).toBe("spike/foo");
  });

  it("refuses a HEAD that names no branch, with the config-class error that exits 2", async () => {
    const { git } = fakeGit({ [HEAD_BRANCH]: new Error("ref HEAD is not a symbolic ref") });
    await expect(currentBranch({ repoRoot: "/repo", git })).rejects.toThrow(ConfigError);
    await expect(currentBranch({ repoRoot: "/repo", git })).rejects.toThrow(
      /Could not read a branch[\s\S]*check out the branch/i,
    );
  });

  it("refuses an unborn HEAD, naming the branch that has no commits", async () => {
    const { git } = fakeGit({
      [HEAD_BRANCH]: "main",
      [HEAD_COMMIT]: new Error("git rev-parse --verify --quiet HEAD failed"),
    });
    await expect(currentBranch({ repoRoot: "/repo", git })).rejects.toThrow(/main has no commits/);
  });
});
