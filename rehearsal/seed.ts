import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { CONFIG_FILE_PATH, DEFAULT_DOCKERFILE_PATH, type Landing } from "../src/config.js";
import { ConfigError, reasonOf } from "../src/errors.js";
import { originUrl, type GitRunner } from "../src/host/git.js";
import { loadSecrets } from "../src/host/secrets.js";
import { runInitChecks } from "../src/init/init.js";
import { resourcePath } from "../src/resources.js";
import { worktreeForBranch } from "../src/sandbox/sandbox.js";
import type { GhRunner } from "../src/tracker/github.js";
import { READY_LABEL } from "../src/tracker/labels.js";
import { BASE_BRANCH, CLONE_DIR, guardRehearsalOrigin, REHEARSAL_REPO } from "./rehearsal-repo.js";
import type { Scenario, TicketId } from "./scenarios.js";

const execFileAsync = promisify(execFile);

/** The genesis state, committed in this repo so it is reviewable in a relay diff. */
const FIXTURE_DIR = join(import.meta.dirname, "..", "fixtures", "todo-app");

/** The sandbox recipe relay ships, copied in at seed time rather than committed. */
const SANDBOX_RECIPE = resourcePath("sandbox-recipes", "node.Dockerfile");

const GENESIS_MESSAGE = "The rehearsal's genesis state";

/**
 * Who genesis is authored by: the rig, not the operator. On the command rather
 * than in the clone's config, the shape the sandbox probe uses, so a host with
 * no global git identity can still seed.
 */
const GENESIS_IDENTITY = [
  "-c",
  "user.name=relay rehearsal",
  "-c",
  "user.email=rehearsal@relay.invalid",
];

/**
 * What a token that cannot do the seed's work is missing.
 *
 * Named here rather than left to `gh`'s own wording, because "HTTP 403" tells an
 * operator nothing about which permission to grant.
 */
const TOKEN_NEEDS =
  `The rehearsal's token must create ${REHEARSAL_REPO} when it is absent, push to it, and ` +
  "create labels on it: a classic token with `repo` scope, or a fine-grained token with " +
  "Administration, Contents and Issues write on that repo. Set GH_TOKEN in your environment " +
  "or in relay's own `.relay/.env`.";

/**
 * What a token that cannot delete an issue is missing.
 *
 * Its own sentence rather than a line in `TOKEN_NEEDS`, because deleting an
 * issue is the one thing the seed does that no ordinary write permission grants:
 * GitHub asks for admin on the repo, and `gh` reports the refusal as an HTTP
 * status that names nothing.
 */
const ISSUE_DELETE_NEEDS =
  `A scenario is seeded by deleting every issue in ${REHEARSAL_REPO} and creating the set ` +
  "fresh, and GitHub allows only a repository admin to delete an issue: a classic token with " +
  "`repo` scope on a repo you own, or a fine-grained token with Administration and Issues " +
  "write on it.";

/** How many issues one delete pass reads. `gh` defaults to 30. */
const ISSUE_PAGE = 100;

/** The issue numbers one seed created, which is the only way anything learns them. */
export interface SeededScenario {
  workItem: number;
  /** In the scenario's own order. */
  tickets: number[];
}

/**
 * Take the rehearsal repo from any state — absent, half-seeded, or left behind
 * by a crashed pass — to a clone sitting on the genesis commit, with the
 * scenario's work item and tickets waiting on it, and genesis declaring the
 * landing the pass over it is to take.
 *
 * Destructive by design: it force-pushes the fixture over the repo's history,
 * deletes every issue the repo had, and deletes the branches a previous pass
 * pushed. The whole protection is the slug guard, which runs before anything in
 * the clone is touched.
 *
 * Both arguments arrive resolved, from the command line that took them: nothing
 * this destructive should be reachable with a name that names nothing.
 */
export async function seedRehearsalRepo({
  scenario,
  landing,
}: {
  scenario: Scenario;
  landing: Landing;
}): Promise<SeededScenario> {
  // Resolved the way a pass resolves them, out of relay's own environment and
  // `.relay/.env`, so a rehearsal needs no second copy of a secret on disk. It
  // asks for the Claude credential too, which the seed does not use: a seed that
  // succeeded only for the rehearsal to die on a missing token afterwards is a
  // worse failure than one refused up front.
  const { githubToken } = await loadSecrets({ repoRoot: process.cwd() });

  // The label calls `init` makes infer their repo from the working directory,
  // so those have to run in the clone — and the clone may not exist yet, which
  // is why the bootstrap's own calls name the repo instead.
  const ghOnHost = ghRunner({ token: githubToken });
  const ghInClone = ghRunner({ token: githubToken, cwd: CLONE_DIR });
  const git = gitRunner(githubToken);

  await ensureRehearsalRepo(ghOnHost);
  await ensureClone(ghOnHost);
  guardRehearsalOrigin(await originUrl({ repoRoot: CLONE_DIR }));

  await git(["fetch", "--prune", "origin"]);
  await prunePassBranches(git);
  await writeGenesisTree(landing);
  await pushGenesis(git);
  await ensureLabelVocabulary({ gh: ghInClone, git });

  step(`${scenario.name}: ${CLONE_DIR} is on ${BASE_BRANCH} at genesis, landing \`${landing}\``);
  return await seedScenarioIssues({ gh: ghOnHost, scenario });
}

/**
 * Bring the tracker to the scenario: delete every issue the repo had, then
 * create the work item, its tickets, and the edges between them.
 *
 * Deleted and recreated rather than edited back to canonical, because GitHub
 * never reuses an issue number: a fixed scenario means fixed *content*, and
 * editing back would mean the seed remembering every field a pass mutates, where
 * one forgotten hold contaminates the next run.
 */
async function seedScenarioIssues({
  gh,
  scenario,
}: {
  gh: GhRunner;
  scenario: Scenario;
}): Promise<SeededScenario> {
  await deleteEveryIssue(gh);

  // Labelled ready on creation, so the item a contributor runs relay against by
  // hand is eligible the moment the seed prints its number.
  const workItem = await createIssue(gh, { ...scenario.workItem, labels: [READY_LABEL] });

  // The tickets are labelled too, the way `to-tickets` files them: they are
  // agent-grabbable by construction, so a scenario that left them bare would be
  // seeding a tracker state no repo running relay actually has. The work item is
  // created first and the frontier is oldest-first, so it still wins an auto-pick.
  const created = new Map<TicketId, number>();
  for (const ticket of scenario.tickets) {
    const number = await createIssue(gh, { ...ticket, labels: [READY_LABEL] });
    await linkSubIssue(gh, { parent: workItem, child: number });
    created.set(ticket.id, number);
  }

  // After every ticket exists, because an edge needs both of its ends.
  for (const ticket of scenario.tickets) {
    for (const blocker of ticket.blockedBy ?? []) {
      await blockIssue(gh, {
        blocked: ticketNumber(created, ticket.id),
        blocker: ticketNumber(created, blocker),
      });
    }
  }

  const tickets = [...created.values()];
  // The seed's answer to the operator, and the reason nothing in the rig
  // hardcodes an issue number.
  step(`work item #${workItem}, tickets ${tickets.map((number) => `#${number}`).join(", ")}`);
  return { workItem, tickets };
}

/**
 * Delete every issue in the rehearsal repo, so no comment, label or hold from a
 * previous run can reach the next one.
 *
 * Before anything is created, so a token without the permission fails with
 * nothing half-seeded behind it.
 */
async function deleteEveryIssue(gh: GhRunner): Promise<void> {
  let deleted = 0;
  // A page at a time until the repo has none left, rather than one page and a
  // cap: a capped delete would silently leave the oldest issues — with the
  // labels and holds a previous run left on them — and report a clean seed.
  for (let numbers = await issueNumbers(gh); numbers.length > 0; numbers = await issueNumbers(gh)) {
    for (const number of numbers) {
      await orRefuse(
        () => gh(["issue", "delete", number, "--repo", REHEARSAL_REPO, "--yes"]),
        `delete issue #${number}`,
        ISSUE_DELETE_NEEDS,
      );
    }
    deleted += numbers.length;
  }
  step(`deleted ${deleted} issue(s) from ${REHEARSAL_REPO}`);
}

/** One page of the repo's issues, open and closed alike, as issue numbers. */
async function issueNumbers(gh: GhRunner): Promise<string[]> {
  const output = await orRefuse(
    () =>
      gh([
        "issue",
        "list",
        "--repo",
        REHEARSAL_REPO,
        "--state",
        "all",
        "--limit",
        String(ISSUE_PAGE),
        "--json",
        "number",
        "--jq",
        ".[].number",
      ]),
    "list the issues in the rehearsal repo",
    TOKEN_NEEDS,
  );
  return output.split("\n").filter(Boolean);
}

async function createIssue(
  gh: GhRunner,
  { title, body, labels = [] }: { title: string; body: string; labels?: readonly string[] },
): Promise<number> {
  const url = await orRefuse(
    () =>
      gh([
        "issue",
        "create",
        "--repo",
        REHEARSAL_REPO,
        "--title",
        title,
        "--body",
        body,
        ...labels.flatMap((label) => ["--label", label]),
      ]),
    `create the issue "${title}"`,
    TOKEN_NEEDS,
  );
  return issueNumberOf(url);
}

/**
 * Link a ticket to its work item as a GitHub sub-issue, which is how relay reads
 * a work item's tickets in any repo.
 */
async function linkSubIssue(
  gh: GhRunner,
  { parent, child }: { parent: number; child: number },
): Promise<void> {
  await postEdge(gh, {
    endpoint: `issues/${parent}/sub_issues`,
    field: "sub_issue_id",
    target: child,
    what: `link #${child} to #${parent} as a sub-issue`,
  });
}

/**
 * Record one ticket as blocked by another, as a native GitHub issue dependency.
 *
 * The canonical, UI-visible representation, so relay's own eligibility check and
 * its planner read the edge the way they would in any repo — rather than a
 * `Blocked by:` line only this scenario's text carries.
 */
async function blockIssue(
  gh: GhRunner,
  { blocked, blocker }: { blocked: number; blocker: number },
): Promise<void> {
  await postEdge(gh, {
    endpoint: `issues/${blocked}/dependencies/blocked_by`,
    field: "issue_id",
    target: blocker,
    what: `record #${blocked} as blocked by #${blocker}`,
  });
}

/**
 * Post one edge between two issues.
 *
 * Both of GitHub's edge endpoints take the same shape — the issue at the far end
 * of the edge by its numeric database id, under a field of their own naming —
 * rather than the `#number` an operator reads.
 */
async function postEdge(
  gh: GhRunner,
  {
    endpoint,
    field,
    target,
    what,
  }: { endpoint: string; field: string; target: number; what: string },
): Promise<void> {
  const id = await databaseIdOf(gh, target);
  await orRefuse(
    () =>
      gh([
        "api",
        "--method",
        "POST",
        `repos/${REHEARSAL_REPO}/${endpoint}`,
        "-F",
        `${field}=${id}`,
      ]),
    what,
    TOKEN_NEEDS,
  );
}

async function databaseIdOf(gh: GhRunner, issue: number): Promise<string> {
  return await orRefuse(
    () => gh(["api", `repos/${REHEARSAL_REPO}/issues/${issue}`, "--jq", ".id"]),
    `read the database id of #${issue}`,
    TOKEN_NEEDS,
  );
}

/** The number at the end of the issue URL `gh issue create` answers with. */
function issueNumberOf(url: string): number {
  const number = Number(url.trim().split("/").pop());
  if (!Number.isInteger(number) || number <= 0) {
    throw new ConfigError(
      `\`gh issue create\` answered ${url}, which does not end in an issue number.`,
    );
  }
  return number;
}

/** The number a ticket of the scenario was created as. */
function ticketNumber(created: ReadonlyMap<TicketId, number>, id: TicketId): number {
  const number = created.get(id);
  if (number === undefined) {
    throw new ConfigError(`The scenario names a ticket \`${id}\` that it does not define.`);
  }
  return number;
}

/**
 * Create the rehearsal repo when it is absent.
 *
 * A repo that is already there is only checked, so a seed over an existing repo
 * writes nothing but genesis and is idempotent across runs.
 */
async function ensureRehearsalRepo(gh: GhRunner): Promise<void> {
  try {
    await gh(["repo", "view", REHEARSAL_REPO, "--json", "name"]);
    return;
  } catch {
    // Absent, or unreadable by this token — the create below tells them which.
  }

  step(`${REHEARSAL_REPO} is absent — creating it private`);
  await orRefuse(() => gh(["repo", "create", REHEARSAL_REPO, "--private"]), "create it");
}

/** Clone the rehearsal repo when the rig has no clone of it yet. */
async function ensureClone(gh: GhRunner): Promise<void> {
  if (existsSync(join(CLONE_DIR, ".git"))) return;
  if (existsSync(CLONE_DIR)) {
    throw new ConfigError(
      `${CLONE_DIR} exists but is not a git clone, so the seed cannot read an origin from it — ` +
        "and it destroys what it is aimed at. Delete that directory yourself, then run again.",
    );
  }

  step(`cloning ${REHEARSAL_REPO} to ${CLONE_DIR}`);
  await orRefuse(() => gh(["repo", "clone", REHEARSAL_REPO, CLONE_DIR]), "clone it");
}

/**
 * Delete the branches a pass left behind, on the clone and on the rehearsal repo.
 */
async function prunePassBranches(git: GitRunner): Promise<void> {
  await pruneLocalPassBranches(git);
  await pruneRemotePassBranches(git);
}

/**
 * Delete the pass branches in the clone, and the worktrees they are checked out in.
 *
 * A hard-killed pass leaves both, on purpose ([ADR-0003](../docs/adr/0003-a-crashed-pass-leaves-the-work-for-a-human.md)),
 * and git refuses to delete a branch that is still checked out somewhere — so a
 * crash would otherwise make the next rehearsal refuse before it starts.
 */
async function pruneLocalPassBranches(git: GitRunner): Promise<void> {
  const stale = await passBranches(git, "refs/heads");
  if (stale.length === 0) return;

  // A crashed pass may have left HEAD on one of them, and git will not delete
  // the branch HEAD names.
  await git(["checkout", "--detach"]);

  for (const branch of stale) {
    const worktree = await worktreeForBranch(CLONE_DIR, branch);
    if (worktree) await git(["worktree", "remove", "--force", worktree]);
    await git(["branch", "--delete", "--force", branch]);
    step(`pruned the pass branch ${branch}`);
  }
  await git(["worktree", "prune"]);
}

/**
 * Delete the pass branches on the rehearsal repo itself, which closes any pull
 * request opened against them.
 *
 * Every pass that pushed leaves one: a `pull-request` landing pushes on the way
 * to opening a pull request, and a blocked `merge` landing pushes to hand the
 * work over. Neither is undone by force-pushing genesis or by deleting the
 * issues, so without this a rehearsal starts with the last one's pull request
 * still open against a base branch that no longer contains its base.
 *
 * The pull request is closed as a consequence rather than by `gh pr close`:
 * GitHub closes a pull request whose head branch is deleted, so the branch is the
 * only thing that has to be named.
 */
async function pruneRemotePassBranches(git: GitRunner): Promise<void> {
  for (const branch of await passBranches(git, "refs/remotes/origin")) {
    await git(["push", "--delete", "origin", branch]);
    step(`pruned ${branch} on ${REHEARSAL_REPO}, closing any pull request on it`);
  }
}

/**
 * The pass branches under one ref namespace, named as branches rather than as
 * refs so a local and a remote one read and delete the same way.
 *
 * Every branch that is not the base one, rather than every branch under relay's
 * branch prefix: the rehearsal repo is the rig's alone and seeding destroys what
 * it holds, so anything beside `BASE_BRANCH` is a previous pass's leftover by
 * definition. Nothing here has to agree with the prefix a pass will use.
 *
 * The namespace's own depth is what is stripped, so `refs/heads/agent/42` and
 * `refs/remotes/origin/agent/42` both come back as `agent/42` — which is the name
 * `branch --delete` and `push --delete` each want. `origin/HEAD` strips to `HEAD`,
 * which is a symbolic ref rather than a branch and is dropped with the base one.
 */
async function passBranches(git: GitRunner, namespace: string): Promise<string[]> {
  const depth = namespace.split("/").length;
  const output = await git(["for-each-ref", `--format=%(refname:lstrip=${depth})`, namespace]);
  return output
    .split("\n")
    .filter(Boolean)
    .filter((branch) => branch !== BASE_BRANCH && branch !== "HEAD");
}

/**
 * Put the genesis files in the clone: the committed fixture, the sandbox recipe
 * relay ships, and a config declaring this rehearsal's landing.
 *
 * The recipe is copied rather than read from a committed copy, for the sandbox
 * probe's reason — a copy can stay green while the recipe users get breaks. The
 * fixture ignores it, so it stays out of genesis and out of `git status`.
 *
 * The config is written rather than committed because the landing is a rehearsal's
 * own argument, and it is *not* ignored: a repo running relay commits this file,
 * so genesis carries it too and the base branch a pass is cut from has the shape
 * relay demands of any target.
 */
async function writeGenesisTree(landing: Landing): Promise<void> {
  for (const entry of await readdir(CLONE_DIR)) {
    if (entry === ".git") continue;
    await rm(join(CLONE_DIR, entry), { recursive: true, force: true });
  }
  await cp(FIXTURE_DIR, CLONE_DIR, { recursive: true });
  await cp(SANDBOX_RECIPE, join(CLONE_DIR, DEFAULT_DOCKERFILE_PATH));
  await writeFile(join(CLONE_DIR, CONFIG_FILE_PATH), genesisConfig(landing), "utf8");
}

/**
 * The `.relay/config.ts` genesis carries: the landing this rehearsal was asked
 * for, and nothing else.
 *
 * Nothing else on purpose. Every other setting is left to relay's own default, so
 * a rehearsal exercises the defaults a repo running `init` gets rather than a set
 * of values chosen for the rig.
 */
function genesisConfig(landing: Landing): string {
  return `/**
 * The rehearsal's fixture repo, written by the seed rather than committed:
 * the landing is the rehearsal's own argument, not a property of the fixture.
 */
export default {
  landing: "${landing}",
};
`;
}

/**
 * Force-push the genesis tree as the base branch's one and only commit, and
 * leave the clone standing on it.
 *
 * Written with `commit-tree` rather than by committing on a branch: genesis has
 * no parent, and a rig that needed a scratch branch to make one would leave that
 * branch behind whenever a seed died between making it and renaming it.
 */
async function pushGenesis(git: GitRunner): Promise<void> {
  await git(["add", "--all"]);
  const tree = await git(["write-tree"]);
  const commit = await git([...GENESIS_IDENTITY, "commit-tree", tree, "-m", GENESIS_MESSAGE]);

  await orRefuse(
    () => git(["push", "--force", "origin", `${commit}:refs/heads/${BASE_BRANCH}`]),
    `push genesis to ${BASE_BRANCH}`,
  );

  await git(["update-ref", `refs/heads/${BASE_BRANCH}`, commit]);
  // `--force` rather than a checkout and a reset: it moves HEAD and makes the
  // index and the worktree genesis in one call, whatever state they were left in.
  await git(["checkout", "--force", BASE_BRANCH]);
}

/**
 * Create the label vocabulary by running relay's own init in the clone, so
 * every virgin-repo bootstrap re-proves init as a side effect ([ADR-0011](../docs/adr/0011-init-creates-the-label-vocabulary.md)).
 *
 * Run on every seed rather than only on the one that created the repo: init
 * keeps every label a repo already has, so this is the check the bootstrap owes
 * a repo that is already there — and a seed that died right after creating the
 * repo would otherwise leave it without a vocabulary forever.
 *
 * Whatever init wrote into the clone is then discarded: genesis is what the
 * clone's contents are for, and a `merge` landing refuses a dirty worktree.
 */
async function ensureLabelVocabulary({ gh, git }: { gh: GhRunner; git: GitRunner }): Promise<void> {
  const verdicts = await orRefuse(
    () => runInitChecks({ repoRoot: CLONE_DIR, gh }),
    "create the label vocabulary with relay's own init",
  );
  const failed = verdicts.filter(({ outcome }) => outcome !== "written" && outcome !== "kept");
  if (failed.length > 0) {
    throw new ConfigError(
      `relay init could not finish in ${CLONE_DIR}:\n` +
        failed.map(({ subject, detail }) => `  ${subject}: ${detail}`).join("\n") +
        `\n${TOKEN_NEEDS}`,
    );
  }

  step(`the label vocabulary is on ${REHEARSAL_REPO}, checked by relay's own init`);
  await git(["reset", "--hard"]);
  await git(["clean", "--force", "-d"]);
}

/**
 * `gh`, on the rehearsal's own token. The token is resolved the way a pass
 * resolves it, so a rehearsal needs no second copy of a secret on disk.
 */
function ghRunner({ token, cwd }: { token: string; cwd?: string }): GhRunner {
  return async (args) => {
    const { stdout } = await execFileAsync("gh", [...args], {
      cwd,
      env: { ...process.env, GH_TOKEN: token },
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout.trim();
  };
}

/**
 * `git` in the clone, authenticating through `gh` for the calls that reach
 * GitHub — passed per invocation rather than written into the clone's config,
 * so no token ever lands on disk.
 */
function gitRunner(token: string): GitRunner {
  return async (args) => {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", CLONE_DIR, "-c", "credential.helper=!gh auth git-credential", ...args],
      { env: { ...process.env, GH_TOKEN: token }, maxBuffer: 64 * 1024 * 1024 },
    );
    return stdout.trim();
  };
}

/** A call whose failure names the permission it needed. */
async function orRefuse<T>(
  call: () => Promise<T>,
  what: string,
  needs: string = TOKEN_NEEDS,
): Promise<T> {
  try {
    return await call();
  } catch (error) {
    throw new ConfigError(`Could not ${what}: ${reasonOf(error)}\n${needs}`);
  }
}

function step(message: string): void {
  console.log(`seed: ${message}`);
}
