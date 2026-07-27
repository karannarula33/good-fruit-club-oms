// Manual eval harness for the order parser (CLAUDE.md §5). Hits the live
// Anthropic API and the live Supabase catalog/customer directory, so it is
// intentionally NOT part of `npm test`. Run with: npm run eval:order-parser
//
// Comparison is deliberately lenient: only fields present in a fixture's
// "expected" block are asserted. Two of the four real fixtures contain
// genuinely ambiguous cases by design (an unresolvable product, an
// ambiguous customer match) -- asserting every field would make the eval
// flaky on legitimately-debatable output rather than catching regressions.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseOrderPaste, type CustomerEntry } from "../src/lib/parser/parse-order";
import { loadCatalogEntries } from "../src/lib/catalog/load";
import { createServiceRoleClient } from "../src/lib/supabase/service-role";

interface ExpectedLine {
  product_name?: string | null;
  qty?: number;
  confidence?: "clean" | "flagged";
}

interface ExpectedCustomer {
  name?: string;
  confidence?: "clean" | "flagged";
}

interface Fixture {
  raw_paste: string;
  expected: {
    customer: ExpectedCustomer;
    lines: ExpectedLine[];
  };
}

async function loadCustomers(supabase: ReturnType<typeof createServiceRoleClient>): Promise<CustomerEntry[]> {
  const { data, error } = await supabase.from("customers").select("id, display_name, phone, address");
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({ id: row.id, name: row.display_name, phone: row.phone, address: row.address }));
}

async function main() {
  const supabase = createServiceRoleClient();
  const [catalog, customers] = await Promise.all([loadCatalogEntries(supabase), loadCustomers(supabase)]);
  const productNameById = new Map(catalog.map((p) => [p.id, p.name]));
  const customerNameById = new Map(customers.map((c) => [c.id, c.name]));

  const fixturesDir = path.join(__dirname, "..", "tests", "parser_cases", "order");
  const files = readdirSync(fixturesDir).filter((f) => f.endsWith(".json")).sort();

  let allPassed = true;

  for (const file of files) {
    const fixture: Fixture = JSON.parse(readFileSync(path.join(fixturesDir, file), "utf-8"));
    const result = await parseOrderPaste(fixture.raw_paste, catalog, customers);

    const mismatches: string[] = [];

    const expectedCustomer = fixture.expected.customer;
    const actualCustomerName = result.customer.matchedId ? customerNameById.get(result.customer.matchedId) ?? null : null;
    if (expectedCustomer.name !== undefined && actualCustomerName !== expectedCustomer.name) {
      mismatches.push(`customer.name: expected ${expectedCustomer.name}, got ${actualCustomerName}`);
    }
    if (expectedCustomer.confidence !== undefined && result.customer.confidence !== expectedCustomer.confidence) {
      mismatches.push(`customer.confidence: expected ${expectedCustomer.confidence}, got ${result.customer.confidence}`);
    }

    if (result.lines.length !== fixture.expected.lines.length) {
      mismatches.push(`line count: expected ${fixture.expected.lines.length}, got ${result.lines.length}`);
    } else {
      fixture.expected.lines.forEach((expectedLine, i) => {
        const actualLine = result.lines[i];
        const actualProductName = actualLine.productId ? productNameById.get(actualLine.productId) ?? null : null;
        if (expectedLine.product_name !== undefined && actualProductName !== expectedLine.product_name) {
          mismatches.push(`line ${i} product: expected ${expectedLine.product_name}, got ${actualProductName}`);
        }
        if (expectedLine.qty !== undefined && actualLine.qty !== expectedLine.qty) {
          mismatches.push(`line ${i} qty: expected ${expectedLine.qty}, got ${actualLine.qty}`);
        }
        if (expectedLine.confidence !== undefined && actualLine.confidence !== expectedLine.confidence) {
          mismatches.push(`line ${i} confidence: expected ${expectedLine.confidence}, got ${actualLine.confidence}`);
        }
      });
    }

    if (mismatches.length === 0) {
      console.log(`PASS ${file}`);
    } else {
      allPassed = false;
      console.log(`FAIL ${file}`);
      for (const mismatch of mismatches) console.log(`  ${mismatch}`);
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
