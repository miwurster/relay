# 04 — The planner plans from sub-issues

**What to build:** the **plan** is the breakdown a human already wrote in GitHub.

A **work item**'s sub-issues are its **tickets**, ordered so each comes after the tickets blocking it, with closed ones left out.
A work item with no sub-issues runs as its own single ticket.
An epic-shaped item is therefore the ordinary multi-ticket case, not a rejected type.

The planner still verifies and orders — it never authors, slices, splits or invents a ticket — and it still bails rather than fabricating when a ticket does not convey enough to implement.

Its one tracker write becomes labelling the item `agent-in-progress`, applied idempotently: finding the label already there is normal after a crashed pass, not an error.
The issue-type-mapping rules and the transition dance are gone.

**Blocked by:** 03.

**Status:** ready-for-agent

- [ ] A work item with sub-issues plans them in dependency order; a childless one plans as a single ticket.
- [ ] Closed sub-issues are excluded from the plan.
- [ ] The planner labels the item `agent-in-progress`, and doing so twice is a no-op rather than a failure.
- [ ] An under-specified ticket still produces a bail naming the ticket and what is missing.
- [ ] The prompt still tells the planner to read the **tracker doc** first and to assume none of it.
- [ ] `npm run verify` exits zero.
