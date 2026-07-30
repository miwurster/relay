import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { DEFAULT_DOCKERFILE_PATH, loadConfig } from "../src/config.js";
import { ConfigError, reasonOf } from "../src/errors.js";
import { originUrl, type GitRunner } from "../src/host/git.js";
import { loadSecrets } from "../src/host/secrets.js";
import { runInitChecks } from "../src/init/init.js";
import { resourcePath } from "../src/resources.js";
import { worktreeForBranch } from "../src/sandbox/sandbox.js";
import type { GhRunner } from "../src/tracker/github.js";
import { BASE_BRANCH, CLONE_DIR, guardRehearsalOrigin, REHEARSAL_REPO } from "./rehearsal-repo.js";

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
 * Take the rehearsal repo from any state — absent, half-seeded, or left behind
 * by a crashed pass — to a clone sitting on the genesis commit.
 *
 * Destructive by design: it force-pushes the fixture over the repo's history.
 * The whole protection is the slug guard, which runs before anything in the
 * clone is touched. No issues are created here; the scenario's work item and
 * tickets are the next step's, and `scenario` is carried through so that step is
 * a new file rather than a new signature.
 */
export async function seedRehearsalRepo(scenario: string): Promise<void> {
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
  await writeGenesisTree();
  await pushGenesis(git);
  await ensureLabelVocabulary({ gh: ghInClone, git });

  step(`${scenario}: ${CLONE_DIR} is on ${BASE_BRANCH} at genesis`);
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
 * Delete the branches a pass left in the clone, and the worktrees they are
 * checked out in.
 *
 * A hard-killed pass leaves both, on purpose ([ADR-0003](../docs/adr/0003-a-crashed-pass-leaves-the-work-for-a-human.md)),
 * and git refuses to delete a branch that is still checked out somewhere — so a
 * crash would otherwise make the next rehearsal refuse before it starts.
 */
async function prunePassBranches(git: GitRunner): Promise<void> {
  // The prefix genesis itself declares, so what is pruned is what a pass over
  // this clone will actually create.
  const { branchPrefix } = await loadConfig(FIXTURE_DIR);
  const stale = (await localBranches(git)).filter((branch) => branch.startsWith(branchPrefix));
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

async function localBranches(git: GitRunner): Promise<string[]> {
  const output = await git(["for-each-ref", "--format=%(refname:short)", "refs/heads"]);
  return output.split("\n").filter(Boolean);
}

/**
 * Put the genesis files in the clone: the committed fixture, plus the sandbox
 * recipe relay ships.
 *
 * The recipe is copied rather than read from a committed copy, for the sandbox
 * probe's reason — a copy can stay green while the recipe users get breaks. The
 * fixture ignores it, so it stays out of genesis and out of `git status`.
 */
async function writeGenesisTree(): Promise<void> {
  for (const entry of await readdir(CLONE_DIR)) {
    if (entry === ".git") continue;
    await rm(join(CLONE_DIR, entry), { recursive: true, force: true });
  }
  await cp(FIXTURE_DIR, CLONE_DIR, { recursive: true });
  await cp(SANDBOX_RECIPE, join(CLONE_DIR, DEFAULT_DOCKERFILE_PATH));
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
async function orRefuse<T>(call: () => Promise<T>, what: string): Promise<T> {
  try {
    return await call();
  } catch (error) {
    throw new ConfigError(`Could not ${what}: ${reasonOf(error)}\n${TOKEN_NEEDS}`);
  }
}

function step(message: string): void {
  console.log(`seed: ${message}`);
}
