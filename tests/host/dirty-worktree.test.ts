import { describe, expect, it } from "vitest";
import { whyLandingRefusesWorktree } from "../../src/host/dirty-worktree.js";

/** A fake `GitRunner` reporting one `git status --porcelain` answer. */
function fakeGit(status: string) {
  const calls: string[][] = [];
  const git = async (args: readonly string[]) => {
    calls.push([...args]);
    return status;
  };
  return { git, calls };
}

describe("whyLandingRefusesWorktree", () => {
  it("names the base branch and both load-bearing phrases under merge landing with a dirty worktree", async () => {
    const { git } = fakeGit(" M src/pass/pass.ts");

    const reason = await whyLandingRefusesWorktree({
      repoRoot: "/repo",
      landing: "merge",
      baseBranch: "trunk",
      git,
    });

    expect(reason).toContain("trunk");
    expect(reason).toContain("uncommitted work");
    expect(reason).toContain("never stashes work it did not author");
  });

  it("has no reason under merge landing with a clean worktree", async () => {
    const { git } = fakeGit("");

    const reason = await whyLandingRefusesWorktree({
      repoRoot: "/repo",
      landing: "merge",
      baseBranch: "trunk",
      git,
    });

    expect(reason).toBeUndefined();
  });

  it("has no reason under pull-request landing with a dirty worktree", async () => {
    const { git } = fakeGit(" M src/pass/pass.ts");

    const reason = await whyLandingRefusesWorktree({
      repoRoot: "/repo",
      landing: "pull-request",
      baseBranch: "trunk",
      git,
    });

    expect(reason).toBeUndefined();
  });

  it("does not ask git about a worktree a pull-request pass never touches", async () => {
    const { git, calls } = fakeGit("");

    await whyLandingRefusesWorktree({
      repoRoot: "/repo",
      landing: "pull-request",
      baseBranch: "trunk",
      git,
    });

    expect(calls).toEqual([]);
  });
});
