import { describe, expect, it } from "vitest";
import { SelectionError } from "../src/errors.js";
import type { JiraClient, JiraIssue } from "../src/jira.js";
import type { TrackerScope } from "../src/tracker-doc.js";
import { frontierJql, selectWorkItem } from "../src/work-item.js";

const scope: TrackerScope = { projectKey: "PSD", repoLabel: "repo:qc-catalog" };

function issue(overrides: Partial<JiraIssue> = {}): JiraIssue {
  return {
    key: "PSD-1",
    issueType: "Story",
    labels: ["repo:qc-catalog", "ready-for-agent"],
    isDone: false,
    blockedBy: [],
    ...overrides,
  };
}

/** A fake standing in for the whole Jira seam: no sandbox, no network. */
function fakeJira(issues: JiraIssue[]): JiraClient & { queries: string[] } {
  const queries: string[] = [];
  return {
    queries,
    async search(jql) {
      queries.push(jql);
      return issues;
    },
    async getIssue(key) {
      return issues.find((candidate) => candidate.key === key);
    },
  };
}

describe("frontierJql", () => {
  it("narrows to the runnable types, ordered priority DESC then created ASC", () => {
    expect(frontierJql(scope)).toBe(
      'project = PSD AND labels = "repo:qc-catalog" AND labels = "ready-for-agent"' +
        ' AND statusCategory != Done AND labels not in ("agent-running")' +
        " AND issuetype in (Story, Bug, Vulnerability)" +
        " ORDER BY priority DESC, created ASC",
    );
  });

  it("scopes to the repo the tracker doc names, not the git remote", () => {
    const jql = frontierJql({ projectKey: "ABC", repoLabel: "repo:other" });

    expect(jql).toContain("project = ABC");
    expect(jql).toContain('labels = "repo:other"');
  });
});

describe("auto-pick", () => {
  it("takes the first frontier item, since Jira applied the ordering", async () => {
    const jira = fakeJira([issue({ key: "PSD-9" }), issue({ key: "PSD-2" })]);

    const selection = await selectWorkItem(jira, scope);

    expect(selection).toEqual({ kind: "work-item", issue: issue({ key: "PSD-9" }) });
    expect(jira.queries).toEqual([frontierJql(scope)]);
  });

  it("skips a candidate with an open blocker", async () => {
    const blocked = issue({ key: "PSD-9", blockedBy: [{ key: "PSD-3", isDone: false }] });
    const ready = issue({ key: "PSD-2", blockedBy: [{ key: "PSD-1", isDone: true }] });

    const selection = await selectWorkItem(fakeJira([blocked, ready]), scope);

    expect(selection).toEqual({ kind: "work-item", issue: ready });
  });

  it("resolves an empty frontier to nothing-to-do", async () => {
    await expect(selectWorkItem(fakeJira([]), scope)).resolves.toEqual({
      kind: "nothing-to-do",
    });
  });

  it("resolves to nothing-to-do when every candidate is blocked", async () => {
    const blocked = issue({ blockedBy: [{ key: "PSD-3", isDone: false }] });

    await expect(selectWorkItem(fakeJira([blocked]), scope)).resolves.toEqual({
      kind: "nothing-to-do",
    });
  });
});

describe("explicit key", () => {
  it("runs an item that passes every gate", async () => {
    const target = issue({ key: "PSD-7", issueType: "Vulnerability" });

    const selection = await selectWorkItem(fakeJira([target]), scope, "PSD-7");

    expect(selection).toEqual({ kind: "work-item", issue: target });
  });

  it("never searches the frontier", async () => {
    const jira = fakeJira([issue({ key: "PSD-7" })]);

    await selectWorkItem(jira, scope, "PSD-7");

    expect(jira.queries).toEqual([]);
  });

  it("refuses a Task", async () => {
    const jira = fakeJira([issue({ key: "PSD-7", issueType: "Task" })]);

    await expect(selectWorkItem(jira, scope, "PSD-7")).rejects.toThrow(
      /PSD-7 is a Task — relay only runs Story, Bug, Vulnerability\./,
    );
  });

  it.each([
    [
      "another repo's item",
      { labels: ["repo:other", "ready-for-agent"] },
      /not labelled repo:qc-catalog/,
    ],
    ["an untriaged item", { labels: ["repo:qc-catalog"] }, /not labelled ready-for-agent/],
    [
      "an item another run holds",
      { labels: ["repo:qc-catalog", "ready-for-agent", "agent-running"] },
      /another run holds it/,
    ],
    ["a done item", { isDone: true }, /already done/],
    ["a blocked item", { blockedBy: [{ key: "PSD-3", isDone: false }] }, /blocked by PSD-3/],
  ])("breaks the pass on %s", async (_name, overrides, reason) => {
    const jira = fakeJira([issue({ key: "PSD-7", ...overrides })]);

    await expect(selectWorkItem(jira, scope, "PSD-7")).rejects.toThrow(reason);
  });

  it("breaks the pass on an item outside the scoped project", async () => {
    const jira = fakeJira([issue({ key: "ABC-7" })]);

    await expect(selectWorkItem(jira, scope, "ABC-7")).rejects.toThrow(/not in project PSD/);
  });

  it("breaks the pass with a SelectionError, never a silent skip", async () => {
    const jira = fakeJira([issue({ key: "PSD-7", issueType: "Task" })]);

    await expect(selectWorkItem(jira, scope, "PSD-7")).rejects.toBeInstanceOf(SelectionError);
  });

  it("breaks the pass on an unknown key", async () => {
    await expect(selectWorkItem(fakeJira([]), scope, "PSD-404")).rejects.toThrow(
      /PSD-404 does not exist/,
    );
  });
});
