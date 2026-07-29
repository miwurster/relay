# Scratch file

Multi-line text a skill hands to another command — a commit message, an MR body — travels through a scratch file, never inline on the command line.

- Create it with `mktemp`, which lands in `$TMPDIR`, outside the working tree, so a run leaves the tree clean.
- Write it with a shell heredoc, not the Write tool, which refuses to overwrite a stale file a prior run left behind.
- Reuse the literal path `mktemp` printed for every later call; shell variables do not survive between separate tool calls.
- Pass it as the command's file flag where one exists (`git commit -F <path>`), else as `-d "$(cat <path>)"`.
