import type { DoctorCheck } from "./doctor.js";

/**
 * Where doctor's report is written, and whether that place can rewrite the line
 * it is standing on. Injected so a test can read the exact bytes, and so the
 * non-terminal case is a value rather than a global.
 */
export interface ReportSink {
  write(chunk: string): void;
  isTTY: boolean;
}

/**
 * Told as each check starts and as it resolves, so the report arrives while the
 * checks run rather than in one batch after the slowest of them.
 */
export interface CheckReporter {
  started(name: string): void;
  resolved(check: DoctorCheck): void;
}

/** A reporter for a caller that only wants the verdicts, not a report. */
export const SILENT_REPORTER: CheckReporter = {
  started: () => {},
  resolved: () => {},
};

/** The fixed-width column every status shares, so the names line up under it. */
const STATUS_COLUMN: Record<DoctorCheck["status"] | "pending", string> = {
  pending: " run  ",
  ok: "  ok  ",
  warning: " warn ",
  failed: "FAILED",
  skipped: " skip ",
};

/** Carriage return and clear-to-end-of-line: unwrite the line just written. */
const ERASE_LINE = "\r\u001b[K";

/**
 * A report that names the check it is waiting on.
 *
 * On a terminal, a check announces itself before it runs and its verdict
 * overwrites that line in place, so an operator watching a sandbox open knows
 * which check is spending the minute. Anywhere else the announcement is dropped
 * rather than escaped: a pipe cannot unwrite a line, and a log of one line per
 * check is what a pipe wanted anyway.
 */
export function liveReporter(out: ReportSink): CheckReporter {
  let pending = false;
  return {
    started(name) {
      if (!out.isTTY) return;
      out.write(`  ${STATUS_COLUMN.pending} ${name}`);
      pending = true;
    },
    resolved(check) {
      const erase = pending ? ERASE_LINE : "";
      pending = false;
      out.write(`${erase}  ${STATUS_COLUMN[check.status]} ${check.name}: ${check.detail}\n`);
    },
  };
}
