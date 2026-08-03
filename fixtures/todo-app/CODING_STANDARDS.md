# Coding Standards

How code is written at Kipu.
These rules are normative: a reviewer can cite any of them against a diff, and an agent is expected to follow them without being asked.
They apply to every change, trivial or complex.

Out of scope: anything tooling already enforces (formatters, linters, import order).
Don't restate it here, and don't review for it.

## Simplicity

- Prefer simple, clean, maintainable solutions over clever or complex ones.
- Write the minimum code that solves the problem.
- No features beyond what was asked.
- No abstraction for single-use code.
- No flexibility or configurability that wasn't requested.
- No error handling for scenarios that cannot happen.
- If you wrote 200 lines and it could be 50, rewrite it.

## Naming and structure

- Names carry the meaning; the code documents itself.
- Keep functions small.
- One responsibility per class and per function.
- No thin wrappers, identity abstractions, or pass-through helpers that add indirection without buying clarity.
- Prefer direct, boring code over magical or implicit behaviour.

## File size

- A change must not push a file from under 1000 lines to over 1000 lines without a stated structural reason.
- When a change would cross that line, decompose first: extract helpers, submodules, or components.

## Control flow

- Don't bolt ad-hoc conditionals or special cases onto flows that don't own the concern.
- Repeated conditionals on the same thing mean a missing model or a missing helper — introduce it.
- No one-off booleans, nullable modes, or flags threaded through an existing path to serve one caller.
- Turn special cases into a simpler default flow with fewer exceptions.

## Types and boundaries

- Don't reach for the type system's escape hatch (`any`, `unknown`, `Any`, `interface{}`, casts) where a precise type or an explicit boundary would do.
- Prefer explicit models and shared contracts over loosely shaped ad-hoc objects.
- Don't use a silent fallback to paper over an unclear invariant; make the boundary explicit instead.
- Optional means genuinely optional, not "unclear yet".

## Layering and reuse

- Logic lives in the layer that owns the concept, not wherever the change started.
- Reuse the canonical helper; don't add a near-duplicate beside it.
- Keep feature-specific logic out of shared and general-purpose paths.
- Extract shared logic instead of copy-pasting it.

## Surgical changes

- Touch only what the request requires.
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor what isn't broken.
- Match the existing style of the code you're changing, even if you'd do it differently.
- Remove imports, variables, and functions that your change made unused; leave pre-existing dead code alone unless asked.
- Every changed line traces directly to the request.

## Markdown

- One sentence per line.
- Do not soft-wrap sentences across multiple lines.
