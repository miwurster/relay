# 04 — The migration checklist follows init

**What to build:** an operator setting up a repo reads one story about how it is done, not two.

The migration checklist tells them to hand-author a config, hand-write a **sandbox recipe** from a reference Dockerfile, and copy a **tracker doc**. Once **init** exists, the first of those is a command and the doc is stale in the most damaging way — it describes work the tool now does, so an operator who follows it does init's job by hand and never learns the command exists.

The checklist becomes: run `relay init`, confirm the detected **green gate**, then the steps nothing can automate — copy the tracker doc, create the four labels, provision the one token, and verify with `relay doctor`. The tracker doc stays a manual copy: it is human-owned and human-maintained, and init never touches it.

**Blocked by:** 02, 03.

**Status:** ready-for-agent

- [ ] The checklist opens with `relay init` and says which files it writes and which it never touches.
- [ ] Confirming the detected green gate is its own explicit step, since nothing can verify that value.
- [ ] The tracker doc, the four labels, and the token remain human steps, and the doc says why each one is.
- [ ] The reference Dockerfile is described as the reference the templates follow, not as something to copy by hand.
- [ ] The doc still ends at `relay doctor`.
- [ ] `npm run verify` exits zero.
