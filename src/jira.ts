import { z } from "zod";
import { JiraError } from "./errors.js";

/** A blocking edge: the issue relay would have to wait on. */
export interface JiraBlocker {
  key: string;
  isDone: boolean;
}

/** Only the fields work-item selection gates on. */
export interface JiraIssue {
  key: string;
  issueType: string;
  labels: string[];
  isDone: boolean;
  blockedBy: JiraBlocker[];
}

/**
 * The host's read-only slice of Jira. Everything else relay does with Jira
 * happens in the sandbox over MCP; the host only resolves the one work item,
 * which keeps this seam small enough to fake in tests.
 */
export interface JiraClient {
  /** Every issue matching a JQL query, in the order the query asked for. */
  search(jql: string): Promise<JiraIssue[]>;
  /** One issue by key, or `undefined` when no such issue is visible. */
  getIssue(key: string): Promise<JiraIssue | undefined>;
  /** Leave a plain-text comment on an issue. */
  addComment(key: string, text: string): Promise<void>;
}

/** The single service-account identity every Jira call runs as. */
export interface JiraCredentials {
  baseUrl: string;
  email: string;
  token: string;
}

const FIELDS = "issuetype,labels,status,issuelinks";

/** A Jira Cloud REST client authenticating as the service account. */
export function createJiraClient(credentials: JiraCredentials): JiraClient {
  return {
    async search(jql) {
      const issues: JiraIssue[] = [];
      let pageToken: string | undefined;
      // Paged through in full: selection takes the first eligible issue, and a
      // truncated frontier would silently look like nothing to do.
      do {
        const page = await searchPage(credentials, jql, pageToken);
        issues.push(...page.issues.map(toIssue));
        pageToken = page.nextPageToken;
      } while (pageToken);
      return issues;
    },

    async getIssue(key) {
      const url = apiUrl(credentials, `/rest/api/3/issue/${encodeURIComponent(key)}`, {
        fields: FIELDS,
      });
      const response = await request(credentials, url);
      // "No such issue" is an answer, not a failure.
      if (response.status === 404) return undefined;
      return toIssue(parse(issueSchema, await jsonBody(response, url)));
    },

    async addComment(key, text) {
      const url = apiUrl(credentials, `/rest/api/3/issue/${encodeURIComponent(key)}/comment`);
      const response = await request(credentials, url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: adfParagraph(text) }),
      });
      requireOk(response, url);
    },
  };
}

/** A comment body in the document format the Jira Cloud API expects. */
function adfParagraph(text: string) {
  return {
    type: "doc",
    version: 1,
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

async function searchPage(credentials: JiraCredentials, jql: string, pageToken?: string) {
  const query: Record<string, string> = { jql, fields: FIELDS };
  if (pageToken) query["nextPageToken"] = pageToken;
  const url = apiUrl(credentials, "/rest/api/3/search/jql", query);
  const body = await jsonBody(await request(credentials, url), url);
  return parse(searchResponseSchema, body);
}

function apiUrl(
  credentials: JiraCredentials,
  path: string,
  query?: Record<string, string>,
): URL {
  const url = new URL(path, credentials.baseUrl);
  if (query) url.search = new URLSearchParams(query).toString();
  return url;
}

/**
 * A call as the service account. What a status means is the caller's, since
 * only the caller knows whether a 404 is a failure or an answer.
 */
async function request(
  credentials: JiraCredentials,
  url: URL,
  init: RequestInit = {},
): Promise<Response> {
  const authorization = Buffer.from(`${credentials.email}:${credentials.token}`).toString(
    "base64",
  );
  return await fetch(url, {
    ...init,
    headers: {
      authorization: `Basic ${authorization}`,
      accept: "application/json",
      ...init.headers,
    },
  });
}

/** Any error status is a `JiraError`. */
function requireOk(response: Response, url: URL): void {
  if (!response.ok) {
    throw new JiraError(`Jira ${response.status} ${response.statusText} for ${url.pathname}`);
  }
}

async function jsonBody(response: Response, url: URL): Promise<unknown> {
  requireOk(response, url);
  return await response.json();
}

const statusSchema = z.object({ statusCategory: z.object({ key: z.string() }) });

const linkedIssueSchema = z.object({ key: z.string(), fields: z.object({ status: statusSchema }) });

/**
 * A link record is read from the current issue's side: `inwardIssue` is the
 * other end of the type's inward phrasing, so "is blocked by" plus an
 * `inwardIssue` is a blocker of this issue.
 */
const issueLinkSchema = z.object({
  type: z.object({ inward: z.string() }),
  inwardIssue: linkedIssueSchema.optional(),
});

const issueSchema = z.object({
  key: z.string(),
  fields: z.object({
    issuetype: z.object({ name: z.string() }),
    labels: z.array(z.string()),
    status: statusSchema,
    issuelinks: z.array(issueLinkSchema).default([]),
  }),
});

const searchResponseSchema = z.object({
  issues: z.array(issueSchema).default([]),
  nextPageToken: z.string().optional(),
});

type RawIssue = z.infer<typeof issueSchema>;

function toIssue(raw: RawIssue): JiraIssue {
  return {
    key: raw.key,
    issueType: raw.fields.issuetype.name,
    labels: raw.fields.labels,
    isDone: isDone(raw.fields.status),
    blockedBy: raw.fields.issuelinks.flatMap((link) =>
      link.inwardIssue && link.type.inward === "is blocked by"
        ? [{ key: link.inwardIssue.key, isDone: isDone(link.inwardIssue.fields.status) }]
        : [],
    ),
  };
}

function isDone(status: z.infer<typeof statusSchema>): boolean {
  return status.statusCategory.key === "done";
}

function parse<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new JiraError(`Unexpected Jira response: ${result.error.message}`);
  }
  return result.data;
}
