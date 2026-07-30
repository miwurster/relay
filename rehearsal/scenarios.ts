import { ConfigError } from "../src/errors.js";

/**
 * How a scenario's tickets name each other, so a dependency edge reads as the
 * ticket it points at rather than as a position in an array.
 */
export type TicketId = string;

/** One issue a scenario creates. */
interface IssueText {
  title: string;
  body: string;
}

/** One of the work item's tickets, and what it waits on. */
interface ScenarioTicket extends IssueText {
  id: TicketId;
  /** The tickets that must land first, recorded as GitHub issue dependencies. */
  blockedBy?: readonly TicketId[];
}

/** One named seeded state of the rehearsal repo's tracker. */
export interface Scenario {
  workItem: IssueText;
  tickets: readonly ScenarioTicket[];
}

/**
 * The work item a `happy-path` rehearsal runs over: a due date on a todo, and
 * the two listings a due date is for.
 *
 * Three tickets, two of which need the first, so how the planner orders work is
 * observable rather than trivial. The text is written to be genuinely
 * specifiable — every behaviour a plan has to cut is pinned, and the shapes that
 * are an implementer's call are left to them — because this text is what every
 * rehearsal's planner and both review axes read.
 */
const HAPPY_PATH: Scenario = {
  workItem: {
    title: "Todos can have a due date",
    body: `## Problem

A todo carries a title and its completion, and nothing about when it is meant to be done.
So a list of forty todos says what somebody means to do and never says what is late.

## What to build

A **due date** on a todo, and the two things a due date is for: finding what is overdue, and reading a listing in the order things come due.

Three pieces, one per sub-issue:

1. The field itself, accepted where a todo is added and validated there.
2. An overdue listing, answered against a clock a caller can inject.
3. A listing ordered by due date, with the undated todos after every dated one.

Both listings need the field, so neither can start before it.

## Acceptance criteria

- [ ] A todo can be added with a due date, and one added without a due date is undated.
- [ ] An unusable due date is refused with a named error, the way an empty title is.
- [ ] The overdue listing answers the open, dated todos due before now, and nothing else.
- [ ] The clock that listing reads is injectable, so no test sleeps and no test depends on today's date.
- [ ] A listing can be asked for in due-date order, with the undated todos last.
- [ ] The glossary names every term this work item adds.
`,
  },
  tickets: [
    {
      id: "due-date-field",
      title: "Accept a due date when a todo is added",
      body: `## What to build

\`Todo\` carries a due date, and \`TodoList.add\` accepts one.

- \`Todo.dueDate\` is a \`readonly Date | undefined\`. A todo added without one is **undated**, and undated is a state of its own rather than a value waiting to be filled in.
- \`add\` takes the due date after the title, and it is optional.
- A due date that is not a usable date — an \`Invalid Date\` — is refused with a new named error from \`src/errors.ts\`, thrown before anything is added, so a refused add leaves the list exactly as it was.
- A due date in the past is accepted: a todo somebody is already late on is ordinary.
- Renaming, completing and reopening a todo leave its due date as it was. Nothing here changes a due date after the fact.

## Acceptance criteria

- [ ] Adding a todo with a due date answers a todo carrying that due date.
- [ ] Adding a todo without one answers a todo whose \`dueDate\` is \`undefined\`.
- [ ] Adding a todo with an unusable due date throws the named error and adds nothing to the list.
- [ ] Completing and renaming a todo keep the due date it was added with.
- [ ] The glossary names **due date** and **undated**.
`,
    },
    {
      id: "overdue-listing",
      title: "List the overdue todos against an injected clock",
      body: `## What to build

A listing of the todos that are late.

- Overdue is: dated, open, and due strictly before now. A todo due exactly now is not overdue yet.
- A completed todo is never overdue, however old its due date, and an undated todo is never overdue.
- The listing comes back in insertion order, like every other listing.
- The clock is injectable: a \`TodoList\` built with no clock reads the real one, and a \`TodoList\` built with a clock reads that one instead. The tests use an injected clock, so no test sleeps and none of them starts failing on a particular date.

## Acceptance criteria

- [ ] A todo due before the injected now is overdue, and one due after it is not.
- [ ] A todo due exactly at the injected now is not overdue.
- [ ] A completed todo with a past due date is not overdue.
- [ ] An undated todo is never overdue.
- [ ] The overdue listing is in insertion order.
- [ ] A \`TodoList\` built with no clock reads the real one.
- [ ] The glossary names **overdue** and the clock.
`,
      blockedBy: ["due-date-field"],
    },
    {
      id: "due-date-order",
      title: "Order a listing by due date, with the undated todos last",
      body: `## What to build

A listing can be asked for in due-date order.

- Insertion order stays the order a listing comes back in when nothing else is asked for. This adds an order; it does not replace the one that is there.
- In due-date order the soonest due date comes first, and every undated todo comes after every dated one.
- Todos sharing a due date keep their insertion order relative to each other, and so do the undated ones among themselves.
- The order is a separate question from the filter: every filter can be asked for in either order.

## Acceptance criteria

- [ ] Asked in due-date order, dated todos come back soonest first whatever order they were added in.
- [ ] Every undated todo comes after every dated one.
- [ ] Todos sharing a due date keep insertion order, and so do the undated ones.
- [ ] The \`open\` and \`completed\` filters can both be asked for in due-date order.
- [ ] A listing asked for with no order is still in insertion order.
- [ ] The glossary names **due-date order**.
`,
      blockedBy: ["due-date-field"],
    },
  ],
};

/**
 * Every scenario there is, by the name the seed is asked for.
 *
 * One entry today. The name is an argument from the first day so that an
 * `under-specified`, a `no-sub-issues` or a `red-gate` scenario is a later entry
 * here rather than a redesign of the seed.
 */
const SCENARIOS: Record<string, Scenario> = {
  "happy-path": HAPPY_PATH,
};

/**
 * The scenario by that name, or a refusal naming the ones that exist.
 *
 * Resolved before the seed touches anything, so a mistyped name costs nothing:
 * the seed's next act is to delete every issue in the rehearsal repo.
 */
export function resolveScenario(name: string): Scenario {
  const scenario = SCENARIOS[name];
  if (!scenario) {
    throw new ConfigError(
      `There is no \`${name}\` scenario. The scenarios that exist are: ` +
        `${Object.keys(SCENARIOS).join(", ")}.`,
    );
  }
  return scenario;
}
