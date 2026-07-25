import { afterEach, describe, expect, it, vi } from "vitest";
import { JiraError } from "../src/errors.js";
import { createJiraClient } from "../src/jira.js";

const credentials = {
  baseUrl: "https://example.atlassian.net",
  email: "relay@kipu-quantum.com",
  token: "sa-token",
};

const blocks = { inward: "is blocked by", outward: "blocks" };

function status(category: string) {
  return { statusCategory: { key: category } };
}

function rawIssue(key: string, overrides: Record<string, unknown> = {}) {
  return {
    key,
    fields: {
      issuetype: { name: "Story" },
      labels: ["repo:qc-catalog", "ready-for-agent"],
      status: status("indeterminate"),
      ...overrides,
    },
  };
}

const rawStory = rawIssue("PSD-1", {
  issuelinks: [
    { type: blocks, inwardIssue: { key: "PSD-2", fields: { status: status("done") } } },
    { type: blocks, inwardIssue: { key: "PSD-3", fields: { status: status("new") } } },
    // This issue blocks PSD-4 — not a blocker of it.
    { type: blocks, outwardIssue: { key: "PSD-4", fields: { status: status("new") } } },
  ],
});

/** Stub `fetch`, answering each call with the next queued response. */
function stubFetch(...responses: { status?: number; body?: unknown }[]) {
  let call = 0;
  const fetchMock = vi.fn(async (url: URL) => {
    const response = responses[Math.min(call++, responses.length - 1)]!;
    return new Response(response.body === undefined ? null : JSON.stringify(response.body), {
      status: response.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

type FetchMock = ReturnType<typeof stubFetch>;

function requestedUrl(fetchMock: FetchMock, call = 0): URL {
  return fetchMock.mock.calls[call]![0] as unknown as URL;
}

function requestHeaders(fetchMock: FetchMock): Record<string, string> {
  return (fetchMock.mock.calls[0]![1] as unknown as RequestInit).headers as Record<
    string,
    string
  >;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("search", () => {
  it("sends the JQL to the search endpoint as the service account", async () => {
    const fetchMock = stubFetch({ body: { issues: [] } });

    await createJiraClient(credentials).search("project = PSD");

    const url = requestedUrl(fetchMock);
    expect(url.pathname).toBe("/rest/api/3/search/jql");
    expect(url.searchParams.get("jql")).toBe("project = PSD");
    expect(requestHeaders(fetchMock)["authorization"]).toBe(
      `Basic ${Buffer.from("relay@kipu-quantum.com:sa-token").toString("base64")}`,
    );
  });

  it("maps the fields selection gates on, keeping only real blockers", async () => {
    stubFetch({ body: { issues: [rawStory] } });

    const [issue] = await createJiraClient(credentials).search("project = PSD");

    expect(issue).toEqual({
      key: "PSD-1",
      issueType: "Story",
      labels: ["repo:qc-catalog", "ready-for-agent"],
      isDone: false,
      blockedBy: [
        { key: "PSD-2", isDone: true },
        { key: "PSD-3", isDone: false },
      ],
    });
  });

  it("reads a Done status category as done", async () => {
    stubFetch({ body: { issues: [rawIssue("PSD-1", { status: status("done") })] } });

    const [issue] = await createJiraClient(credentials).search("project = PSD");

    expect(issue?.isDone).toBe(true);
  });

  it("follows every page, so a long frontier is never truncated", async () => {
    const fetchMock = stubFetch(
      { body: { issues: [rawIssue("PSD-1")], nextPageToken: "page-2" } },
      { body: { issues: [rawIssue("PSD-2")] } },
    );

    const issues = await createJiraClient(credentials).search("project = PSD");

    expect(issues.map((issue) => issue.key)).toEqual(["PSD-1", "PSD-2"]);
    expect(requestedUrl(fetchMock, 1).searchParams.get("nextPageToken")).toBe("page-2");
  });

  it("surfaces an auth failure as a JiraError", async () => {
    stubFetch({ status: 401, body: {} });

    await expect(createJiraClient(credentials).search("project = PSD")).rejects.toThrow(
      JiraError,
    );
  });

  it("surfaces an unexpected response shape as a JiraError", async () => {
    stubFetch({ body: { issues: [{ nope: true }] } });

    await expect(createJiraClient(credentials).search("project = PSD")).rejects.toThrow(
      /Unexpected Jira response/,
    );
  });
});

describe("getIssue", () => {
  it("fetches one issue by key", async () => {
    const fetchMock = stubFetch({ body: rawStory });

    const issue = await createJiraClient(credentials).getIssue("PSD-1");

    expect(requestedUrl(fetchMock).pathname).toBe("/rest/api/3/issue/PSD-1");
    expect(issue?.key).toBe("PSD-1");
  });

  it("resolves an unknown key to undefined", async () => {
    stubFetch({ status: 404, body: { errorMessages: ["Issue does not exist"] } });

    await expect(createJiraClient(credentials).getIssue("PSD-404")).resolves.toBeUndefined();
  });
});
