import { describe, expect, it } from "vitest";
import { defaultBranch, isGitHubRemote, isGitRepo, originUrl } from "../src/git.js";

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

describe("defaultBranch", () => {
  it("reads the branch off origin/HEAD", async () => {
    const { git } = fakeGit({
      "-C /repo symbolic-ref refs/remotes/origin/HEAD": "refs/remotes/origin/trunk",
    });
    expect(await defaultBranch({ repoRoot: "/repo", git })).toBe("trunk");
  });

  it("falls back to the current branch when origin/HEAD is unset", async () => {
    const { git, calls } = fakeGit({
      "-C /repo symbolic-ref refs/remotes/origin/HEAD": new Error(
        "ref refs/remotes/origin/HEAD is not a symbolic ref",
      ),
      "-C /repo rev-parse --abbrev-ref HEAD": "main",
    });
    expect(await defaultBranch({ repoRoot: "/repo", git })).toBe("main");
    expect(calls).toEqual([
      ["-C", "/repo", "symbolic-ref", "refs/remotes/origin/HEAD"],
      ["-C", "/repo", "rev-parse", "--abbrev-ref", "HEAD"],
    ]);
  });
});
