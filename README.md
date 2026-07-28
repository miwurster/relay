# relay

**relay** runs one autonomous pass over a single work item, then passes the baton to a human.

Inside a pass, a crew of focused subagents each run their one leg — plan, implement, review, fix, quality-gate, commit — and hand the work cleanly to the next.
Then relay hands the baton to *you*: one item, and a stop.
Where that stop falls is your repo's to declare — at a pull request waiting on your review, or at the work already on your branch and its issues closed.
Either way, one item and a stop. No autonomy theatre, no runaway loops.

It runs against a GitHub repo whose issues live in that same repo, and speaks GitHub and only GitHub — there is no adapter and no flag for anything else.

## Quickstart

You need Node 20+, Docker, an authenticated `gh`, a repo-scoped `GH_TOKEN`, and a Claude credential (`CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`).
Secrets live in your environment or in `.relay/.env`, which `init` gives you a template for and git never sees.

```sh
npx @miwurster/relay init            # write the missing config, sandbox recipe, credential template, .gitignore lines, labels
cp .relay/.env.example .relay/.env   # then paste your tokens in
npx @miwurster/relay doctor          # check config, landing, secrets, gh, labels, sandbox image, Docker, gate
npx @miwurster/relay 42              # run a pass over issue 42
npx @miwurster/relay                 # or over the longest-waiting ready-for-agent item
```

Label an issue `ready-for-agent` to make it eligible.
See [docs/setup.md](docs/setup.md) for the full walkthrough, the token permissions, and what the sandbox can reach on your host.

## Declare how a pass lands

`landing` is the one setting relay has no default for, because it decides whether relay moves your branch.
Put it in `.relay/config.ts` — `init` writes it for you:

```ts
export default {
  landing: "merge", // or "pull-request"
};
```

**`pull-request`** — a green pass pushes its branch, opens a pull request that `Closes` each issue it built, and labels the item `agent-in-review`.
You review, you merge, GitHub closes.

**`merge`** — a green pass rebases onto the branch you are standing on, re-runs the green gate on the result, fast-forwards your branch, pushes it, and closes the issues it landed.
No pull request is opened, ever — a blocked pass pushes its branch and tells you why.
Your branch can only move forward: relay only rewrites its own pass branch, so the step that touches yours is always a fast-forward.

There is no `defaultBranch` setting.
The branch a pass is cut from, reviewed against and lands on is the one checked out in your clone when you start it, so you retarget a pass by checking out a branch ([ADR-0016](docs/adr/0016-the-base-branch-is-the-hosts-checkout.md)).
Under `merge`, that branch has to be clean and pushable — `relay doctor` says so before a pass finds out the hard way.

## Declare your green gate

The **green gate** is the one command that decides whether a branch is good.
relay does not take it as configuration — it reads it from the docs your contributors already read, because a command in a config file drifts away from the one the docs tell people to run.

Put the sentence in your `AGENTS.md`:

```md
`npm run verify` — typecheck, lint, tests.
It is the green gate for this repo, so a change is not done until it exits zero.
```

If no doc declares a gate, relay infers one from your build manifest — a command nobody chose, deciding whether your branch is green.
`relay doctor` prints which command it resolved and whether it was declared or inferred.

## Exit codes

| Code | Meaning                                                         |
|------|-----------------------------------------------------------------|
| `0`  | landed, or there was nothing to do                              |
| `1`  | blocked mid-flight, or bailed on an under-specified item        |
| `2`  | config, auth, infra or wrong-type error, or an unexpected crash |

A crashed pass leaves its branch, worktree and `agent-in-progress` hold in place and refuses a re-run until you clean up — that work is yours to look at, not the next pass's to overwrite.

## Why "relay"

A relay is won not by one runner but by a clean chain of them, each running a single leg and handing off the baton without breaking stride.
The name also says what the old one didn't: `relay` is not `sandcastle`, the framework it is built on.
