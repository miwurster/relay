import { describe, expect, it } from "vitest";
import { ignoresWorktreeDir, withWorktreeDirIgnored } from "../src/worktree-dir.js";

describe("ignoresWorktreeDir", () => {
  it.each([".sandcastle", ".sandcastle/", "/.sandcastle", "/.sandcastle/", "  .sandcastle/  "])(
    "recognises %j as ignoring the worktree directory",
    (line) => {
      expect(ignoresWorktreeDir(`dist\n${line}\nnode_modules/\n`)).toBe(true);
    },
  );

  it("does not mistake a comment for an entry", () => {
    expect(ignoresWorktreeDir("# .sandcastle/\n")).toBe(false);
  });

  it("does not match a longer path that merely starts the same", () => {
    expect(ignoresWorktreeDir(".sandcastle-old/\n")).toBe(false);
  });

  it("treats an empty file as not ignoring it", () => {
    expect(ignoresWorktreeDir("")).toBe(false);
  });
});

describe("withWorktreeDirIgnored", () => {
  it("writes the entry alone into an empty file", () => {
    expect(withWorktreeDirIgnored("")).toBe("# A relay pass's git worktree.\n.sandcastle/\n");
  });

  it("appends after a blank line, keeping what was there", () => {
    expect(withWorktreeDirIgnored("dist\n")).toBe(
      "dist\n\n# A relay pass's git worktree.\n.sandcastle/\n",
    );
  });

  it("closes a file that did not end in a newline", () => {
    expect(withWorktreeDirIgnored("dist")).toBe(
      "dist\n\n# A relay pass's git worktree.\n.sandcastle/\n",
    );
  });

  it("produces contents the predicate then recognises", () => {
    expect(ignoresWorktreeDir(withWorktreeDirIgnored("dist\n"))).toBe(true);
  });
});
