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

/**
 * One or more of something, in the type rather than checked for.
 *
 * The rig has scenarios and a seed creates some: neither an empty set of them nor
 * an empty answer to one means anything, so saying so here is what lets the
 * callers read the first entry without handling a case that cannot arise.
 */
export type OneOrMore<T> = readonly [T, ...T[]];

/** One named seeded state of the rehearsal repo's tracker. */
export interface Scenario {
  /** What the rig is asked for on the command line, and what a digest is filed under. */
  name: string;
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
  name: "happy-path",
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
 * The work item a `bug-report` rehearsal runs over: the id collision genesis
 * carries, reported the way a repo files a bug it has already diagnosed.
 *
 * One ticket and no sub-issues, so the work item is its own single ticket. That
 * is what a repo actually files for a bug — nobody opens a sub-issue under one —
 * and it is the only scenario that exercises relay's fallback where an item with
 * no sub-issues becomes the ticket.
 *
 * Diagnosed rather than symptom-only: the planner refuses an under-specified work
 * item, and a report that named only the symptom would rehearse that refusal
 * rather than the work. What distinguishes this from `single-spec` is therefore
 * not how much it says but what it asks for — a change to behaviour that already
 * exists, pinned by a regression test, rather than behaviour that is new.
 *
 * The defect it names is real and permanent in the fixture ([ADR-0030](../docs/adr/0030-genesis-carries-a-latent-defect.md)),
 * so the pass can reproduce it, and no comment in the fixture marks it — the
 * ticket is the only thing that says it is a bug.
 */
const BUG_REPORT: Scenario = {
  name: "bug-report",
  workItem: {
    title: "Adding a todo after removing one silently destroys a todo",
    body: `## Problem Statement

An engineer building on this todo core loses their users' data, and the core reports success while doing it.

Remove any todo from a list, then add another, and one of the todos that was already there is gone.
Nothing throws. The listing simply comes back one todo shorter than it should, with a todo the caller never removed missing from it.

This is as bad as a bug in this core gets. An app built on it cannot trust a listing after a remove, and the loss is silent — there is no error to catch, no return value to check, and nothing in the listing that says a todo used to be there. An engineer meeting this in production sees a user report that a todo "disappeared" and has nothing in their own app to blame.

The narrower harm is that ids are not unique, which the **todo list** is the only thing that promises. Two todos can be handed out carrying the same id, so a caller holding an id from before an add can read, rename, complete or remove a todo that is not the one they meant.

## Solution

The **todo list** hands out an id that has never been used by that list, whatever has been removed from it.

An id is spent once. A todo that is removed does not release its id back, and a todo added after a remove gets an id no todo in that list has ever carried. Adding a todo therefore only ever adds one: nothing already in the list is replaced, moved or lost, and **insertion order** is untouched.

An engineer gets back the promise the core is supposed to make — the list is the only thing that invents an id, and the id it invents is new.

## User Stories

1. As an engineer building on the todo core, I want adding a todo after removing one to leave every remaining todo in place, so that the app I build does not lose a user's data.
2. As an engineer building on the todo core, I want an add to only ever add, so that the app I build can trust that a listing grows by exactly one.
3. As an engineer building on the todo core, I want every id the list hands out to be one it has never handed out before, so that the app I build can hold an id and know which todo it names.
4. As an engineer building on the todo core, I want a removed todo's id never to be handed to another todo, so that an id the app I build still holds cannot come to name somebody else's todo.
5. As an engineer building on the todo core, I want many removes and adds interleaved to keep the list correct, so that the app I build survives a user working through a long list.
6. As an engineer building on the todo core, I want removing every todo and adding again to work, so that the app I build handles a list emptied and reused.
7. As an engineer building on the todo core, I want insertion order untouched by the fix, so that a screen I already shipped does not reorder.
8. As an engineer building on the todo core, I want a refused add still to spend no id, so that the fix does not trade one leak for another.
9. As an engineer building on the todo core, I want this locked down by a test, so that the next change to how ids are minted cannot bring the data loss back.

## Diagnosis

Already done, and reproduced. Recorded here so the fix does not start from scratch.

**Minimal reproduction.** Add three todos, remove the first, add a fourth. The listing comes back with three todos rather than four, and the *third* todo added is the one missing.

**Root cause.** The **todo list** mints an id from how many todos it currently holds rather than from a count of how many it has ever minted. Removing a todo lowers that number, so the next add mints an id that a todo still in the list is already using — and storing it overwrites that todo rather than adding beside it. The overwrite is what loses the data; the duplicate id is what causes the overwrite.

**Why no test caught it.** Every existing test either adds without removing or removes without adding afterwards, so nothing exercises the one ordering that collides. The gate is green on the defect.

**Where the regression test goes.** The seam that already exists: the todo list's public API, driven from this repo's test directory through the package's public exports, beside the tests for adding and removing. No new seam — the bug is reachable from a caller, so a test that reached below the public API would be pinning the implementation instead of the behaviour.

## Implementation Decisions

- **The todo core is the only module that changes.** No new module, no new dependency, no new error.
- **Minting an id is the one thing being fixed.** It is the sole cause, and the surrounding behaviour — where a todo is stored, how a listing is filtered, how a rename or a complete replaces a todo — is correct and is not touched.
- **An id is never reused within a list.** The list needs to know how many ids it has spent, which is not the same number as how many todos it holds. Nothing outside the list can see the difference, so this stays private to it.
- **A refused add still spends no id.** That behaviour is already correct and already tested; the fix must keep it.
- **No change to the shape of an id.** It stays the string it is today, so nothing a caller has stored becomes unreadable.
- **No migration, no compatibility concern.** The list is in memory and lives no longer than the process.

## Testing Decisions

- **A good test here states external behaviour only** — what a caller adding and removing todos sees in the listing they get back. A test that reads a private counter is testing the implementation and is the wrong test.
- **The regression test is written before the fix** and watched to fail, so what it pins is the defect rather than the code that replaced it.
- **One seam:** the todo list's public API, through the package's public exports.
- **Prior art is the existing behaviour tests for adding and removing** — new tests sit beside them, in their style: one behaviour per test, a fresh list per test.
- **The interleaved case is tested as well as the minimal one,** because the minimal repro is two operations and the harm an app meets is many.

## Out of Scope

- **Any other property of an id.** Not its shape, not making it a UUID, not making it unguessable, not making it unique across two lists.
- **Recovering a todo an earlier version of this core already destroyed.** Nothing here restores lost data.
- **Persistence.** The core stays in memory.
- **Any new behaviour on the todo list.** No new method, no new filter, no new order. This work item fixes what is there.
- **Refactoring the todo list.** Only the defect and its regression test.

## Further Notes

This is one ticket and has no sub-issues: the cause is one expression, and splitting the regression test from the fix would mean committing a red gate.
`,
  },
  tickets: [],
};

/**
 * The work item a `single-spec` rehearsal runs over: searching todos by their
 * title text.
 *
 * The counterpart to `bug-report` — the same one-ticket, no-sub-issue shape, over
 * new behaviour rather than a defect, so the two together say whether the crew
 * builds and fixes equally well at that size.
 *
 * Read-only on purpose. A spec that removed todos would trip the defect genesis
 * carries for `bug-report`, and the implementer's own tests would go red for a
 * reason its ticket never mentions — which reads in a digest as a role behaving
 * badly rather than as two scenarios colliding.
 */
const SINGLE_SPEC: Scenario = {
  name: "single-spec",
  workItem: {
    title: "Find the todos whose title contains some text",
    body: `## Problem Statement

An engineer building a todo app on this core can ask for all the todos, the open ones or the completed ones, and can never ask for the ones that are *about* something.

A list of forty todos has no way to answer "which of these mention milk". The **filter** the core offers says whether a todo is done, never what it is about, so an app that wants a search box has to fetch every todo and match the text itself.

Every app built on this core therefore writes the same matching code, and none of them agree on the answer. One trims the query and another does not; one matches case-insensitively and another does not; one treats an empty box as "everything" and another as "nothing". Two apps on the same core give a user two different search results.

## Solution

A **search** on the **todo list**: ask it for the todos whose **title** contains some text, and it answers a **listing** of them.

The matching is deliberate rather than incidental. Case is ignored, so somebody typing "milk" finds a todo titled "Buy Milk". The text searched for is trimmed the way a title is, so a stray space from a keyboard or a paste does not change the answer. Text that is empty once trimmed matches nothing rather than everything — an app with an empty search box is not searching, and a search that answered the whole list would be a filter wearing a search's name.

Search says which todos a listing holds, so it composes with the **filter** that already does: an app can search the open todos, or the completed ones, or all of them, rather than one blessed combination.

An engineer gets one answer to "which todos are about this", the same answer in every app built on the core.

## User Stories

1. As an engineer building on the todo core, I want to ask for the todos whose title contains some text, so that the app I build can offer a search box without matching titles itself.
2. As an engineer building on the todo core, I want a match anywhere in the title to count, so that somebody searching for a word in the middle of a todo still finds it.
3. As an engineer building on the todo core, I want case ignored, so that somebody typing in lower case finds a todo they capitalised.
4. As an engineer building on the todo core, I want the text I search for trimmed, so that a stray space from a paste does not change what the app I build shows.
5. As an engineer building on the todo core, I want text that is empty once trimmed to match nothing, so that the app I build shows an empty result for an empty search box rather than the whole list.
6. As an engineer building on the todo core, I want a search that matches nothing to answer an empty listing, so that the app I build can say "no results" without treating it as an error.
7. As an engineer building on the todo core, I want to search together with any filter, so that the app I build can offer search within the open todos and within the completed ones.
8. As an engineer building on the todo core, I want a search answered in insertion order like every other listing, so that the app I build does not have to sort what comes back.
9. As an engineer building on the todo core, I want a search to answer a fresh listing, so that a later add does not appear in results the app I build already rendered.
10. As an engineer building on the todo core, I want a search to change nothing about the list, so that the app I build can search as often as it likes.
11. As an engineer building on the todo core, I want the listings I ask for today to be unaffected, so that upgrading the core does not change a screen I already shipped.
12. As an engineer building on the todo core, I want the term this adds named in the glossary, so that the next person to read the core learns what "search" means here rather than guessing.

## Implementation Decisions

- **The todo core is the only module that changes.** The todo list. No new module, no new layer, no new dependency, and no new error — the core stays a plain in-memory domain with a typecheck and a test run for its gate.
- **Search is a question the todo list answers,** alongside the listing it already answers, rather than a helper a caller composes for itself.
- **Matching is on the title alone.** Nothing else about a todo is searched.
- **Case is folded on both sides** before matching, so neither the stored title nor the text searched for is privileged.
- **The text searched for is trimmed,** and text that is empty once trimmed matches nothing. This is a deliberate answer rather than an error: an empty search is refused nothing, it simply finds nothing, so no new named error is added.
- **Search and filter are separate questions,** and independently askable. Search says which todos match some text; a filter says which are open or completed. Every filter can be searched within.
- **Insertion order is what a search answers in.** This work item adds no order.
- **A search is read-only.** It creates no todo, changes none, and removes none.
- **The listings the core already answers are unchanged.** A caller asking for a listing today gets exactly what it gets now.
- **The glossary grows with this work item.** The term this introduces is named in the repo's glossary, alongside the terms already there, in the same form. This is asked for because the repo's standards require using the glossary's vocabulary, not extending it.

## Testing Decisions

- **A good test here states external behaviour only** — what a caller asking the todo list for a search gets back. A test that reaches for a private field or pins a message's wording is testing the implementation and is the wrong test.
- **There is one seam, and it already exists:** the todo list's public API, driven from this repo's test directory through the package's public exports. Every behaviour this work item adds is tested there.
- **No new seam.** Any matching predicate written along the way is reached through that API and needs no test of its own.
- **Prior art is the existing tests for listing todos** — the ones covering the filters and insertion order. New tests sit beside them, in their style: one behaviour per test, a fresh list per test.
- **Every decision above is tested,** the empty-once-trimmed case and the composition with each filter included, because those are the decisions two apps would otherwise disagree on.

## Out of Scope

- **Any presentation of a search.** No UI, no CLI, no HTTP layer, no highlighting of the matched text, no result ranking.
- **Any cleverness in the matching.** No fuzzy matching, no typo tolerance, no stemming, no synonyms, no regular expressions, no wildcards, no accent folding, no word-boundary or whole-word matching, no multi-word queries treated as separate terms.
- **Searching anything but the title.** No searching a description, since a todo has none, and no searching an id.
- **Any new order.** No relevance order, no sorting of results.
- **Persistence and indexing.** The core stays in memory, and a search walks the todos. No index, no cache.
- **Performance work.** The lists this core holds are small, and nothing here is to be optimised for a large one.
- **Changing any listing the core already answers.**

## Further Notes

This is one ticket and has no sub-issues: it is one question on one module, and every decision in it is about the same answer.
`,
  },
  tickets: [],
};

/**
 * Every scenario there is, by the name the seed is asked for.
 *
 * `happy-path` stays first, because the seed creates in this order and relay's
 * frontier is oldest-first: an `all` seed followed by relay with no work item
 * named is a pass over `happy-path`.
 */
const SCENARIOS: OneOrMore<Scenario> = [HAPPY_PATH, BUG_REPORT, SINGLE_SPEC];

/**
 * What the seed is asked for when it is to seed the tracker's whole vocabulary
 * rather than one scenario.
 *
 * Reserved rather than merely conventional: a scenario taking this name would
 * shadow it, and the shadowing would show up as a seed that quietly created one
 * work item where an operator asked for every one.
 */
export const ALL_SCENARIOS = "all";

/**
 * The scenario by that name, or a refusal naming the ones that exist.
 *
 * Resolved at the command line, so nothing downstream can be handed a name that
 * names nothing: the seed's next act is to delete every issue in the rehearsal
 * repo.
 */
export function resolveScenario(name: string): Scenario {
  const scenario = SCENARIOS.find((candidate) => candidate.name === name);
  if (!scenario) {
    throw new ConfigError(
      `There is no \`${name}\` scenario. The scenarios that exist are: ${scenarioNames()}.`,
    );
  }
  return scenario;
}

/**
 * The scenarios one seed is to create: every one of them for `all`, or the single
 * one that name resolves to.
 *
 * The seed's own resolver rather than the rehearsal's, because `all` is a seed's
 * argument alone. Passes run one after another over one clone, so under a `merge`
 * landing the second would be cut from a base branch already holding the first's
 * work — only the first pass of an `all` rehearsal would ever run against genesis,
 * which is the property that makes two rehearsals comparable at all.
 */
export function resolveScenarios(name: string): OneOrMore<Scenario> {
  if (name === ALL_SCENARIOS) return SCENARIOS;

  const scenario = SCENARIOS.find((candidate) => candidate.name === name);
  if (!scenario) {
    // Its own refusal rather than `resolveScenario`'s, because the seed takes one
    // name more than the rehearsal does and an operator who mistyped `all` should
    // be told that `all` is what they were reaching for.
    throw new ConfigError(
      `There is no \`${name}\` scenario. The names the seed takes are: ` +
        `${ALL_SCENARIOS}, ${scenarioNames()}.`,
    );
  }
  return [scenario];
}

/** The scenario names a refusal offers, in the order the seed would create them. */
function scenarioNames(): string {
  return SCENARIOS.map((candidate) => candidate.name).join(", ");
}
