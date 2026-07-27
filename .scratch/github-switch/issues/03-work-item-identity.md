# 03 — Work-item identity: a bare number

**What to build:** an operator names a **work item** the way they happen to have it to hand, and relay runs the same **pass** either way.

`relay 42`, `relay '#42'` and a pasted GitHub issue URL all resolve to the same item.
The **pass branch** is the branch prefix plus the number, with no title slug — the branch is ephemeral and never reused, and the pull request title carries human readability.

The mechanical half: `WORK_ITEM_KEY` becomes `WORK_ITEM` in every prompt, and the word "key" leaves the vocabulary.
Doing this in one pass here is what lets 04 and 05 touch their prompts without colliding.

**Blocked by:** 02.

**Status:** ready-for-agent

- [ ] All three forms — bare number, `#`-prefixed, full issue URL — normalise to the same number, with an unparseable argument rejected before any tracker call.
- [ ] The pass branch is the prefix plus the number, and relay still refuses to reuse an existing branch.
- [ ] No prompt mentions a tracker key, and no code names one.
- [ ] `npm run verify` exits zero.
