# Docker sandbox image strategy

Type: grilling
Status: resolved
Blocked by: 01, 06

## Question

How does the tool provide the local Docker sandbox image for the pilot repo?

The image must run the Java/Maven build + the in-sandbox claude-code agent, carry `glab`, and expose whatever ticket 01 decides skills need. The qc-catalog spike's CI-parity image (maven:3-eclipse-temurin-21 + glab + native claude + UID/GID alignment) is a **reference** for the required deps, not a base to copy.

Constraint from ticket 06 (resolved): the final green gate is **all tests except e2e**, so the image must be able to run the **migration + integration tiers** (DB / testcontainers), not just the unit tier — the spike's unit-only exclusion no longer holds. The image ref itself is a field in the target repo's `relay.config.ts`; this ticket decides how the image is provided/built.

Decide:

- Ship a Dockerfile template in the package and `build-image` at first run, require the target repo to supply one, or reuse the team devcontainer image?
- How skill/plugin/MCP assets land in the image or get mounted (from ticket 01).
- Docker-outside-of-Docker / socket mount only if integration tests need it at the gate (pilot gate is unit-tier — likely not).

Depends on ticket 01 (skill delivery) and ticket 06 (per-repo config + gate command).

## Answer

The image is **provided two ways, prebuilt-ref-wins**, and the layers split cleanly into baked (toolchain) vs runtime-mounted (skills, MCP config, Docker socket).

**Provenance — prebuilt ref or build-from-Dockerfile.** `relay.config.ts` carries an optional prebuilt **image ref**. If set, relay uses that tag as-is and never builds (the forward path — the team will stage/publish prebuilt images). If unset, relay **builds** the image itself (via `sandcastle docker build-image`, which bakes the host UID/GID) from a Dockerfile whose **path is a config field**, defaulting to a dedicated relay path (e.g. `docker/relay.Dockerfile`) and **never the repo-root `./Dockerfile`** — relay must not collide with or hijack the app's own Dockerfile. Precedence: prebuilt ref → else build-from-path. The repo **owns its Dockerfile recipe** (CI-parity is the repo's contract); relay may ship a reference Dockerfile derived from the pilot as a starting point, but the committed, tuned file is the repo's. This makes the Dockerfile a **third committed file when a repo builds locally** (relaxing ticket 08's two-file minimum for the build-locally case); a repo pointing at a prebuilt ref keeps the two-file footprint.

**Baked into the image (rebuild to change):** JDK 21 + Maven, Node, native `claude` binary, `glab`, and — new for relay — the **`docker` CLI client** (to drive the mounted host daemon), plus AGENT_UID/GID alignment. This is the stable toolchain; the qc-catalog spike's image (`maven:3-eclipse-temurin-21` + curl/git/jq/glab/native-claude) is the deps reference, extended with the `docker` CLI.

**Bind-mounted at runtime (change without rebuild):**
- **Skills** — `kipu-code-review`, `kipu-spec-review`, `kipu-commit`(+`caveman-commit`), `tdd` read-only into `~/.claude/skills/<name>` (tickets 01/07).
- **Atlassian MCP config** — the Atlassian MCP is a **remote HTTP server**, so **nothing is baked**; relay mounts a config (an `.mcp.json` / `CLAUDE_CONFIG_DIR` mount) defining the remote server + injecting the SA bearer from `~/.config/relay/.env` (tickets 04/13). Mounted, not baked, because it carries a per-run secret and must reach the planner + both spec-review roles' cold sessions.
- **Host Docker socket** — `/var/run/docker.sock` bind-mounted in (**docker-outside-of-Docker**), because ticket 06 put the migration + integration tiers in the green gate and qc-catalog's integration tier uses **Testcontainers**, which needs a live daemon. Testcontainers spawns **sibling** containers on the host daemon; ticket 07's one-sandbox/sequential topology removes the daemon-contention downside. Chosen over privileged DinD (lighter, no privileged mode, and the Testcontainers-recommended CI-in-container pattern). Socket group/UID perms must align with the baked AGENT_UID.

**Build-time assumption / load-bearing risk (not a ticket — handed to the build).** The spike **never mounted the socket** (it ran unit-only), so "Sandcastle's `docker()` provider allows mounting `/var/run/docker.sock` and Testcontainers goes green from inside the sandbox" is **unproven**. The build effort must verify this as its **first de-risking spike** before committing to the topology — mount the socket + AGENT_UID socket perms, run one qc-catalog Testcontainers integration test green in a `docker()` sandbox. Testcontainers-via-socket is a well-trodden pattern; the only real unknown is Sandcastle's mount surface. `relay doctor` should include a socket-reachability + `docker info` check.

**Deltas to other tickets:**
- Ticket 08: two-file minimum holds only for the **prebuilt-ref** case; **build-locally adds a third committed file** (the repo's relay Dockerfile at the configured path).
- Ticket 06: `relay.config.ts` gains an optional **`image`** (prebuilt ref) field and a **`dockerfile`** path field (default `docker/relay.Dockerfile`, never repo-root); `relay doctor` gains a Docker-socket/`docker info` check.
- Tickets 01/07: the runtime mount set gains the **Atlassian MCP config mount** and the **`/var/run/docker.sock`** mount, alongside the skill mounts.
- Ticket 04: the SA bearer's injection point into the sandbox is the **mounted MCP config**; confirms the MCP transport is **remote HTTP** (no in-image server).
