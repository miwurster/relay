import { describe, expect, it } from "vitest";
import { GitHubError } from "../src/errors.js";
import { createGitHubClient, ghAuthStatus, ghVersion } from "../src/github.js";

/** Answers each `gh` invocation with the next canned stdout, recording the calls. */
function fakeGh(answers: string[] = []) {
  const calls: string[][] = [];
  const gh = async (args: readonly string[]) => {
    calls.push([...args]);
    return answers.shift() ?? "";
  };
  return { gh, calls };
}

/** A `gh` that fails the way the real one does: a rejection carrying stderr. */
function failingGh(message: string) {
  return async () => {
    throw new Error(message);
  };
}

function node(number: number, state = "OPEN", repository = "kipu-quantum/relay") {
  return { number, state, url: `https://github.com/${repository}/issues/${number}` };
}

function rawIssue(number: number, overrides: Record<string, unknown> = {}) {
  return {
    number,
    state: "OPEN",
    labels: [{ name: "ready-for-agent" }],
    blockedBy: { nodes: [], totalCount: 0 },
    subIssues: { nodes: [], totalCount: 0 },
    ...overrides,
  };
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

describe("frontier", () => {
  it("asks for this repo's open ready-for-agent issues in one call", async () => {
    const { gh, calls } = fakeGh([json([])]);

    await createGitHubClient(gh).frontier();

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([
      "issue",
      "list",
      "--state",
      "open",
      "--label",
      "ready-for-agent",
      "--search",
      "sort:created-asc",
      "--limit",
      "100",
      "--json",
      "number,state,labels,blockedBy,subIssues",
    ]);
  });

  it("maps the fields selection and planning gate on", async () => {
    const { gh } = fakeGh([
      json([
        rawIssue(42, {
          labels: [{ name: "ready-for-agent" }, { name: "bug" }],
          blockedBy: { nodes: [node(7, "CLOSED"), node(8, "OPEN")], totalCount: 2 },
          subIssues: { nodes: [node(44), node(43, "CLOSED")], totalCount: 2 },
        }),
      ]),
    ]);

    const [issue] = await createGitHubClient(gh).frontier();

    expect(issue).toEqual({
      number: 42,
      isOpen: true,
      labels: ["ready-for-agent", "bug"],
      blockedBy: [
        { number: 7, repository: "kipu-quantum/relay", isOpen: false },
        { number: 8, repository: "kipu-quantum/relay", isOpen: true },
      ],
      subIssues: [
        { number: 43, isOpen: false },
        { number: 44, isOpen: true },
      ],
    });
  });

  it("reports a closed issue as closed, reading gh's upper-case state", async () => {
    const { gh } = fakeGh([json([rawIssue(42, { state: "CLOSED" })])]);

    const [issue] = await createGitHubClient(gh).frontier();

    expect(issue?.isOpen).toBe(false);
  });

  it("keeps every blocker, since filtering for open is eligibility's job", async () => {
    const { gh } = fakeGh([
      json([rawIssue(42, { blockedBy: { nodes: [node(7, "CLOSED")], totalCount: 1 } })]),
    ]);

    const [issue] = await createGitHubClient(gh).frontier();

    expect(issue?.blockedBy).toEqual([
      { number: 7, repository: "kipu-quantum/relay", isOpen: false },
    ]);
  });

  it("attributes a cross-repo blocker from its url rather than dropping it", async () => {
    const { gh } = fakeGh([
      json([
        rawIssue(42, {
          blockedBy: { nodes: [node(9, "OPEN", "kipu-quantum/qc-catalog")], totalCount: 1 },
        }),
      ]),
    ]);

    const [issue] = await createGitHubClient(gh).frontier();

    expect(issue?.blockedBy).toEqual([
      { number: 9, repository: "kipu-quantum/qc-catalog", isOpen: true },
    ]);
  });

  it("sorts sub-issues by number, since gh's order is insertion order", async () => {
    const { gh } = fakeGh([
      json([
        rawIssue(42, {
          subIssues: { nodes: [node(51), node(49), node(50)], totalCount: 3 },
        }),
      ]),
    ]);

    const [issue] = await createGitHubClient(gh).frontier();

    expect(issue?.subIssues.map((sub) => sub.number)).toEqual([49, 50, 51]);
  });

  it("asks GitHub for longest-waiting first, so the limit truncates the newest", async () => {
    const { gh, calls } = fakeGh([json([])]);

    await createGitHubClient(gh).frontier();

    const [args = []] = calls;
    expect(args.indexOf("--search")).toBeLessThan(args.indexOf("--limit"));
    expect(args[args.indexOf("--search") + 1]).toBe("sort:created-asc");
  });

  it("keeps the order gh answered in, since that order is the frontier's", async () => {
    const { gh } = fakeGh([json([rawIssue(7), rawIssue(2), rawIssue(5)])]);

    const issues = await createGitHubClient(gh).frontier();

    expect(issues.map((issue) => issue.number)).toEqual([7, 2, 5]);
  });

  it("surfaces a gh failure as a GitHubError naming what was attempted", async () => {
    const client = createGitHubClient(failingGh("gh: not logged in"));

    await expect(client.frontier()).rejects.toThrow(GitHubError);
    await expect(client.frontier()).rejects.toThrow(/frontier.*not logged in/s);
  });

  it("surfaces an unexpected gh response as a GitHubError", async () => {
    const { gh } = fakeGh([json([{ nope: true }])]);

    await expect(createGitHubClient(gh).frontier()).rejects.toThrow(/Unexpected gh response/);
  });
});

describe("getIssue", () => {
  it("views one issue by number", async () => {
    const { gh, calls } = fakeGh([json(rawIssue(42))]);

    const issue = await createGitHubClient(gh).getIssue(42);

    expect(calls[0]).toEqual([
      "issue",
      "view",
      "42",
      "--json",
      "number,state,labels,blockedBy,subIssues",
    ]);
    expect(issue?.number).toBe(42);
  });

  // The message is `execFile`'s, carrying gh's stderr, captured verbatim from
  // gh 2.96.0 so the match is pinned to what the real tool says.
  it("resolves an issue that does not exist or is not visible to undefined", async () => {
    const gh = failingGh(
      "Command failed: gh issue view 404 --json number\n" +
        "GraphQL: Could not resolve to an issue or pull request with the number of 404." +
        " (repository.issue)\n",
    );

    await expect(createGitHubClient(gh).getIssue(404)).resolves.toBeUndefined();
  });

  it("still surfaces any other gh failure as a GitHubError", async () => {
    const gh = failingGh("gh: not logged in");

    await expect(createGitHubClient(gh).getIssue(42)).rejects.toThrow(GitHubError);
  });
});

describe("addComment", () => {
  it("comments on the issue with the body as one argument", async () => {
    const { gh, calls } = fakeGh([""]);

    await createGitHubClient(gh).addComment(42, "relay opened a pull request.");

    expect(calls[0]).toEqual(["issue", "comment", "42", "--body", "relay opened a pull request."]);
  });

  it("surfaces a gh failure as a GitHubError naming the issue", async () => {
    const client = createGitHubClient(failingGh("gh: HTTP 403"));

    await expect(client.addComment(42, "hello")).rejects.toThrow(/comment on issue 42/);
  });
});

describe("dependency edges", () => {
  it("never reaches a dependencies REST endpoint, whatever the client is asked to do", async () => {
    const { gh, calls } = fakeGh([json([rawIssue(42)]), json(rawIssue(42)), ""]);
    const client = createGitHubClient(gh);

    await client.frontier();
    await client.getIssue(42);
    await client.addComment(42, "hello");

    // A dependency edge may only ever be written with `gh issue edit
    // --add-blocked-by`: the REST endpoint takes a numeric database id, so
    // handing it an issue number returns 201 and silently links an unrelated
    // repository's issue.
    for (const args of calls) {
      expect(args).not.toContain("api");
      expect(args.some((arg) => arg.includes("dependencies"))).toBe(false);
    }
  });
});

describe("ghVersion", () => {
  it("reports the version of the host's `gh`", async () => {
    const { gh, calls } = fakeGh(["gh version 2.62.0 (2024-11-14)\nhttps://github.com/cli/cli"]);

    await expect(ghVersion(gh)).resolves.toBe("gh version 2.62.0 (2024-11-14)");
    expect(calls[0]).toEqual(["--version"]);
  });

  it("says how to install `gh` when the host has none", async () => {
    await expect(ghVersion(failingGh("spawn gh ENOENT"))).rejects.toThrow(
      /is not on this host's PATH/,
    );
  });
});

describe("ghAuthStatus", () => {
  it("reports the host that `gh` is logged in to", async () => {
    const { gh, calls } = fakeGh(["github.com\n  ✓ Logged in to github.com account octocat"]);

    await expect(ghAuthStatus(gh)).resolves.toContain("Logged in to github.com");
    expect(calls[0]).toEqual(["auth", "status"]);
  });

  it("says how to log in when `gh` has no valid credential", async () => {
    const failing = failingGh("You are not logged into any GitHub hosts.");

    await expect(ghAuthStatus(failing)).rejects.toThrow(/gh auth login/);
    await expect(ghAuthStatus(failing)).rejects.toThrow(GitHubError);
  });
});
