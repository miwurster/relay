import { describe, expect, it } from "vitest";
import { whyDirtyWorktreeRefusesLanding } from "../../src/host/dirty-worktree.js";

/** A fake `GitRunner` reporting one `git status --porcelain` answer. */
function fakeGit(status: string) {
  const calls: string[][] = [];
  const git = async (args: readonly string[]) => {
    calls.push([...args]);
    return status;
  };
  return { git, calls };
}

describe("whyDirtyWorktreeRefusesLanding", () => {
  it("names the base branch and both load-bearing phrases when the worktree is dirty", async () => {
    const { git } = fakeGit(" M src/pass/pass.ts");

    const reason = await whyDirtyWorktreeRefusesLanding({
      repoRoot: "/repo",
      baseBranch: "trunk",
      git,
    });

    expect(reason).toContain("trunk");
    expect(reason).toContain("uncommitted work");
    expect(reason).toContain("never stashes work it did not author");
  });

  it("has no reason when the worktree is clean", async () => {
    const { git } = fakeGit("");

    const reason = await whyDirtyWorktreeRefusesLanding({
      repoRoot: "/repo",
      baseBranch: "trunk",
      git,
    });

    expect(reason).toBeUndefined();
  });
});
