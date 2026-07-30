import { describe, expect, it } from "vitest";
import { guardRehearsalOrigin, REHEARSAL_REPO } from "../../rehearsal/rehearsal-repo.js";

/**
 * The guard on the rig's one unrecoverable action, tested here so it is never
 * first exercised by being pointed at a repo somebody works in.
 *
 * The refusals are asserted through their load-bearing phrases rather than
 * their full text, the convention `tests/host/dirty-worktree.test.ts` uses, so
 * editing operator prose is not a test failure.
 */
describe("guardRehearsalOrigin", () => {
  it("passes the rehearsal repo in its HTTPS spelling", () => {
    expect(() => {
      guardRehearsalOrigin(`https://github.com/${REHEARSAL_REPO}.git`);
    }).not.toThrow();
    expect(() => {
      guardRehearsalOrigin(`https://github.com/${REHEARSAL_REPO}`);
    }).not.toThrow();
  });

  it("passes the rehearsal repo in its SSH spelling", () => {
    expect(() => {
      guardRehearsalOrigin(`git@github.com:${REHEARSAL_REPO}.git`);
    }).not.toThrow();
    expect(() => {
      guardRehearsalOrigin(`git@github.com:${REHEARSAL_REPO}`);
    }).not.toThrow();
  });

  it("refuses another repo of the same owner", () => {
    expect(() => {
      guardRehearsalOrigin("git@github.com:miwurster/relay.git");
    }).toThrow(/destroys everything/);
  });

  it("refuses a same-named repo of another owner", () => {
    expect(() => {
      guardRehearsalOrigin("https://github.com/someone-else/relay-rehearsal.git");
    }).toThrow(/destroys everything/);
  });

  it("names the one repo it runs against, and that there is no override", () => {
    let reason = "";
    try {
      guardRehearsalOrigin("git@github.com:miwurster/relay.git");
    } catch (error) {
      reason = error instanceof Error ? error.message : String(error);
    }

    expect(reason).toContain(REHEARSAL_REPO);
    expect(reason).toContain("miwurster/relay.git");
    expect(reason).toContain("no flag and no environment variable");
  });

  it("refuses a clone with no origin at all", () => {
    expect(() => {
      guardRehearsalOrigin(undefined);
    }).toThrow(/not set at all/);
    expect(() => {
      guardRehearsalOrigin("");
    }).toThrow(/not set at all/);
  });
});
