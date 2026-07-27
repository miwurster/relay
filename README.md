# relay

**relay** runs one autonomous pass over a single work item, then passes the baton to a human.

## Why "relay"

A relay is won not by one runner but by a clean chain of them, each running a single leg and handing off the baton without breaking stride. That is exactly how this tool works.

Inside a pass, a crew of focused subagents each run their one leg — plan, implement, review, fix, quality-gate, commit — and hand the work cleanly to the next. Then the tool runs its own final, most important leg: it hands the baton to *you*. It does one thing well, brings the work to a reviewable state, and stops. No autonomy theatre, no runaway loops — just one honest leg of the race, delivered.

The name also says what the old one didn't. `relay` is not `sandcastle`, the framework it is built on — so "relay" in a sentence, or `relay` in the code, always means this tool and nothing else.

## Setting up a repo

relay runs against a GitHub repo whose issues live in that same repo.
[docs/migrating-a-repo-to-relay.md](docs/migrating-a-repo-to-relay.md) is the checklist: tracker doc, `gh` in the sandbox image, repo config, labels, and the one token.
