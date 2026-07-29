---
name: code-quality-review
description: Extremely strict maintainability review of a given diff — abstraction quality, oversized files, tangled conditionals, and behaviour-preserving restructurings that make code dramatically simpler. Findings only, read-only.
---

<!--
  Ported from the `kipu-code-review` skill of the private `kipu-all` Claude plugin,
  which is itself an adaptation of the Cursor team's `thermo-nuclear-code-quality-review`
  skill (cursor-team-kit).
  Original: https://github.com/cursor/plugins/blob/main/cursor-team-kit/skills/thermo-nuclear-code-quality-review/SKILL.md
  Kudos to Cursor for the original prompt and review philosophy.
-->

# Code quality review

An unusually strict review of implementation quality, maintainability, abstraction quality, and codebase health.

**One axis only: maintainability.**
Whether the change built what was asked — spec compliance — is not this skill's question, and belongs to another lens.

## Target

The invoker supplies the diff as an **explicit range** — `git diff <base>..HEAD`, `git diff <from>..<to>`, or `git diff HEAD` for the working tree.
Never guess a range: when the invocation names none, say so and stop.

**Strictly read-only.**
Never mutate the tree, the index, `HEAD`, or a branch.
Report findings; never fix them — changing code after a review belongs to the fixer leg.

## Rubric

This is the whole rubric, and it always runs in full — there is no depth switch.

### Core prompt

Start from this seed:

> Perform a deep code quality audit of the supplied changes.
> Rethink how to structure / implement the changes to meaningfully improve code quality without impacting behavior.
> Work to improve abstractions, modularity, reduce spaghetti code, improve succinctness and legibility.
> Be ambitious: if there is a clear path to improving the implementation that involves restructuring some of the codebase, go for it.
> Be extremely thorough and rigorous.
> Measure twice, cut once.

### Code judo

Above all, be **ambitious** about structure — hunt for "code judo": behaviour-preserving restructurings that make the implementation dramatically simpler, smaller, and more direct.

- Do not stop at "this could be a bit cleaner."
  Look for reframings where whole branches, helpers, modes, or layers disappear entirely.
- Prefer deleting complexity over rearranging it.
  A refactor that merely spreads the same complexity around is not a win.
- Prefer the solution that makes the code feel inevitable in hindsight.
- Do not rubber-stamp "it works."
  If behaviour can stay the same while the structure gets meaningfully cleaner, push for the cleaner version.

### Standards

Each standard names what to flag and the remedy to push for.

1. **File size.**
   A change pushing a file from under 1k lines to over 1k is a strong smell.
   Flag it and ask whether to decompose first — extract helpers, subcomponents, or modules.
   Waive only for a compelling structural reason with the result still clearly organized.
2. **Spaghetti branching.**
   Be highly suspicious of new ad-hoc conditionals, scattered special cases, or one-off branches bolted onto unrelated flows.
   Push the logic into a dedicated abstraction, helper, state machine, or module instead of tangling an existing path.
   Treat "temporary" branching as debt that will become permanent.
3. **Magic & thin abstractions.**
   Prefer direct, boring code over hacky or magical code.
   Flag generic mechanisms that hide simple data-shape assumptions, and thin wrappers / identity / pass-through helpers that add indirection without buying clarity.
   Delete them and keep the direct flow.
4. **Type & boundary cleanliness.**
   Question unnecessary optionality, `unknown`, `any`, or cast-heavy code where a clearer type boundary could exist.
   Prefer explicit typed models over loosely-shaped ad-hoc objects.
   If a branch relies on silent fallback to paper over an unclear invariant, make the boundary explicit instead.
5. **Canonical layer.**
   Keep logic in the layer/package/module that owns the concept; call out feature logic leaking into shared paths or implementation details leaking through APIs.
   Reuse existing canonical helpers instead of near-duplicate one-offs.
   Do not normalize architectural drift.
6. **Orchestration & atomicity.**
   If independent work is serialized for no reason, ask whether it should run in parallel.
   If related updates can leave state half-applied, push for a more atomic structure.
   Flag avoidable orchestration complexity — but do not over-index on micro-optimizations.

For every meaningful change, ask: is there a code-judo move that makes this dramatically simpler, or does the diff add complexity where a better abstraction should exist?

### Fowler smell baseline

On top of the standards above, carry this fixed set of code smells from _Refactoring_ (Fowler, ch.3).
It applies even where a repo documents nothing.
Two rules bind it:

- **The repo overrides.** A documented repo standard always wins; where it endorses something the baseline would flag, suppress the smell.
- **Always a judgement call.** Each smell is a labelled heuristic ("possible Feature Envy"), never a hard violation — and, like any standard here, skip anything tooling already enforces.

Each smell reads *what it is* → *how to fix*; match it against the diff:

- **Mysterious Name** — a function, variable, or type whose name doesn't reveal what it does or holds. → rename it; if no honest name comes, the design's murky.
- **Duplicated Code** — the same logic shape appears in more than one hunk or file in the change. → extract the shared shape, call it from both.
- **Feature Envy** — a method that reaches into another object's data more than its own. → move the method onto the data it envies.
- **Data Clumps** — the same few fields or params keep travelling together (a type wanting to be born). → bundle them into one type, pass that.
- **Primitive Obsession** — a primitive or string standing in for a domain concept that deserves its own type. → give the concept its own small type.
- **Repeated Switches** — the same `switch`/`if`-cascade on the same type recurs across the change. → replace with polymorphism, or one map both sites share.
- **Shotgun Surgery** — one logical change forces scattered edits across many files in the diff. → gather what changes together into one module.
- **Divergent Change** — one file or module is edited for several unrelated reasons. → split so each module changes for one reason.
- **Speculative Generality** — abstraction, parameters, or hooks added for needs the spec doesn't have. → delete it; inline back until a real need shows.
- **Message Chains** — long `a.b().c().d()` navigation the caller shouldn't depend on. → hide the walk behind one method on the first object.
- **Middle Man** — a class or function that mostly just delegates onward. → cut it, call the real target direct.
- **Refused Bequest** — a subclass or implementer that ignores or overrides most of what it inherits. → drop the inheritance, use composition.

## Tone

Direct, serious, demanding.
Not rude, but do not soften major maintainability issues into mild suggestions.
If the code makes the codebase messier, say so.
If it missed a dramatic simplification, say that too.
Do not flood the review with low-value nits when larger structural issues exist — prefer a few high-conviction findings over a long list of cosmetic notes.

Example phrasings:

- `this pushes the file past 1k lines. can we decompose this first?`
- `this adds another special-case branch into an already busy flow. can we move this behind its own abstraction?`
- `this works, but it makes the surrounding code more spaghetti. let's keep the behavior and restructure.`
- `this abstraction isn't earning its keep. can we keep the direct flow?`
- `why the cast / optional here? can we make the boundary explicit instead?`
- `this looks like a bespoke helper for something we already have. can we reuse the canonical one?`
- `i think there's a code-judo move that makes this much simpler — can we reframe so these branches disappear?`

## Approval bar

Do not pass a diff merely because behaviour seems correct.
Report the change as blocked — unless the author clearly justifies — when it:

- preserves incidental complexity where a plausible code-judo move would delete it
- pushes a file from under 1000 lines to over 1000
- adds ad-hoc branching that tangles an existing flow
- scatters feature-specific checks across shared code
- adds an unnecessary wrapper, cast, or optionality that makes the design more indirect
- duplicates an existing canonical helper or puts logic in the wrong layer

Otherwise, leave explicit, actionable findings and push for the cleaner decomposition.
