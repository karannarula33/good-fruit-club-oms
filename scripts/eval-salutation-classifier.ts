// Manual eval harness for the salutation classifier (CLAUDE.md §3.8). Hits
// the live Anthropic API, so it is intentionally NOT part of `npm test`
// (non-deterministic, costs money, needs network + ANTHROPIC_API_KEY).
// Run with: npm run eval:salutation-classifier

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { classifySalutation } from "../src/lib/parser/classify-salutation";

interface Fixture {
  display_name: string;
  expected: "Sir" | "Ma'am" | "unknown";
}

async function main() {
  const fixturesDir = path.join(__dirname, "..", "tests", "parser_cases", "salutation");
  const files = readdirSync(fixturesDir).filter((f) => f.endsWith(".json")).sort();

  let allPassed = true;

  for (const file of files) {
    const fixture: Fixture = JSON.parse(readFileSync(path.join(fixturesDir, file), "utf-8"));
    const actual = await classifySalutation(fixture.display_name);

    if (actual === fixture.expected) {
      console.log(`PASS ${file} (${fixture.display_name} → ${actual})`);
    } else {
      allPassed = false;
      console.log(`FAIL ${file}: ${fixture.display_name} → expected ${fixture.expected}, got ${actual}`);
    }
  }

  if (!allPassed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
