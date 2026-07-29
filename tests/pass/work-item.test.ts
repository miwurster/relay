import { describe, expect, it } from "vitest";
import { SelectionError } from "../../src/errors.js";
import type { GitHubClient, GitHubIssue } from "../../src/tracker/github.js";
import { parseWorkItem, selectWorkItem } from "../../src/pass/work-item.js";

function issue(overrides: Partial<GitHubIssue> = {}): GitHubIssue {
  return {
    number: 1,
    labels: ["ready-for-agent"],
    isOpen: true,
    blockedBy: [],
    subIssues: [],
    ...overrides,
  };
}

/** The repository the clone under test runs against. */
const REPOSITORY = "miwurster/relay";

function blocker(overrides: Partial<GitHubIssue["blockedBy"][number]> = {}) {
  return { number: 3, repository: REPOSITORY, isOpen: true, ...overrides };
}

/** A fake standing in for the whole GitHub seam: no `gh`, no network. */
function fakeGitHub(issues: GitHubIssue[]): GitHubClient & { frontierScans: number } {
  return {
    frontierScans: 0,
    async repository() {
      return REPOSITORY;
    },
    async frontier() {
      this.frontierScans += 1;
      // Whatever the query answered, eligibility gates it: the query is only a
      // prefilter, and both paths run the same gates.
      return issues;
    },
    async getIssue(number) {
      return issues.find((candidate) => candidate.number === number);
    },
    async addComment() {
      // Selection never comments; the handover does.
    },
  };
}

describe("auto-pick", () => {
  it("takes the first frontier item, since GitHub applied the ordering", async () => {
    const github = fakeGitHub([issue({ number: 9 }), issue({ number: 2 })]);

    const selection = await selectWorkItem(github);

    expect(selection).toEqual({ kind: "work-item", issue: issue({ number: 9 }) });
    expect(github.frontierScans).toBe(1);
  });

  it("skips a candidate with an open blocker", async () => {
    const blocked = issue({ number: 9, blockedBy: [blocker()] });
    const ready = issue({ number: 2, blockedBy: [blocker({ isOpen: false })] });

    const selection = await selectWorkItem(fakeGitHub([blocked, ready]));

    expect(selection).toEqual({ kind: "work-item", issue: ready });
  });

  it("skips a held candidate so two passes never race on it", async () => {
    const held = issue({ number: 9, labels: ["ready-for-agent", "agent-in-progress"] });
    const ready = issue({ number: 2 });

    const selection = await selectWorkItem(fakeGitHub([held, ready]));

    expect(selection).toEqual({ kind: "work-item", issue: ready });
  });

  it("skips a closed candidate, so finished work is never re-run", async () => {
    const closed = issue({ number: 9, isOpen: false });
    const ready = issue({ number: 2 });

    const selection = await selectWorkItem(fakeGitHub([closed, ready]));

    expect(selection).toEqual({ kind: "work-item", issue: ready });
  });

  it("resolves an empty frontier to nothing-to-do", async () => {
    await expect(selectWorkItem(fakeGitHub([]))).resolves.toEqual({ kind: "nothing-to-do" });
  });

  it("resolves to nothing-to-do when every candidate is blocked", async () => {
    const blocked = issue({ blockedBy: [blocker()] });

    await expect(selectWorkItem(fakeGitHub([blocked]))).resolves.toEqual({
      kind: "nothing-to-do",
    });
  });
});

describe("an explicitly named item", () => {
  it("runs an item that passes every gate", async () => {
    const target = issue({ number: 7 });

    const selection = await selectWorkItem(fakeGitHub([target]), { number: 7 });

    expect(selection).toEqual({ kind: "work-item", issue: target });
  });

  it("never scans the frontier", async () => {
    const github = fakeGitHub([issue({ number: 7 })]);

    await selectWorkItem(github, { number: 7 });

    expect(github.frontierScans).toBe(0);
  });

  it.each([
    ["an untriaged item", { labels: [] }, /not labelled ready-for-agent/],
    ["a held item", { labels: ["ready-for-agent", "agent-in-progress"] }, /is held by a pass/],
    ["a closed item", { isOpen: false }, /is closed/],
    ["a blocked item", { blockedBy: [blocker()] }, /blocked by miwurster\/relay#3/],
  ])("breaks the pass on %s, naming the gate it failed", async (_name, overrides, reason) => {
    const github = fakeGitHub([issue({ number: 7, ...overrides })]);

    await expect(selectWorkItem(github, { number: 7 })).rejects.toThrow(reason);
  });

  it("honours a blocker in another repository", async () => {
    const other = blocker({ number: 4, repository: "acme/other" });
    const github = fakeGitHub([issue({ number: 7, blockedBy: [other] })]);

    await expect(selectWorkItem(github, { number: 7 })).rejects.toThrow(/blocked by acme\/other#4/);
  });

  it("ignores a closed blocker, so a finished dependency never holds work back", async () => {
    const target = issue({ number: 7, blockedBy: [blocker({ isOpen: false })] });

    await expect(selectWorkItem(fakeGitHub([target]), { number: 7 })).resolves.toEqual({
      kind: "work-item",
      issue: target,
    });
  });

  it("breaks the pass with a SelectionError, never a silent skip", async () => {
    const github = fakeGitHub([issue({ number: 7, labels: [] })]);

    await expect(selectWorkItem(github, { number: 7 })).rejects.toBeInstanceOf(SelectionError);
  });

  it("says how to lift a hold, since nothing removes the label after a crash", async () => {
    const held = issue({ number: 7, labels: ["ready-for-agent", "agent-in-progress"] });

    await expect(selectWorkItem(fakeGitHub([held]), { number: 7 })).rejects.toThrow(
      /gh issue edit 7 --remove-label agent-in-progress/,
    );
  });

  it("refuses a URL from another repository, rather than running this repo's issue", async () => {
    const github = fakeGitHub([issue({ number: 7 })]);

    await expect(selectWorkItem(github, { number: 7, repository: "acme/other" })).rejects.toThrow(
      /acme\/other#7 is not in miwurster\/relay/,
    );
  });

  it("runs a URL naming this repository, whatever case it was pasted in", async () => {
    const target = issue({ number: 7 });

    await expect(
      selectWorkItem(fakeGitHub([target]), { number: 7, repository: "MiWurster/Relay" }),
    ).resolves.toEqual({ kind: "work-item", issue: target });
  });

  it("breaks the pass on an unknown number", async () => {
    await expect(selectWorkItem(fakeGitHub([]), { number: 404 })).rejects.toThrow(
      /#404 does not exist/,
    );
  });
});

describe("parseWorkItem", () => {
  it.each([
    ["a bare number", "42"],
    ["a #-prefixed number", "#42"],
    ["a full issue URL", `https://github.com/${REPOSITORY}/issues/42`],
  ])("resolves %s to the same item", (_form, argument) => {
    expect(parseWorkItem(argument).number).toBe(42);
  });

  it("keeps the repository a URL names, and leaves a bare number without one", () => {
    expect(parseWorkItem(`https://github.com/${REPOSITORY}/issues/42`)).toEqual({
      number: 42,
      repository: REPOSITORY,
    });
    expect(parseWorkItem("42")).toEqual({ number: 42 });
  });

  it.each([
    "",
    "#",
    "PSD-1",
    "42.5",
    "-1",
    "0",
    "4#2",
    "42#",
    "https://github.com/miwurster/relay/pull/42",
    "https://example.com/miwurster/relay/issues/42",
  ])("rejects %o before any tracker call", (argument) => {
    expect(() => parseWorkItem(argument)).toThrow(SelectionError);
  });
});
