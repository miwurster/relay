# 03 — `relay init` writes the sandbox recipe

**What to build:** the same command now also hands the operator a **sandbox recipe** that actually runs a **pass**, instead of leaving them to reverse-engineer one from a reference Dockerfile in relay's docs.

Relay makes four demands of any image it builds, and none of them is discoverable from the repo: `gh` on `PATH` (the in-sandbox preflight fails the pass in seconds without it), the `docker` CLI (**doctor**'s daemon check needs the binary, even though Testcontainers only needs the socket), the native `claude` install, and an agent user built from the `AGENT_UID` / `AGENT_GID` build arguments relay passes on every build. That last one is the quiet killer: every convenient devcontainer base pins uid 1000 or 1001, and a macOS host is 501, so a hardcoded uid means wrong ownership on the bind-mounted worktree and a failed image-uid preflight.

Three self-contained templates ship as resources, one per language, each the kipu devcontainer recipe the platform team maintains — the language base, the shared apt block, the `airuser` / `agents` user with passwordless sudo, the source label — with the user block rewritten to take the build arguments and a relay stanza appended. Self-contained by decision: each file is meant to be read and edited as a whole by the repo that owns it, and the triplicated stanza is the price.

Language is chosen by fixed precedence — `pom.xml`, then `pyproject.toml`, then `package.json` — because a Maven repo carrying a `package.json` for lint tooling is common and the reverse is not. A polyglot repo gets a starting recipe and a one-line `FROM` edit rather than a refusal. A repo matching nothing gets no recipe and is told where to write one.

One thing to settle rather than guess: whether the image must supply an idling entrypoint itself or sandcastle provides one. The current reference recipe ends with one and the host module's comments assume the image idles. Confirm against the sandcastle source before the templates are final.

**Blocked by:** 02.

**Status:** ready-for-agent

- [ ] Three sandbox recipe templates ship as resources — Java on the Maven base, Python on the `uv` base, Node on the `node:lts` base — read through the existing resource helpers so they travel with the published package.
- [ ] Each template declares `AGENT_UID` and `AGENT_GID` build arguments and creates the agent user from them, keeping the group-reuse guard for low gids that already exist in a base image.
- [ ] Each template installs `gh`, the `docker` CLI, and the native `claude`.
- [ ] `relay init` writes the chosen template to the path the config's `dockerfile` field already defaults to, so the two files agree without an edit.
- [ ] Language is chosen by the precedence `pom.xml` > `pyproject.toml` > `package.json`, and the report says which template was chosen.
- [ ] A repo matching none of the three gets no recipe, and the report says where to write one.
- [ ] An existing recipe is kept, not overwritten, and reported as kept — independently of whether the config was written.
- [ ] The entrypoint question is settled against the sandcastle source, and the templates reflect the answer.
- [ ] The reference recipe in the docs stays consistent with the three templates.
- [ ] `npm run verify` exits zero.
