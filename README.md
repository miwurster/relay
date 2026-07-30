# relay

**relay** runs one autonomous pass over a single work item, then stops for a human.

Inside a pass, a crew of focused subagents each run one leg — plan, implement, review, fix, quality-gate, commit.
Where the pass stops is your repo's to declare: at a pull request waiting on your review, or at the work already on your branch with its issues closed.

relay runs against a GitHub repo whose issues live in that same repo, and speaks GitHub only.

## Quickstart

Requirements: Node 20+, Docker, an authenticated `gh`, a repo-scoped `GH_TOKEN`, a Claude credential (`CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`), and the `mattpocock-skills@claude-plugins-official` plugin installed on your host.
Secrets live in your environment or in `.relay/.env`, which git never sees.

```sh
npx @miwurster/relay init            # write the missing config, sandbox recipe, credential template, .gitignore lines, labels
cp .relay/.env.example .relay/.env   # then paste your tokens in
npx @miwurster/relay doctor          # check config, landing, secrets, plugins, tracker doc, gh, labels, sandbox image, Docker, gate
npx @miwurster/relay 42              # run a pass over issue 42
npx @miwurster/relay                 # or over the longest-waiting ready-for-agent item
```

Label an issue `ready-for-agent` to make it eligible.
See [docs/setup.md](docs/setup.md) for the full walkthrough, the token permissions, and what the sandbox can reach on your host.

## Declare how a pass lands

`landing` has no default.
Put it in `.relay/config.ts` — `init` writes it for you:

```ts
export default {
  landing: "merge", // or "pull-request"
};
```

**`pull-request`** — a green pass pushes its branch, opens a pull request that `Closes` each issue it built, and labels the item `agent-in-review`.
You review, you merge, GitHub closes.

**`merge`** — a green pass rebases onto the branch you are standing on, re-runs the green gate on the result, fast-forwards your branch, pushes it, and closes the issues it landed.
No pull request is opened; a blocked pass pushes its branch and tells you why.
relay only rewrites its own pass branch, so the step that touches yours is always a fast-forward.

The branch a pass is cut from, reviewed against and lands on is the one checked out in your clone when you start it — retarget a pass by checking out a branch.
There is no `defaultBranch` setting.
Under `merge`, that branch must be clean and pushable; `relay doctor` checks this.

## Declare your green gate

The **green gate** is the one command that decides whether a branch is good.
relay reads it from your docs, not from configuration.

Put the sentence in your `AGENTS.md`:

```md
`npm run verify` — typecheck, lint, tests.
It is the green gate for this repo, so a change is not done until it exits zero.
```

If no doc declares a gate, relay infers one from your build manifest.
`relay doctor` prints which command it resolved and whether it was declared or inferred.

## Exit codes

| Code | Meaning                                                         |
|------|-----------------------------------------------------------------|
| `0`  | landed, or there was nothing to do                              |
| `1`  | blocked mid-flight, or bailed on an under-specified item        |
| `2`  | config, auth, infra or wrong-type error, or an unexpected crash |

A crashed pass leaves its branch, worktree and `agent-in-progress` hold in place and refuses a re-run until you clean up.
