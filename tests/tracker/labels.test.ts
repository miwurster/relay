import { describe, expect, it } from "vitest";
import {
  HELD_LABEL,
  missingLabels,
  PASS_LABELS,
  READY_LABEL,
  TRIAGE_LABELS,
} from "../../src/tracker/labels.js";

const names = (labels: readonly { name: string }[]) => labels.map((label) => label.name);

describe("the vocabulary", () => {
  it("carries the four labels a pass gates on and writes", () => {
    expect(names(PASS_LABELS)).toEqual([
      "ready-for-agent",
      "agent-in-progress",
      "agent-in-review",
      "agent-blocked",
    ]);
  });

  it("carries the triage labels the skills speak in, without repeating a pass label", () => {
    expect(names(TRIAGE_LABELS)).toEqual([
      "needs-triage",
      "needs-info",
      "ready-for-human",
      "wontfix",
    ]);
    expect(names(TRIAGE_LABELS)).not.toContain(READY_LABEL);
  });

  it("is the one home for the two labels the pass code reads", () => {
    expect(names(PASS_LABELS)).toContain(READY_LABEL);
    expect(names(PASS_LABELS)).toContain(HELD_LABEL);
  });

  it("gives every label a colour and a description gh will take", () => {
    for (const label of [...PASS_LABELS, ...TRIAGE_LABELS]) {
      expect(label.color).toMatch(/^[0-9A-F]{6}$/);
      expect(label.description.length).toBeGreaterThan(0);
    }
  });
});

describe("missingLabels", () => {
  it("reports every wanted label when the repo has none of them", () => {
    expect(names(missingLabels({ wanted: PASS_LABELS, existing: ["bug", "enhancement"] }))).toEqual(
      names(PASS_LABELS),
    );
  });

  it("reports nothing when the repo already has all of them", () => {
    expect(missingLabels({ wanted: PASS_LABELS, existing: names(PASS_LABELS) })).toEqual([]);
  });

  it("counts a differently-cased label as present", () => {
    const existing = ["Ready-For-Agent", "AGENT-IN-PROGRESS", "agent-in-review", "agent-blocked"];
    expect(missingLabels({ wanted: PASS_LABELS, existing })).toEqual([]);
  });

  it("reports only the ones that are absent", () => {
    const existing = ["ready-for-agent", "agent-in-review"];
    expect(names(missingLabels({ wanted: PASS_LABELS, existing }))).toEqual([
      "agent-in-progress",
      "agent-blocked",
    ]);
  });
});
