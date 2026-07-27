# 01 — A pass reports the command it verified with

**What to build:** an operator reading a successful **pass**'s pull request finds out which command relay ran to call the branch green, and where that command came from.

Today green is reported as the bare sentence "The green gate is green." The **green gate**'s own detail — which does name the command — is thrown away on exit 0, so the one fact a reviewer wants is the one the **handover** cannot tell them.

This is also the prefactor the rest of the effort stands on. The gate stops reaching into config for its command and runs the one it is handed, as an answer carrying its **provenance**:

```ts
interface ResolvedGate {
  /** The command whose exit code decides green. */
  command: string;
  provenance: "declared" | "inferred";
  /** One line naming where it came from, for a human to read. */
  source: string;
}
```

Nothing resolves anything yet: the harness builds that answer from the config field, `declared`, sourced to `relay.config.ts`. Threading it through the harness rather than closing over it inside the gate is the point — the next ticket swaps the producer and touches nothing else.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] The gate role runs the command it is handed and no longer reads the config field itself.
- [ ] The harness passes the same resolved gate to every attempt of its gate loop, so a red-gate pass cannot change command between attempts.
- [ ] A green run's detail names the command that exited 0.
- [ ] The `success` outcome carries the gate's detail rather than the harness discarding it.
- [ ] A successful pass's handover reports the command and its provenance in both the tracker comment and the pull request body — not the old fixed sentence.
- [ ] A pass blocked by a red gate still reports the triage detail it does today, with the command named.
- [ ] Exit 0 still costs no agent session.
- [ ] The config field is untouched by this ticket, and a pass behaves exactly as before apart from what it reports.
- [ ] `npm run verify` exits zero.
