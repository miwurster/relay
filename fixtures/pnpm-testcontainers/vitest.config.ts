import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The sandbox probe greps this run's stdout for the test's marker, and
    // vitest otherwise intercepts a passing test's console output and never
    // prints it — which would fail the probe's marker check on a green run.
    disableConsoleIntercept: true,
  },
});
