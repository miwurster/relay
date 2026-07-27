# Migrating a repo to relay

relay speaks GitHub and only GitHub — for the tracker and for the forge alike.
There is no adapter and no flag to get the old Jira/GitLab behaviour back ([ADR-0007](adr/0007-one-forge-one-tracker-no-abstraction.md)).

Work this list top to bottom in the target repo.
`relay doctor` checks the parts it can see; the rest is on you.

## 1. Replace the repo's tracker doc

Copy [`docs/issue-tracker.github.md`](issue-tracker.github.md) from this repo into the target repo as `docs/agents/issue-tracker.md`, replacing whatever is there.

Every tracker-facing leg reads that path first and assumes nothing beyond it, so a pass fails early if it is missing.

## 2. Install `gh` in place of `glab` in the sandbox Dockerfile

The target repo owns its own sandbox recipe — relay only requires that `gh` is on the image's `PATH`.
[`docs/relay.Dockerfile`](relay.Dockerfile) is the reference recipe; take its `gh` stanza if you have nothing better.

relay runs a `gh` version check inside the sandbox before the first leg, so a stale image fails in seconds rather than forty minutes in at the handover.

## 3. Delete the `jira` block from the repo config

The config schema is strict and has no replacement block: github.com is assumed.
A leftover `jira` block fails the run loudly, which is deliberate — a half-migrated repo should not start a pass.

## 4. Create the label vocabulary

A pass gates on the first two of these and writes all four, so create them in the repo before running anything:

- `ready-for-agent` — you apply it; relay runs only over items carrying it, longest-waiting first.
- `agent-in-progress` — the planner applies it, the handover removes it.
  An item carrying it is **held** and ineligible.
- `agent-in-review` — a successful pass leaves it, meaning the work is waiting on you.
- `agent-blocked` — a blocked pass leaves it, meaning the item needs a human decision.

```sh
gh label create ready-for-agent
gh label create agent-in-progress
gh label create agent-in-review
gh label create agent-blocked
```

## 5. Provision one token and set `GH_TOKEN`

One fine-grained personal access token, scoped to the target repo, with:

| Permission          | Covers                                          |
| ------------------- | ----------------------------------------------- |
| `Issues: write`     | issues, labels, comments, sub-issues, dependencies |
| `Pull requests: write` | opening the handover's pull request           |
| `Contents: write`   | pushing the pass branch                          |
| `Metadata: read`    | required alongside the above                     |

Export it as `GH_TOKEN`, or put it in relay's credential file at `~/.config/relay/.env` — the environment variable wins.
This is the only relay credential the migration adds; the Claude credential relay already needed is unchanged.
It reaches the sandbox as an environment variable and is never written to the sandbox's disk ([ADR-0005](adr/0005-secrets-travel-with-the-machine.md)).

## 6. Verify

```sh
relay doctor
```

It reports every failing check rather than the first, so one run tells you the whole state of the setup.
