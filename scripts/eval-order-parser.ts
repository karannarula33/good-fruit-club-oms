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
import { parseOrderPaste, parseOrderBatchPaste, type CustomerEntry, type ParsedOrder } from "../src/lib/parser/parse-order";
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

interface ExpectedOrder {
  customer: ExpectedCustomer;
  lines: ExpectedLine[];
}

interface Fixture {
  raw_paste: string;
  expected: ExpectedOrder;
}

interface BatchFixture {
  raw_paste: string;
  expected: {
    orders: ExpectedOrder[];
  };
}

async function loadCustomers(supabase: ReturnType<typeof createServiceRoleClient>): Promise<CustomerEntry[]> {
  const { data, error } = await supabase.from("customers").select("id, display_name, phone, address");
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({ id: row.id, name: row.display_name, phone: row.phone, address: row.address }));
}

function compareOrder(
  expected: ExpectedOrder,
  actual: ParsedOrder,
  productNameById: Map<string, string>,
  customerNameById: Map<string, string>,
): string[] {
  const mismatches: string[] = [];

  const actualCustomerName = actual.customer.matchedId ? (customerNameById.get(actual.customer.matchedId) ?? null) : null;
  if (expected.customer.name !== undefined && actualCustomerName !== expected.customer.name) {
    mismatches.push(`customer.name: expected ${expected.customer.name}, got ${actualCustomerName}`);
  }
  if (expected.customer.confidence !== undefined && actual.customer.confidence !== expected.customer.confidence) {
    mismatches.push(`customer.confidence: expected ${expected.customer.confidence}, got ${actual.customer.confidence}`);
  }

  if (actual.lines.length !== expected.lines.length) {
    mismatches.push(`line count: expected ${expected.lines.length}, got ${actual.lines.length}`);
  } else {
    expected.lines.forEach((expectedLine, i) => {
      const actualLine = actual.lines[i];
      const actualProductName = actualLine.productId ? (productNameById.get(actualLine.productId) ?? null) : null;
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

  return mismatches;
}

async function main() {
  const supabase = createServiceRoleClient();
  const [catalog, customers] = await Promise.all([loadCatalogEntries(supabase), loadCustomers(supabase)]);
  const productNameById = new Map(catalog.map((p) => [p.id, p.name]));
  const customerNameById = new Map(customers.map((c) => [c.id, c.name]));

  let allPassed = true;

  const fixturesDir = path.join(__dirname, "..", "tests", "parser_cases", "order");
  const files = readdirSync(fixturesDir).filter((f) => f.endsWith(".json")).sort();

  for (const file of files) {
    const fixture: Fixture = JSON.parse(readFileSync(path.join(fixturesDir, file), "utf-8"));
    const result = await parseOrderPaste(fixture.raw_paste, catalog, customers);
    const mismatches = compareOrder(fixture.expected, result, productNameById, customerNameById);

    if (mismatches.length === 0) {
      console.log(`PASS ${file}`);
    } else {
      allPassed = false;
      console.log(`FAIL ${file}`);
      for (const mismatch of mismatches) console.log(`  ${mismatch}`);
    }
  }

  const batchFixturesDir = path.join(__dirname, "..", "tests", "parser_cases", "order_batch");
  const batchFiles = readdirSync(batchFixturesDir).filter((f) => f.endsWith(".json")).sort();

  for (const file of batchFiles) {
    const fixture: BatchFixture = JSON.parse(readFileSync(path.join(batchFixturesDir, file), "utf-8"));
    const results = await parseOrderBatchPaste(fixture.raw_paste, catalog, customers);

    const mismatches: string[] = [];
    if (results.length !== fixture.expected.orders.length) {
      mismatches.push(`order count: expected ${fixture.expected.orders.length}, got ${results.length}`);
    } else {
      fixture.expected.orders.forEach((expectedOrder, i) => {
        const orderMismatches = compareOrder(expectedOrder, results[i].order, productNameById, customerNameById);
        for (const mismatch of orderMismatches) mismatches.push(`order ${i} ${mismatch}`);
      });
    }

    if (mismatches.length === 0) {
      console.log(`PASS (batch) ${file}`);
    } else {
      allPassed = false;
      console.log(`FAIL (batch) ${file}`);
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
