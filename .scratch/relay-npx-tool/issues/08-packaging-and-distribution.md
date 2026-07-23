# Packaging and distribution as an npx tool

Type: grilling
Status: open
Blocked by: 02

## Question

How does the tool become a distributable `@quantum-hub/relay` runnable via `npx` in any target repo — built from scratch on the author's templates?

The qc-catalog spike lived as a per-repo `.sandcastle/` copy run via `npx tsx`; the new tool inverts that into one published package. Build on the author's project structure + bootstrap, not the spike.

Decide:

- The `bin` entry and CLI contract: `npx @quantum-hub/relay [WORK-ITEM]`, no-param auto-pick, Task→`error`, exit codes.
- How prompts / Dockerfile / orchestration assets ship inside the package and resolve at runtime against the *target* repo's working directory (they are no longer co-located in the repo).
- Compiled `dist` vs shipped `tsx` sources; Node engine range; `@ai-hero/sandcastle` as dependency.
- What (if anything) must still be dropped into a target repo vs fully carried by the package.

Depends on ticket 02 (what the `sandcastle` CLI / templates provide).
