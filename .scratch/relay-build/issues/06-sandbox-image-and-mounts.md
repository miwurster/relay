# 06 — Sandbox image + creation + runtime mounts

**What to build:** The Docker sandbox relay runs the pass in. Image is provided **prebuilt-ref-wins**: an optional `image` ref in `relay.config.ts` is used when present; otherwise relay builds from a configurable `dockerfile` path (default `docker/relay.Dockerfile`, never repo-root). The image bakes JDK 21 + Maven, Node, native claude, glab, and the docker CLI, with UID/GID aligned. At runtime relay mounts skills (into `~/.claude/skills/<name>`), the Atlassian MCP config (remote HTTP, carrying the SA bearer), and `/var/run/docker.sock`. The sandbox opens on a fresh branch + worktree.

**Blocked by:** 01, 04

**Status:** ready-for-agent

- [ ] Prebuilt `image` ref used when set; else build from `dockerfile` path (default `docker/relay.Dockerfile`, never repo-root)
- [ ] Image bakes JDK21+Maven, Node, claude, glab, docker CLI; UID/GID aligned
- [ ] Runtime mounts: skills, Atlassian MCP config (SA bearer), docker socket
- [ ] Docker socket usable by the non-root sandbox user: pass `groups: [<socket gid as seen inside the container>]` (`--group-add`); detect the gid at runtime, don't hardcode
- [ ] Set `TESTCONTAINERS_HOST_OVERRIDE` so Testcontainers reaches sibling ports on the host daemon (macOS Docker Desktop: `host.docker.internal`; Linux daemon differs — verify per host)
- [ ] Worktree runs `git submodule update --init --recursive` before the build (a fresh git worktree does not populate submodules; target repos keeping generated resources in submodules fail to load otherwise)
- [ ] Sandbox opens on a fresh branch + worktree

**From spike 01** (`.scratch/relay-build/spike-01/FINDINGS.md`): socket + Testcontainers + docker-outside-of-Docker proven green with UID/GID-aligned image (`USER $host_uid`, `checkImageUid`-clean), `groups:[0]` for socket access, `TESTCONTAINERS_HOST_OVERRIDE`, and worktree submodule init.
