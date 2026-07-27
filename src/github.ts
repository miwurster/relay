import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { GitHubError } from "./errors.js";

/** A blocking edge: the issue relay would have to wait on. */
export interface GitHubBlocker {
  number: number;
  /** The blocker's `owner/repo`, which may not be this repo's. */
  repository: string;
  isOpen: boolean;
}

/** A child issue of a work item — one of the pass's tickets. */
export interface GitHubSubIssue {
  number: number;
  isOpen: boolean;
}

/** Only the fields work-item selection and planning gate on. */
export interface GitHubIssue {
  number: number;
  labels: string[];
  isOpen: boolean;
  blockedBy: GitHubBlocker[];
  subIssues: GitHubSubIssue[];
}

/**
 * The host's read-and-comment slice of GitHub. Everything else relay does with
 * the tracker happens in the sandbox through `gh`; the host only resolves the
 * one work item and comments on it, which keeps this seam small enough to fake.
 */
export interface GitHubClient {
  /** This repo's frontier: open `ready-for-agent` issues, longest-waiting first. */
  frontier(): Promise<GitHubIssue[]>;
  /** One issue by number, or `undefined` when no such issue is visible. */
  getIssue(number: number): Promise<GitHubIssue | undefined>;
  /** Leave a plain-text comment on an issue. */
  addComment(number: number, text: string): Promise<void>;
}

/** Runs the `gh` CLI on the host and returns its trimmed stdout. */
export type GhRunner = (args: readonly string[]) => Promise<string>;

const execFileAsync = promisify(execFile);

/** The real `gh` CLI, which infers the repo from the clone's remote. */
export const runGh: GhRunner = async (args) => {
  const { stdout } = await execFileAsync("gh", [...args], { maxBuffer: 64 * 1024 * 1024 });
  return stdout.trim();
};

/**
 * The version of the host's `gh`, which proves the CLI is there at all.
 *
 * Separate from the credential check because a missing CLI and an expired
 * login are different operator mistakes with different fixes.
 */
export async function ghVersion(gh: GhRunner = runGh): Promise<string> {
  let output: string;
  try {
    output = await gh(["--version"]);
  } catch (cause) {
    throw new GitHubError(
      "`gh` is not on this host's PATH, and relay resolves the work item through " +
        `the GitHub CLI: ${reasonOf(cause)}. Install it — https://cli.github.com.`,
    );
  }
  // `gh --version` follows the version with its release url.
  return output.split("\n")[0]?.trim() ?? output;
}

/**
 * What `gh auth status` says, which fails unless a credential is stored *and*
 * GitHub still accepts it.
 */
export async function ghAuthStatus(gh: GhRunner = runGh): Promise<string> {
  try {
    return await gh(["auth", "status"]);
  } catch (cause) {
    throw new GitHubError(
      `\`gh\` on this host has no credential GitHub accepts: ${reasonOf(cause)}. ` +
        "Run `gh auth login`, or export a GH_TOKEN with repo access.",
    );
  }
}

/**
 * The label that marks an item as agent-grabbable. Never bypassed — the
 * frontier query filters on it and the eligibility check gates on it, so both
 * read the one constant rather than agreeing by coincidence.
 */
export const READY_LABEL = "ready-for-agent";

/**
 * The frontier page size. `gh` defaults to 30, which would silently truncate a
 * real backlog.
 */
const FRONTIER_LIMIT = 100;

/**
 * The one field list every read asks for. `blockedBy` and `subIssues` resolve
 * their edges for a whole page in a single request, so a frontier scan is one
 * call however long the backlog is, and `gh` asks for exactly GitHub's
 * documented page sizes on both, so relay never paginates them.
 */
const FIELDS = "number,state,labels,blockedBy,subIssues";

/**
 * Longest-waiting first, asked of GitHub rather than sorted here: the limit
 * truncates the backlog server-side, so sorting afterwards would keep the
 * newest 100 and drop exactly the items the frontier's head should hold.
 *
 * It sorts on issue creation time, the only age GitHub can sort on. Humans
 * steer by when they apply the ready label, which no `gh` field carries, so a
 * long-open issue labelled today outranks a newer one labelled last week.
 */
const OLDEST_FIRST = "sort:created-asc";

/**
 * `gh`'s answer when the issue is not there or not visible to this token —
 * which is an answer, not a failure.
 */
const NO_SUCH_ISSUE = /could not resolve to an issue/i;

/** A GitHub client that shells out to `gh`. */
export function createGitHubClient(gh: GhRunner = runGh): GitHubClient {
  return {
    async frontier() {
      const output = await run("list this repo's frontier", () =>
        gh([
          "issue",
          "list",
          "--state",
          "open",
          "--label",
          READY_LABEL,
          "--search",
          OLDEST_FIRST,
          "--limit",
          String(FRONTIER_LIMIT),
          "--json",
          FIELDS,
        ]),
      );
      return parse(z.array(issueSchema), output).map(toIssue);
    },

    async getIssue(number) {
      let output: string;
      try {
        output = await gh(["issue", "view", String(number), "--json", FIELDS]);
      } catch (cause) {
        const reason = reasonOf(cause);
        // "No such issue" is an answer, not a failure.
        if (NO_SUCH_ISSUE.test(reason)) return undefined;
        throw new GitHubError(`Could not view issue ${number}: ${reason}`);
      }
      return toIssue(parse(issueSchema, output));
    },

    async addComment(number, text) {
      await run(`comment on issue ${number}`, () =>
        gh(["issue", "comment", String(number), "--body", text]),
      );
    },
  };
}

/** A `gh` call whose failure names what relay was trying to do. */
async function run(description: string, call: () => Promise<string>): Promise<string> {
  try {
    return await call();
  } catch (cause) {
    throw new GitHubError(`Could not ${description}: ${reasonOf(cause)}`);
  }
}

/** What `gh` said, which for the real runner carries its stderr. */
function reasonOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

const stateSchema = z.enum(["OPEN", "CLOSED"]);

/**
 * A nested issue node. `gh` asks GitHub for a `repository` on these but the
 * field never reaches the output, so a blocker's repo comes from its `url` —
 * without which a cross-repo blocker would look like one of this repo's.
 */
const nodeSchema = z.object({
  number: z.number(),
  state: stateSchema,
  url: z.string(),
});

const connectionSchema = z.object({ nodes: z.array(nodeSchema) });

const issueSchema = z.object({
  number: z.number(),
  state: stateSchema,
  labels: z.array(z.object({ name: z.string() })),
  blockedBy: connectionSchema,
  subIssues: connectionSchema,
});

type RawIssue = z.infer<typeof issueSchema>;
type RawNode = z.infer<typeof nodeSchema>;

function toIssue(raw: RawIssue): GitHubIssue {
  return {
    number: raw.number,
    labels: raw.labels.map((label) => label.name),
    isOpen: isOpen(raw),
    // Every blocker is reported, open or closed: filtering for open is the
    // eligibility check's job, and a closed one must not hold work back.
    blockedBy: raw.blockedBy.nodes.map((node) => ({
      number: node.number,
      repository: repositoryOf(node),
      isOpen: isOpen(node),
    })),
    // Sorted, because GitHub documents no order for sub-issues and empirically
    // returns them in insertion order.
    subIssues: raw.subIssues.nodes
      .map((node) => ({ number: node.number, isOpen: isOpen(node) }))
      .sort((left, right) => left.number - right.number),
  };
}

function isOpen({ state }: { state: z.infer<typeof stateSchema> }): boolean {
  return state === "OPEN";
}

/** The `owner/repo` of `https://github.com/owner/repo/issues/7`. */
function repositoryOf(node: RawNode): string {
  const [owner, repo] = new URL(node.url).pathname.split("/").filter(Boolean);
  if (!owner || !repo) {
    throw new GitHubError(`Could not read the repository of blocker ${node.url}`);
  }
  return `${owner}/${repo}`;
}

function parse<T extends z.ZodType>(schema: T, output: string): z.infer<T> {
  const result = schema.safeParse(jsonOf(output));
  if (!result.success) {
    throw new GitHubError(`Unexpected gh response: ${result.error.message}`);
  }
  return result.data;
}

function jsonOf(output: string): unknown {
  try {
    return JSON.parse(output);
  } catch {
    throw new GitHubError(`Unexpected gh response, which is not JSON: ${output}`);
  }
}
