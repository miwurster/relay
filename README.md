# relay

**relay** runs one autonomous pass over a single work item, then passes the baton to a human.

## Why "relay"

A relay is won not by one runner but by a clean chain of them, each running a single leg and handing off the baton without breaking stride. That is exactly how this tool works.

Inside a pass, a crew of focused subagents each run their one leg — plan, implement, review, fix, quality-gate, commit — and hand the work cleanly to the next. Then the tool runs its own final, most important leg: it hands the baton to
*you*. It does one thing well, brings the work to a reviewable state, and stops. No autonomy theatre, no runaway loops — just one honest leg of the race, delivered.

The name also says what the old one didn't. `relay` is not `sandcastle`, the framework it is built on — so "relay" in a sentence, or `relay` in the code, always means this tool and nothing else.

## Getting started

relay runs against a GitHub repo whose issues live in that same repo.
It speaks GitHub and only GitHub, for the tracker and the forge alike — there is no adapter and no flag for anything else.

Work this guide top to bottom in the repo you want relay to run over.
Nothing here is undone by re-running a step, and `relay doctor` at the end tells you what is still missing.

### What you need first

- **Node 20 or newer** on your host, to run relay itself.
- **Docker**, reachable as your own user — every pass runs its legs inside a container.
- **`gh`** on your host's `PATH`, authenticated (`gh auth login`).
- **A GitHub token** with write access to the repo, as `GH_TOKEN`.
  One token covers everything: relay's own tracker calls on the host, and the `gh` running inside every sandbox.
  Step 4 says which permissions it needs and where to put it.
- **A Claude credential**, either `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`.
  Every agent leg of a pass runs on it, inside the sandbox.

### 1. Bootstrap the repo

```sh
npx @miwurster/relay init
```

`init` writes the files a repo is missing and nothing else.
It never overwrites, never stages, and never commits, so running it again only fills gaps:

- `relay.config.ts` at the repo root, carrying your `defaultBranch`.
  Every other setting has a package default; add one only when you want to override it.
- A sandbox recipe for your stack, when it recognizes the repo's build manifest.
  If it recognizes nothing it says so and leaves the recipe to you.
- One `.gitignore` line for `.sandcastle/`, where a pass cuts its git worktree.
  That path is fixed and lives inside your repo, so without the line every pass shows up in `git status` as untracked noise.

`init` refuses before writing anything if the directory is not a git repo, or if its `origin` is not GitHub.

### 2. Declare your green gate in `AGENTS.md`

The **green gate** is the one command that decides whether a branch is good — typecheck, lint, tests, whatever your repo runs.
relay does not take it as configuration.
It reads it from the docs your contributors already read, because a command that lives in a config file drifts away from the one the docs tell people to run.

Say it plainly, in a sentence, in your repo's `AGENTS.md`:

```md
`npm run verify` — typecheck, lint, tests.
It is the green gate for this repo, so a change is not done until it exits zero.
```

At the start of every pass, one cheap agent leg reads `AGENTS.md`, then `CLAUDE.md`, then `README.md` — following `@` includes — and takes the first gate a doc declares.
It confirms the command's target actually exists (a script in `package.json`, a target in the `Makefile`, a wrapper on disk).
If no doc declares a gate, or the declared one points at something that is gone, the same leg
**infers** a gate from your build manifest and runs that instead.

An inferred gate is a command nobody chose becoming the evidence that your branch is green.
Declaring the gate is the one step of this guide worth not skipping.
Either way, every handover names the command it verified with and whether it was declared or inferred, so you can see on each pass what relay accepted.

The command is resolved once per pass and reused for every attempt of the gate loop, so the runs of a red-gate pass can never disagree about what they are running.

### 3. Create the label vocabulary

Labels are a GitHub-side resource, so relay cannot create them for you.
A pass gates on the first two and writes all four:

```sh
gh label create ready-for-agent
gh label create agent-in-progress
gh label create agent-in-review
gh label create agent-blocked
```

- `ready-for-agent` — you apply it.
  relay runs only over items carrying it, longest-waiting first.
- `agent-in-progress` — the planner applies it, the handover removes it.
  An item carrying it is **held** and ineligible.
- `agent-in-review` — a successful pass leaves it, meaning the work is waiting on you.
- `agent-blocked` — a blocked pass leaves it, meaning the item needs a human decision.

### 4. Provision one token

One fine-grained GitHub personal access token, scoped to this repo:

| Permission             | Covers                                             |
|------------------------|----------------------------------------------------|
| `Issues: write`        | issues, labels, comments, sub-issues, dependencies |
| `Pull requests: write` | opening the handover's pull request                |
| `Contents: write`      | pushing the pass branch                            |
| `Metadata: read`       | required alongside the above                       |

relay reads it as `GH_TOKEN`, from your environment or from its credential file at `~/.config/relay/.env` — the environment variable wins.
Your Claude credential resolves the same way, under `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`.

```sh
# ~/.config/relay/.env
GH_TOKEN=github_pat_...
CLAUDE_CODE_OAUTH_TOKEN=...
```

This is the only GitHub token relay needs.
It is the one a pass hands to the sandbox as `GH_TOKEN` — the variable `gh` prefers — so the `gh` running inside the container acts as that token and nothing else.
There is no separate sandbox credential to name anywhere.

Secrets reach the sandbox as environment variables and are never written to its disk.
Nothing is ever read from the target repo, and no secret ships in the package.

Your host's own `gh` is a different matter: it reads your shell environment and its own login, not relay's credential file.
If you keep the token in `~/.config/relay/.env` without exporting it, run `gh auth login` on the host as well — otherwise `relay doctor`'s `gh authenticated` check has no credential to find.

### 5. Know what the sandbox can reach on your host

A pass does not run on a copy of your repo.
relay cuts a real git worktree at `.sandcastle/worktrees/<branch>` inside your clone and bind-mounts it into the container, so everything an agent writes lands on your disk as it happens.

A linked worktree cannot work without the repository it was cut from, so your clone's whole `.git` directory is mounted read-write as well.
An agent inside the sandbox can therefore reach every ref, object and hook in your clone — not only the pass branch.
In particular, a hook it wrote would run on your host the next time you ran git there.

The sandbox isolates process, network and tooling.
It does not isolate your git state.
Point relay at a clone you are willing to have written to, and treat the same repo's `GH_TOKEN` as the larger risk it is.

### 6. Verify the setup

```sh
npx @miwurster/relay doctor
```

`doctor` checks your config, the `.gitignore` line, your secrets, `gh` and its credential, the sandbox image — building it if your repo has no prebuilt one — and the Docker daemon as the non-root sandbox user.
It reports every failing check rather than the first, so one run tells you the whole state of the setup.
Exit zero means you are ready.

The `gate` check is the one worth reading closely.
It resolves your gate exactly as a pass would and prints the command it got:

- **`ok`** — the command was **declared**, and doctor names the doc it came from.
  That is the setup you want.
- **`warning`** — no doc declared a gate, so relay **inferred** one from your build manifest and doctor names it.
  Every pass on this repo will verify with that command until you declare your own.
  Fix it by doing step 2: put the sentence in `AGENTS.md`, then run `doctor` again and watch the check go `ok`.
- **`skipped`** — the config, secrets or sandbox image check failed, and resolving a gate needs all three.
  Fix those and the check runs.

A `warning` does not fail the run: an undeclared gate is imperfect, not broken, so it never touches doctor's exit code.
Exit zero with a `gate` warning still means you can run a pass.

### 7. Run your first pass

Label one issue `ready-for-agent`, pick something small, and run:

```sh
npx @miwurster/relay 42     # a specific issue
npx @miwurster/relay        # or the longest-waiting ready item
```

One pass runs one item to a reviewable state and stops: a branch pushed, a pull request opened, the tracker item commented and relabelled.
Then you review it.

The exit code says how it ended:

| Code | Meaning                                                         |
|------|-----------------------------------------------------------------|
| `0`  | reached a reviewable state, or there was nothing to do          |
| `1`  | blocked mid-flight, or bailed on an under-specified item        |
| `2`  | config, auth, infra or wrong-type error, or an unexpected crash |

relay never reuses or deletes a branch, and never lifts the `agent-in-progress` label itself.
A crashed pass therefore leaves its branch, its worktree and its hold in place, and comments on the item saying so — a re-run is refused until you clean up.
That is deliberate: the work of a pass that went wrong is yours to look at, not the next pass's to overwrite.
