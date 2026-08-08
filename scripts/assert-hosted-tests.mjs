// Assert a vitest JSON report represents a real hosted run: >0 total tests and 0 skipped.
// Usage: node scripts/assert-hosted-tests.mjs <path-to-vitest-json>
import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/assert-hosted-tests.mjs <vitest-json>");
  process.exit(2);
}

let report;
try {
  report = JSON.parse(readFileSync(file, "utf8"));
} catch (err) {
  console.error("[fail] cannot read vitest report:", err.message);
  process.exit(1);
}

const numTotalTests = report.numTotalTests ?? 0;
const numSkippedTests = report.numSkippedTests ?? 0;
const numFailedTests = report.numFailedTests ?? 0;
const numPassedTests = report.numPassedTests ?? 0;
const numFailedTestSuites = report.numFailedTestSuites ?? 0;

if (numFailedTestSuites > 0 || numFailedTests > 0) {
  console.error(
    `[fail] hosted tests failed: ${numFailedTestSuites} suites, ${numFailedTests} tests`,
  );
  process.exit(1);
}
if (numTotalTests === 0) {
  console.error("[fail] hosted test run contained zero tests — suite may have been skipped");
  process.exit(1);
}
if (numSkippedTests > 0) {
  console.error(`[fail] hosted test run contained ${numSkippedTests} skipped tests`);
  process.exit(1);
}

console.log(`[ok] hosted tests ran: ${numTotalTests} total, ${numPassedTests} passed, 0 skipped`);
