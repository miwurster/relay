# Setting relay up

The long form of the README's quickstart.
Work it top to bottom in the repo you want relay to run over.
Nothing here is undone by re-running a step, and `relay doctor` at the end tells you what is still missing.

relay runs against a GitHub repo whose issues live in that same repo.
It speaks GitHub and only GitHub, for the tracker and the forge alike — there is no adapter and no flag for anything else.

## What you need first

- **Node 20 or newer** on your host, to run relay itself.
- **Docker**, reachable as your own user — every pass runs its legs inside a container.
- **`gh`** on your host's `PATH`, authenticated (`gh auth login`).
- **A GitHub token** with write access to the repo, as `GH_TOKEN`.
  One token covers everything: relay's own tracker calls on the host, and the `gh` running inside every sandbox.
- **A Claude credential**, either `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`.
  Every agent leg of a pass runs on it, inside the sandbox.

## 1. Bootstrap the repo

```sh
npx @miwurster/relay init
```

`init` writes the files a repo is missing and nothing else.
It never overwrites, never stages, and never commits, so running it again only fills gaps:

- `.relay/config.ts`, carrying your `defaultBranch`.
  Every other setting has a package default; add one only when you want to override it.
- `.relay/Dockerfile`, a sandbox recipe for your stack, when it recognizes the repo's build manifest.
  If it recognizes nothing it says so and leaves the recipe to you.
- `.relay/.env.example`, the template you copy to `.relay/.env` and paste your tokens into.
  The example only — `init` never writes the credential file itself, and step 4 is where you fill it in.
- `.relay/.gitignore`, carrying `.env`, so the credential file can never be committed from any clone.
- One `.gitignore` line for `.sandcastle/`, where a pass cuts its git worktree.
  That path is fixed and lives inside your repo, so without the line every pass shows up in `git status` as untracked noise.

Everything written lives in `.relay/`, a directory relay owns, so nothing of relay's lands in a namespace your repo owns ([ADR-0013](adr/0013-relay-owns-a-dot-directory-in-the-target-repo.md)).
Commit all of it except `.relay/.env`, which is yours alone and which `.relay/.gitignore` keeps out of git.

`init` refuses before writing anything if the directory is not a git repo, or if its `origin` is not GitHub.

## 2. Declare your green gate in `AGENTS.md`

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
If no doc declares a gate, or the declared one points at something that is gone, the same leg **infers** a gate from your build manifest and runs that instead.

An inferred gate is a command nobody chose becoming the evidence that your branch is green.
Declaring the gate is the one step worth not skipping.
Either way, every handover names the command it verified with and whether it was declared or inferred.

The command is resolved once per pass and reused for every attempt of the gate loop, so the runs of a red-gate pass can never disagree about what they are running.

## 3. The label vocabulary

A pass gates on the first two labels and writes all four:

- `ready-for-agent` — you apply it.
  relay runs only over items carrying it, longest-waiting first.
- `agent-in-progress` — the planner applies it, the handover removes it.
  An item carrying it is **held** and ineligible.
- `agent-in-review` — a successful pass leaves it, meaning the work is waiting on you.
- `agent-blocked` — a blocked pass leaves it, meaning the item needs a human decision.

All four have to exist in the repo before the first pass.
Nothing creates them lazily: `gh` resolves every `--label` and `--add-label` name against the repo's existing labels and fails the whole call with `'agent-in-progress' not found` when a name is missing, so a pass that reaches for an absent label dies there rather than inventing it.

`relay init` creates them for you, through your own `gh` and against the repo `gh` resolves this clone to.
It also creates the four triage labels the agent skills speak in — `needs-triage`, `needs-info`, `ready-for-human`, `wontfix` — which `docs/agents/triage-labels.md` maps the roles to.

A label the repo already has is kept, never `--force`d: relay fills the gaps in your vocabulary and never restates a colour or description you chose.
Names match case-insensitively, so an existing `Ready-For-Agent` already satisfies the gate, and `wontfix` ships with every new GitHub repo and so is normally reported as kept.
`relay doctor` reports a missing pass label as a failure and a missing triage label as a warning.

Init reports each label as written, kept, skipped or failed, and never stops over one.
A host with no `gh`, or no credential GitHub accepts, has its labels skipped and its files written anyway.
If you would rather create them by hand, or a token without write access left init unable to:

```sh
gh label create ready-for-agent   --color 0E8A16 --description "Eligible for a relay pass" --force
gh label create agent-in-progress --color FBCA04 --description "Held by a running pass" --force
gh label create agent-in-review   --color 1D76DB --description "Pass finished, waiting on a human" --force
gh label create agent-blocked     --color D93F0B --description "Pass blocked, needs a human decision" --force

gh label create needs-triage    --color FBCA04 --description "Maintainer needs to evaluate this issue" --force
gh label create needs-info      --color D876E3 --description "Waiting on reporter for more information" --force
gh label create ready-for-human --color 1D76DB --description "Requires human implementation" --force
gh label create wontfix         --color FFFFFF --description "Will not be actioned" --force
```

Colours and descriptions are yours; only the names matter.
`--force` there is yours to use — it overwrites an existing label's colour and description, which is exactly what `relay init` will not do.

## 4. Provision one token

One fine-grained GitHub personal access token, scoped to this repo:

| Permission             | Covers                                             |
|------------------------|----------------------------------------------------|
| `Issues: write`        | issues, labels, comments, sub-issues, dependencies |
| `Pull requests: write` | opening the handover's pull request                |
| `Contents: write`      | pushing the pass branch                            |
| `Metadata: read`       | required alongside the above                       |

relay reads it as `GH_TOKEN`, from your environment or from the **credential file** at `.relay/.env` in this repo — the environment variable wins.
Your Claude credential resolves the same way, under `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`.

`init` writes `.relay/.env.example` and never the credential file itself, so filling it in is yours:

```sh
cp .relay/.env.example .relay/.env
```

```sh
# .relay/.env
GH_TOKEN=github_pat_...
CLAUDE_CODE_OAUTH_TOKEN=...
```

The credential file is per-repo, so a repo you point relay at can carry its own token rather than one token reaching every repo on your machine ([ADR-0014](adr/0014-credentials-live-in-the-target-repo-gitignored.md)).
`init` also writes `.relay/.gitignore` carrying `.env`, and `relay doctor` fails outright if git does not ignore the credential file — a committed token is the one setup mistake relay will not run past.
If it is already committed, rotate the tokens.

CI needs no file at all: real environment variables win over the credential file, so exporting `GH_TOKEN` and a Claude credential is enough.

This is the only GitHub token relay needs.
It is the one a pass hands to the sandbox as `GH_TOKEN` — the variable `gh` prefers — so the `gh` running inside the container acts as that token and nothing else.
There is no separate sandbox credential to name anywhere.

Secrets reach the sandbox as environment variables and are never written to its disk.
The credential file is read on the host, and no secret ships in the package.

Your host's own `gh` is a different matter: it reads your shell environment and its own login, not relay's credential file.
If you keep the token in `.relay/.env` without exporting it, run `gh auth login` on the host as well — otherwise `relay doctor`'s `gh authenticated` check has no credential to find.

## 5. Know what the sandbox can reach on your host

A pass does not run on a copy of your repo.
relay cuts a real git worktree at `.sandcastle/worktrees/<branch>` inside your clone and bind-mounts it into the container, so everything an agent writes lands on your disk as it happens.

A linked worktree cannot work without the repository it was cut from, so your clone's whole `.git` directory is mounted read-write as well.
An agent inside the sandbox can therefore reach every ref, object and hook in your clone — not only the pass branch.
In particular, a hook it wrote would run on your host the next time you ran git there.

The sandbox isolates process, network and tooling.
It does not isolate your git state.
Point relay at a clone you are willing to have written to, and treat the same repo's `GH_TOKEN` as the larger risk it is.

## 6. Verify the setup

```sh
npx @miwurster/relay doctor
```

`doctor` checks your config, the `.gitignore` line, that git ignores your credential file, your secrets and where each one resolved from, `gh` and its credential, the sandbox image — building it if your repo has no prebuilt one — and the Docker daemon as the non-root sandbox user.
The secrets line names variables and never values, so it is safe to paste into an issue.
It reports every failing check rather than the first, so one run tells you the whole state of the setup.
Exit zero means you are ready.

The `gate` check is the one worth reading closely.
It resolves your gate exactly as a pass would and prints the command it got:

- **`ok`** — the command was **declared**, and doctor names the doc it came from.
  That is the setup you want.
- **`warning`** — no doc declared a gate, so relay **inferred** one from your build manifest and doctor names it.
  Every pass on this repo will verify with that command until you declare your own.
  Fix it by doing step 2, then run `doctor` again and watch the check go `ok`.
- **`skipped`** — the config, secrets or sandbox image check failed, and resolving a gate needs all three.
  Fix those and the check runs.

A `warning` does not fail the run: an undeclared gate is imperfect, not broken, so it never touches doctor's exit code.
Exit zero with a `gate` warning still means you can run a pass.

## 7. A crashed pass is yours to clean up

relay never reuses or deletes a branch, and never lifts the `agent-in-progress` label itself.
A crashed pass therefore leaves its branch, its worktree and its hold in place, and comments on the item saying so — a re-run is refused until you clean up.
That is deliberate: the work of a pass that went wrong is yours to look at, not the next pass's to overwrite.
