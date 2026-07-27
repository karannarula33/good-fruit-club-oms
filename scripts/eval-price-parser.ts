// Manual eval harness for the price-list parser (CLAUDE.md §5). Hits the
// live Anthropic API and the live Supabase catalog, so it is intentionally
// NOT part of `npm test` (non-deterministic, costs money, needs network +
// ANTHROPIC_API_KEY). Run with: npm run eval:price-parser

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parsePriceList } from "../src/lib/parser/parse-price-list";
import { loadCatalogEntries } from "../src/lib/catalog/load";
import { createServiceRoleClient } from "../src/lib/supabase/service-role";

interface ExpectedItem {
  product_name: string | null;
  price: number | null;
  confidence: "clean" | "flagged";
  flag_reason?: "unknown_product" | "vague_price" | "ambiguous_unit" | null;
}

interface Fixture {
  raw_paste: string;
  expected: ExpectedItem[];
}

async function main() {
  const supabase = createServiceRoleClient();
  const catalog = await loadCatalogEntries(supabase);
  const nameById = new Map(catalog.map((product) => [product.id, product.name]));

  const fixturesDir = path.join(__dirname, "..", "tests", "parser_cases", "price");
  const files = readdirSync(fixturesDir).filter((f) => f.endsWith(".json")).sort();

  let allPassed = true;

  for (const file of files) {
    const fixture: Fixture = JSON.parse(readFileSync(path.join(fixturesDir, file), "utf-8"));
    const result = await parsePriceList(fixture.raw_paste, catalog);

    if (result.items.length !== fixture.expected.length) {
      allPassed = false;
      console.log(`FAIL ${file}: expected ${fixture.expected.length} items, got ${result.items.length}`);
      continue;
    }

    let filePassed = true;
    fixture.expected.forEach((expected, i) => {
      const actual = result.items[i];
      const actualName = actual.productId ? nameById.get(actual.productId) ?? null : null;
      const mismatches: string[] = [];
      if (actualName !== expected.product_name) {
        mismatches.push(`product: expected ${expected.product_name}, got ${actualName}`);
      }
      if (actual.price !== expected.price) {
        mismatches.push(`price: expected ${expected.price}, got ${actual.price}`);
      }
      if (actual.confidence !== expected.confidence) {
        mismatches.push(`confidence: expected ${expected.confidence}, got ${actual.confidence}`);
      }
      if (expected.flag_reason !== undefined && actual.flagReason !== expected.flag_reason) {
        mismatches.push(`flag_reason: expected ${expected.flag_reason}, got ${actual.flagReason}`);
      }
      if (mismatches.length > 0) {
        filePassed = false;
        console.log(`  line ${i} (${expected.product_name ?? "unmatched"}): ${mismatches.join("; ")}`);
      }
    });

    if (filePassed) {
      console.log(`PASS ${file}`);
    } else {
      allPassed = false;
      console.log(`FAIL ${file}`);
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
