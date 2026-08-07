// Manual eval harness for the engagement engine's draft agent
// (CLAUDE_engagement_engine_FINAL.md §9). Hits the live Anthropic API, so it
// is intentionally NOT part of `npm test` (non-deterministic, costs money,
// needs network + ANTHROPIC_API_KEY). Run with: npm run eval:nudge-drafter
//
// Tone is inherently subjective, so this only asserts the mechanically-
// checkable §9 hard rules (sentence count, banned phrases, emoji/exclamation
// budget, references something real from the input) -- same lenient-
// assertion philosophy as eval-order-parser.ts. It always prints the full
// draft + rationale so a human can judge tone against §9/§11.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { draftNudgeMessage, type DraftAgentInput } from "../src/lib/engagement/draft";
import type { TriggerType } from "../src/lib/engagement/priority";

interface FixtureInput {
  customer_name: string;
  zone: string;
  trigger_type: string;
  is_followup: boolean;
  rationale: string;
  order_count: number;
  last_order_products: string[];
  favourite_products: string[];
  todays_catalogue_highlights: string[];
  seasonal_note: string | null;
}

interface Fixture {
  input: FixtureInput;
  expectMentionsAnyOf?: string[];
  expectNoWorriesPhrase?: boolean;
}

const BANNED_PHRASES = [
  "days since",
  "algorithm",
  "we noticed",
  "noticed you",
  "tracking",
  "been away",
];

// Matches most common emoji ranges without pulling in a dependency.
const EMOJI_REGEX = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu;

function toDraftInput(f: FixtureInput): DraftAgentInput {
  return {
    customerName: f.customer_name,
    zone: f.zone,
    triggerType: f.trigger_type as TriggerType,
    isFollowup: f.is_followup,
    rationale: f.rationale,
    orderCount: f.order_count,
    lastOrderProducts: f.last_order_products,
    favouriteProducts: f.favourite_products,
    todaysCatalogueHighlights: f.todays_catalogue_highlights,
    seasonalNote: f.seasonal_note,
  };
}

function checkDraft(message: string, fixture: Fixture): string[] {
  const problems: string[] = [];
  const lower = message.toLowerCase();

  const sentenceCount = (message.match(/[.!?]+(\s|$)/g) ?? []).length || 1;
  if (sentenceCount < 2 || sentenceCount > 4) {
    problems.push(`sentence count ${sentenceCount} outside 2-4`);
  }

  for (const phrase of BANNED_PHRASES) {
    if (lower.includes(phrase)) problems.push(`contains banned phrase "${phrase}"`);
  }

  const emojiCount = (message.match(EMOJI_REGEX) ?? []).length;
  if (emojiCount > 1) problems.push(`${emojiCount} emoji, expected at most 1`);

  const exclamationCount = (message.match(/!/g) ?? []).length;
  if (exclamationCount > 1) problems.push(`${exclamationCount} exclamation marks, expected at most 1`);

  if (fixture.expectMentionsAnyOf && fixture.expectMentionsAnyOf.length > 0) {
    const mentioned = fixture.expectMentionsAnyOf.some((term) => lower.includes(term.toLowerCase()));
    if (!mentioned) {
      problems.push(`mentions none of: ${fixture.expectMentionsAnyOf.join(", ")}`);
    }
  }

  if (fixture.expectNoWorriesPhrase && !lower.includes("no worries")) {
    problems.push(`missing explicit "no worries" phrase`);
  }

  return problems;
}

async function main() {
  const fixturesDir = path.join(__dirname, "..", "tests", "parser_cases", "nudge_drafts");
  const files = readdirSync(fixturesDir).filter((f) => f.endsWith(".json")).sort();

  let allPassed = true;

  for (const file of files) {
    const fixture: Fixture = JSON.parse(readFileSync(path.join(fixturesDir, file), "utf-8"));
    const result = await draftNudgeMessage(toDraftInput(fixture.input));
    const problems = checkDraft(result.draftMessage, fixture);

    console.log(`\n--- ${file} (${fixture.input.trigger_type}${fixture.input.is_followup ? ", follow-up" : ""}) ---`);
    console.log(`  message: ${result.draftMessage}`);
    console.log(`  why:     ${result.draftRationale}`);

    if (problems.length === 0) {
      console.log(`PASS ${file}`);
    } else {
      allPassed = false;
      console.log(`FAIL ${file}`);
      for (const problem of problems) console.log(`  ${problem}`);
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
