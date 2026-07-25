# 06 — Sandbox image + creation + runtime mounts

**What to build:** The Docker sandbox relay runs the pass in. Image is provided **prebuilt-ref-wins**: an optional `image` ref in `relay.config.ts` is used when present; otherwise relay builds from a configurable `dockerfile` path (default `docker/relay.Dockerfile`, never repo-root). The image bakes JDK 21 + Maven, Node, native claude, glab, and the docker CLI, with UID/GID aligned. At runtime relay mounts skills (into `~/.claude/skills/<name>`), the Atlassian MCP config (remote HTTP, carrying the SA bearer), and `/var/run/docker.sock`. The sandbox opens on a fresh branch + worktree.

**Blocked by:** 01, 04

**Status:** resolved

- [x] Prebuilt `image` ref used when set; else build from `dockerfile` path (default `docker/relay.Dockerfile`, never repo-root)
- [x] Image bakes JDK21+Maven, Node, claude, glab, docker CLI; UID/GID aligned
- [x] Runtime mounts: skills, Atlassian MCP config (SA bearer), docker socket
- [x] Docker socket usable by the non-root sandbox user: pass `groups: [<socket gid as seen inside the container>]` (`--group-add`); detect the gid at runtime, don't hardcode
- [x] Set `TESTCONTAINERS_HOST_OVERRIDE` so Testcontainers reaches sibling ports on the host daemon (macOS Docker Desktop: `host.docker.internal`; Linux daemon differs — verify per host)
- [x] Worktree runs `git submodule update --init --recursive` before the build (a fresh git worktree does not populate submodules; target repos keeping generated resources in submodules fail to load otherwise)
- [x] Sandbox opens on a fresh branch + worktree

**From spike 01** (`.scratch/relay-build/spike-01/FINDINGS.md`): socket + Testcontainers + docker-outside-of-Docker proven green with UID/GID-aligned image (`USER $host_uid`, `checkImageUid`-clean), `groups:[0]` for socket access, `TESTCONTAINERS_HOST_OVERRIDE`, and worktree submodule init.

## Answer

`src/sandbox.ts` (open the pass sandbox), `src/sandbox-image.ts` (image + host detection), `src/skills.ts` (plugin resolution), `docs/relay.Dockerfile` (reference recipe).

**Image — prebuilt-ref-wins.** `resolveSandboxImage` returns a configured `image` as is; otherwise it builds `config.dockerfile` (default `docker/relay.Dockerfile`) with `--build-arg AGENT_UID/AGENT_GID` set to the host's, tagged `relay-sandbox:<repo dir>`. `resolveDockerfile` refuses a path at the repo root or one escaping the repo.

**Reference recipe verified.** `docs/relay.Dockerfile` builds green and yields JDK 21.0.11, Maven 3.9.12, Node 22, `glab` 1.109.0, docker CLI 29.6.2 and `claude` 2.1.220, with the agent user at the host UID/GID (`USER` numeric, so sandcastle's `checkImageUid` passes). The target repo commits its own copy — relay ships this as the thing to copy, not as a file it reads.

**Skills mount deviates from the checklist, per spike 02.** The ticket said `~/.claude/skills/<name>`; spike 02 resolved afterwards to *mount plugin dirs directly and pass `--plugin-dir`*, with the personal-artifact bind-mount only a fallback. So relay reads Claude's `installed_plugins.json`, resolves `kipu-all@kipu` and `caveman@caveman` to their install paths, and mounts each read-only at `/opt/relay/plugins/<name>`. Roles get the operator's installed skill version, and a by-name invocation must use the qualified `kipu-all:<skill>` form. A plugin relay cannot find is a hard `ConfigError` — no optional-plugin branching.

**MCP config carries the bearer without writing it.** The mounted `/opt/relay/mcp/atlassian.json` pins the remote `type: http` server and sets `Authorization: Bearer ${ATLASSIAN_SA_TOKEN}`; the token itself is injected as sandbox env only, so it never lands on disk. (The `${VAR}` expansion in a `--mcp-config` file is the pattern ADR-0004 proved; it is not re-proven here.)

**Detected per run, never hardcoded.** The socket's in-container gid comes from `stat` in a throwaway container off the resolved image (`--entrypoint stat`, since the image idles on `sleep infinity`) and is passed as `groups: [gid]`. Verified end to end on this host: gid `0`, and the non-root agent user then reaches server 29.6.2. `TESTCONTAINERS_HOST_OVERRIDE` is `host.docker.internal` on Docker Desktop; on a Linux daemon it falls back to the bridge network's gateway — **still unverified against a real Linux daemon**, as the ticket warned.

**Worktree + branch.** `createSandbox` opens a fresh worktree on `branchPrefix + <key>`, cut from `defaultBranch`, with `host.onWorktreeReady` running `git submodule update --init --recursive`.

**Scope notes for the next tickets.** `runPass` now opens and closes the sandbox around the existing stub log — the harness loop, branch-collision refusal and crash paths stay ticket 07's. `sandboxEnv` also injects `GITLAB_TOKEN` and the Claude credential, since sandbox env is the only injection point secrets (04) described for them. The pinned `cloudId` is *not* read here: it is a tool-call parameter for role prompts, so it belongs with the tickets that write those prompts (08/10), not in the MCP config file.
