# pnpm-testcontainers

The fixture repo the **sandbox probe** runs over.

A minimal pnpm project whose one integration test starts a Postgres container and queries it.
Nothing here is relay's source: it is a target repo, small enough to read in a minute, standing in for the repos relay actually runs passes on.

## What the probe proves with it

That a **sandbox** can run a repo's Testcontainers tier against the host daemon.
The container the test starts is a *sibling* on that daemon, not a child of the sandbox, so its published port is not on the sandbox's localhost — `TESTCONTAINERS_HOST_OVERRIDE` is the only thing that gets a client there.
`src/sandbox/docker-host.ts` calls that path proven on Docker Desktop and unverified against a Linux daemon, and this is what re-proves it on demand.

Doctor's `dockerDaemonVersionInSandbox` already checks one layer below this — that the non-root sandbox user can reach the socket at all.
The probe is the layer above: a real container, a real published port, a real query.

## Running it

From the repo root:

```sh
npm run test:sandbox
```

Needs Docker, network on two axes (npm registry for the install, Docker registry for `postgres:17-alpine`), and the `mattpocock-skills@claude-plugins-official` plugin installed on the host — `openSandbox` mounts it, even though the probe spends no Claude session.

By hand, outside a sandbox, to check the fixture itself is sane:

```sh
pnpm install --frozen-lockfile && pnpm verify
```

## Reading a failure

The probe runs two commands in the sandbox, and which one failed is the diagnosis:

- **`pnpm install --frozen-lockfile` failed** — the probe is broken, not the sandbox. A stale `pnpm-lock.yaml`, or no route to the npm registry.
- **`pnpm verify` failed** — the sandbox could not reach the sibling container. The wrong `TESTCONTAINERS_HOST_OVERRIDE`, a socket group the sandbox user is not in, or a daemon that cannot publish ports.
- **`pnpm verify` was green but the marker was missing** — the test never ran. Vitest matched no file, or the test was skipped. Green here would be a lie, which is why the probe greps.

A failed probe **keeps its temp directory** and prints the path.
That directory is yours to read and yours to delete — the same reason a crashed pass leaves its work behind ([ADR-0003](../../docs/adr/0003-a-crashed-pass-leaves-the-work-for-a-human.md)).

A leaked `postgres:17-alpine` container should not happen: Ryuk stays enabled, and reaping through the same socket is part of what a sibling-container setup has to prove.

## Why the probe is not in `npm run verify`

relay's own green gate runs *inside* a sandbox during a pass over this repo.
A sandbox-opening test inside that gate would nest — a container opening a container to prove containers work — and every leg of every pass would pay an image build for it.
So the probe sits outside the gate and outside CI, and is hand-run.

The cost is honest: it rots unless someone runs it. Run it when you touch `src/sandbox/**` or a sandbox recipe.

## What is committed and what is not

- **Committed**: `package.json`, `pnpm-lock.yaml` (so an install is reproducible rather than resolving fresh), `postgres.test.ts`, `.relay/config.ts`.
- **Not committed**: `.relay/Dockerfile`. The probe copies it from `src/resources/sandbox-recipes/node.Dockerfile` at setup, because proving *the recipe relay ships* is part of the job — a committed copy could rot green while the shipped one broke.
- **No `packageManager` field** in `package.json`. The image bakes pnpm, and a pin would send Corepack fetching a different one inside the sandbox.
