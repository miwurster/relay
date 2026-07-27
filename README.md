# relay

**relay** runs one autonomous pass over a single work item, then passes the baton to a human.

Inside a pass, a crew of focused subagents each run their one leg — plan, implement, review, fix, quality-gate, commit — and hand the work cleanly to the next.
Then relay hands the baton to *you*: one item, brought to a reviewable state, and a stop.
No autonomy theatre, no runaway loops.

It runs against a GitHub repo whose issues live in that same repo, and speaks GitHub and only GitHub — there is no adapter and no flag for anything else.

## Quickstart

You need Node 20+, Docker, an authenticated `gh`, a repo-scoped `GH_TOKEN`, and a Claude credential (`CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`).
Secrets live in your environment or in `~/.config/relay/.env`.

```sh
npx @miwurster/relay init      # write the missing config, sandbox recipe, .gitignore line, labels
npx @miwurster/relay doctor    # check config, secrets, gh, labels, sandbox image, Docker, gate
npx @miwurster/relay 42        # run a pass over issue 42
npx @miwurster/relay           # or over the longest-waiting ready-for-agent item
```

Label an issue `ready-for-agent` to make it eligible.
See [docs/setup.md](docs/setup.md) for the full walkthrough, the token permissions, and what the sandbox can reach on your host.

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
| `0`  | reached a reviewable state, or there was nothing to do          |
| `1`  | blocked mid-flight, or bailed on an under-specified item        |
| `2`  | config, auth, infra or wrong-type error, or an unexpected crash |

A crashed pass leaves its branch, worktree and `agent-in-progress` hold in place and refuses a re-run until you clean up — that work is yours to look at, not the next pass's to overwrite.

## Why "relay"

A relay is won not by one runner but by a clean chain of them, each running a single leg and handing off the baton without breaking stride.
The name also says what the old one didn't: `relay` is not `sandcastle`, the framework it is built on.
