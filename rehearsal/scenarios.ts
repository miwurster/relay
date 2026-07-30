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
 * Three tickets, two of which need the first and neither of which needs the
 * other, so how the planner orders work is observable rather than trivial.
 *
 * The work item is shaped as a `to-spec` spec and each ticket as a `to-tickets`
 * issue, because that is what a repo running relay actually files: the planner
 * and both review axes should meet the shape they will meet in the field rather
 * than one written for this fixture alone.
 *
 * Two consequences of relay's own prompts govern what goes where. The implementer
 * reads only its ticket, so every ticket is self-sufficient; the branch review
 * reads the work item, so what spans tickets is stated there. Neither carries a
 * file path or a type — the fixture's `AGENTS.md` already owns those as repo
 * standards, and restating one here would file a `standards` concern on the
 * binding `spec` axis.
 */
const HAPPY_PATH: Scenario = {
  workItem: {
    title: "Todos can have a due date",
    body: `## Problem Statement

An engineer building a todo app on this core can record what somebody means to do, and nothing about when they mean to do it.
A todo carries a title and its completion, so a list of forty todos can say what is outstanding and can never say what is late.

Every app built on this core therefore has the same two gaps, and each one has to close them itself.
An app that wants a late-first view has no way to ask which todos are late, and an app that wants the next thing due at the top of the screen has no way to ask for that order.
The only way out today is for each app to keep its own dates alongside the core's todos, and to sort and filter them in its own code — which means every app carries the same logic, and none of them agree on what "late" means.

## Solution

A **due date** on a todo, and the two things a due date is for: asking which todos are **overdue**, and asking for a listing in **due-date order**.

A due date is optional. A todo added without one is **undated**, and undated is a state of its own rather than a date that has not been supplied yet — an undated todo is never late, and it sorts after every dated one rather than first or last by accident.

An engineer integrating the core gets three things: a due date they can set when they add a todo, a listing of what is late, and an order they can ask any listing for. Each answers a question the core can answer for itself, so no app has to reimplement it and every app agrees on the answer.

What an app then does with those answers — how it renders them, when it refreshes them, whether it notifies anybody — stays the app's own business.

## User Stories

1. As an engineer building on the todo core, I want to add a todo with a due date, so that the app I build can record when something is meant to be done.
2. As an engineer building on the todo core, I want to add a todo without a due date, so that the app I build does not force a date on somebody who has not decided one.
3. As an engineer building on the todo core, I want an undated todo to be recognisably undated, so that the app I build can tell "no date yet" from any particular date.
4. As an engineer building on the todo core, I want a due date in the past to be accepted, so that the app I build can record something somebody is already late on.
5. As an engineer building on the todo core, I want an unusable due date refused the way an empty title is, so that the app I build learns about bad input in one consistent way.
6. As an engineer building on the todo core, I want a refused due date to leave the list untouched, so that the app I build never shows a todo that was not really added.
7. As an engineer building on the todo core, I want a todo's due date to survive renaming, completing and reopening it, so that the app I build does not have to restore a date the core dropped.
8. As an engineer building on the todo core, I want to ask the list which todos are overdue, so that the app I build can show what is late without scanning every todo itself.
9. As an engineer building on the todo core, I want a completed todo left out of the overdue answer however old its due date, so that the app I build does not nag somebody about work they finished.
10. As an engineer building on the todo core, I want an undated todo left out of the overdue answer, so that the app I build does not call something late that was never given a date.
11. As an engineer building on the todo core, I want a todo due exactly now treated as not yet late, so that the app I build agrees with the core about the moment something tips over.
12. As an engineer building on the todo core, I want to supply the clock the overdue answer is measured against, so that the tests of the app I build can pin "now" instead of sleeping or drifting with the calendar.
13. As an engineer building on the todo core, I want the core to read the real clock when I supply none, so that the app I build needs no wiring for the ordinary case.
14. As an engineer building on the todo core, I want to ask for a listing in due-date order, so that the app I build can put what comes due soonest at the top of the screen.
15. As an engineer building on the todo core, I want every undated todo to come after every dated one in that order, so that the app I build shows the dated work first without special-casing the rest.
16. As an engineer building on the todo core, I want todos sharing a due date to keep a stable relative order, so that the app I build does not shuffle rows between two reads of the same list.
17. As an engineer building on the todo core, I want to ask for due-date order together with any filter, so that the app I build can offer a late-first view and a soonest-first view of the same filter.
18. As an engineer building on the todo core, I want a listing I ask for with no order to come back the way it always has, so that upgrading the core does not reorder a screen I already shipped.
19. As an engineer building on the todo core, I want every term this adds named in the glossary, so that the next person to read the core learns what "undated" and "overdue" mean here rather than guessing.

## Implementation Decisions

- **The todo core is the only module that changes.** The todo, the todo list and its errors. No new module, no new layer, and no new dependency — the core stays a plain in-memory domain with a typecheck and a test run for its gate.
- **A due date is an optional property of a todo,** read-only to callers like every other property, and replaced rather than mutated when the list hands out a new todo.
- **Undated is a state, not a missing value.** Nothing downstream treats an absent due date as a date to be defaulted, substituted or coerced. Every behaviour that meets an undated todo says what it does with it.
- **A due date is validated where a todo is added,** before anything joins the list, so a refused add leaves the list exactly as it was. Invalid input is refused with a named error, per this repo's own principle.
- **The clock is a dependency of the todo list, injected when one is constructed,** and defaulting to the real clock when none is given. The overdue answer is measured against that clock rather than against the current time read at the point of use — that is what makes it testable at the seam below, and it is a publicly observable part of the API rather than an internal detail.
- **Order and filter are separate questions.** A filter says which todos a listing holds; an order says what sequence it holds them in. Every filter can be asked for in every order, so the two are independent arguments rather than a combined set of named views.
- **Insertion order remains the default.** This work item adds an order; it does not replace the one that is there. A caller asking for no particular order gets exactly what it gets today.
- **Nothing here changes a due date after the fact.** A due date is set when a todo is added and is carried unchanged from then on.
- **The glossary grows with this work item.** Every domain term this introduces is named in this repo's glossary, alongside the terms already there, in the same form. This is asked for here because the repo's standards require using the glossary's vocabulary, not extending it.

## Testing Decisions

- **A good test here states external behaviour only** — what a caller asking the todo list a question gets back. A test that reaches for a private field, asserts a call happened, or pins a message's exact wording is testing the implementation and is the wrong test.
- **There is one seam, and it is the one that already exists:** the todo list's public API, driven from this repo's test directory through the package's public exports. Every behaviour this work item adds is tested there.
- **No new seam.** The clock is injected *at* that seam, so it needs no test of its own, and neither does any comparator or predicate written along the way. A test aimed below the public API would be testing an implementation detail, which this repo's own principles rule out.
- **Prior art is the existing behaviour tests for the todo list** — the ones covering adding, renaming, completing, removing and listing. New tests sit beside them, in their style: one behaviour per test, a fresh list per test, and the refusal cases asserting both the named error and that the list did not change.
- **No test sleeps, and no test's result depends on the date it is run on.** Every test touching the overdue answer supplies its own clock. One test covers the no-clock case by asserting that a list constructed without one still works.

## Out of Scope

- **Any presentation of a due date.** No UI, no CLI, no HTTP layer, no formatting, no relative wording like "in three days". This work item delivers the questions the core can answer; how an app shows those answers is the app's.
- **Persistence.** The core stays in memory. Nothing here serialises, stores or reloads a due date.
- **Notifications and reminders.** Nothing watches the clock, and nothing is pushed when a todo comes due or goes late.
- **Recurrence.** No repeating todos, no schedules, no next-occurrence logic.
- **Timezones and calendars.** A due date is a point in time. No timezone handling, no all-day dates, no working-day arithmetic, no locale-aware parsing.
- **Changing a due date after a todo is added.** Not rescheduling, not clearing it back to undated.
- **Due dates on anything but a todo.** No lists, no groups, no projects.
- **Sorting by anything else.** No order by title, by id or by completion, and no multi-key or user-supplied ordering.

## Further Notes

The three sub-issues are a vertical slice each: the due date itself, the overdue answer, and due-date order. Both of the latter need the due date to exist, so neither can start before it — and neither needs the other.

Nothing here needs the code prepared first. A todo gains a property, a listing gains an argument, and the todo list gains a constructor dependency — each additive to what is already there.
`,
  },
  tickets: [
    {
      id: "due-date-field",
      title: "Accept a due date when a todo is added",
      body: `## What to build

A todo can be given a **due date** when it is added, so an app built on this core can record when something is meant to be done.

The due date is optional. A todo added without one is **undated** — a state of its own, not a date waiting to be supplied. An app can tell the two apart, and nothing downstream substitutes a date for an undated todo.

A due date in the past is accepted. A todo somebody is already late on is ordinary, not an error.

A due date that is not a usable point in time is refused, the way an empty title is: with a named error, before anything joins the list, so a caller whose add was refused is looking at exactly the list it had before.

Once a todo has a due date it keeps it. Renaming, completing and reopening a todo all leave its due date as it was — nothing in this ticket changes a due date after the fact.

The glossary gains the terms this introduces, in the form the terms already there use.

## Acceptance criteria

- [ ] A todo added with a due date comes back carrying that due date.
- [ ] A todo added without a due date comes back undated, distinguishably from one carrying any date.
- [ ] A todo added with a due date in the past is accepted.
- [ ] Adding a todo with an unusable due date is refused with a named error, and the list is left with nothing added.
- [ ] Renaming, completing and reopening a todo each leave its due date as it was added.
- [ ] A todo handed to a caller earlier does not gain or change a due date underneath them.
- [ ] The glossary names **due date** and **undated**.
`,
    },
    {
      id: "overdue-listing",
      title: "List the overdue todos against an injected clock",
      body: `## What to build

The list can be asked which of its todos are **overdue**, so an app built on this core can show what is late without walking every todo itself.

A todo is overdue when it is dated, still open, and due before now. Each of those three matters:

- A todo due exactly now is not overdue yet — it tips over after that moment, not at it.
- A completed todo is never overdue, however long ago it was due. An app should not nag somebody about work they finished.
- An undated todo is never overdue. Nothing was promised, so nothing is late.

The answer comes back in the order todos were added, like every other listing today.

The clock the answer is measured against is the caller's to supply. A list constructed without one reads the real clock, so the ordinary case needs no wiring; a list constructed with one is measured against that instead. This is what lets the tests pin "now" rather than sleeping or drifting with the calendar, and it is part of the public API rather than an internal detail.

The glossary gains the terms this introduces, in the form the terms already there use.

## Acceptance criteria

- [ ] A dated, open todo due before the supplied now is overdue; one due after it is not.
- [ ] A todo due exactly at the supplied now is not overdue.
- [ ] A completed todo with a long-past due date is not overdue.
- [ ] An undated todo is not overdue.
- [ ] The overdue answer comes back in the order the todos were added.
- [ ] A list constructed with no clock is measured against the real one.
- [ ] No test sleeps, and no test's result depends on the date it is run on.
- [ ] The glossary names **overdue** and the clock.
`,
      blockedBy: ["due-date-field"],
    },
    {
      id: "due-date-order",
      title: "Order a listing by due date, with the undated todos last",
      body: `## What to build

A listing can be asked for in **due-date order**, so an app built on this core can put what comes due soonest at the top of the screen.

In due-date order the soonest due date comes first. Every undated todo comes after every dated one — the dated work is what an app leads with, and an undated todo has no place among it.

The order is stable. Todos sharing a due date keep the order they were added in relative to each other, and so do the undated ones among themselves, so two reads of an unchanged list do not shuffle rows.

Order is a separate question from which todos a listing holds. Every filter the list already offers can be asked for in due-date order, so an app can offer a soonest-first view of any filter rather than of one blessed combination.

This adds an order; it does not replace the one that is there. A listing asked for with no particular order comes back in the order todos were added, exactly as it does today — an app already shipped against the current behaviour does not have its screens reordered.

The glossary gains the term this introduces, in the form the terms already there use.

## Acceptance criteria

- [ ] Asked in due-date order, dated todos come back soonest first, whatever order they were added in.
- [ ] Every undated todo comes after every dated one.
- [ ] Todos sharing a due date keep the order they were added in, and so do the undated ones among themselves.
- [ ] Each filter the list offers can be asked for in due-date order.
- [ ] A listing asked for with no order comes back in the order todos were added.
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
