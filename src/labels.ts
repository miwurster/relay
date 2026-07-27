/**
 * One label in the vocabulary, as `gh label create` takes it. The colour and
 * description are relay's opening offer: they are used when the label is
 * created and never applied to one that already exists, so a maintainer's
 * hand-tuning survives every re-run of `relay init`.
 */
export interface LabelSpec {
  name: string;
  color: string;
  description: string;
}

/**
 * The label that marks an item as agent-grabbable. Never bypassed — the
 * frontier query filters on it and the eligibility check gates on it, so both
 * read the one constant rather than agreeing by coincidence.
 */
export const READY_LABEL = "ready-for-agent";

/** The label a running pass holds an item with. A held item is someone's run. */
export const HELD_LABEL = "agent-in-progress";

/**
 * The labels a pass gates on and writes. Nothing creates them lazily: `gh`
 * resolves every `--add-label` name against the repo's existing labels, so a
 * pass reaching for an absent one dies there rather than inventing it.
 */
export const PASS_LABELS: readonly LabelSpec[] = [
  { name: READY_LABEL, color: "0E8A16", description: "Eligible for a relay pass" },
  { name: HELD_LABEL, color: "FBCA04", description: "Held by a running pass" },
  { name: "agent-in-review", color: "1D76DB", description: "Pass finished, waiting on a human" },
  { name: "agent-blocked", color: "D93F0B", description: "Pass blocked, needs a human decision" },
];

/**
 * The labels the agent skills speak in, minus `ready-for-agent`, which is a
 * pass label. relay's own code never reads these, and `docs/agents/triage-
 * labels.md` invites a repo to rename them — so their absence is worth saying
 * out loud and never worth failing over.
 */
export const TRIAGE_LABELS: readonly LabelSpec[] = [
  { name: "needs-triage", color: "FBCA04", description: "Maintainer needs to evaluate this issue" },
  {
    name: "needs-info",
    color: "D876E3",
    description: "Waiting on reporter for more information",
  },
  { name: "ready-for-human", color: "1D76DB", description: "Requires human implementation" },
  { name: "wontfix", color: "FFFFFF", description: "Will not be actioned" },
];

/**
 * The wanted labels this repo has none of, matched case-insensitively: GitHub
 * label names are, so an existing `Ready-For-Agent` already satisfies the gate
 * and creating a second one is not possible anyway.
 */
export function missingLabels({
  wanted,
  existing,
}: {
  wanted: readonly LabelSpec[];
  existing: readonly string[];
}): LabelSpec[] {
  const present = new Set(existing.map(fold));
  return wanted.filter((label) => !present.has(fold(label.name)));
}

function fold(name: string): string {
  return name.toLowerCase();
}
