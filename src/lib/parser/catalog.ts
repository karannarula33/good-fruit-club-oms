// Shared catalog-context formatting for LLM parsers (price, order). A
// product's unit is included so the model can judge unit plausibility (see
// CLAUDE.md §5) -- pulled out here so both parsers stay consistent.

export interface CatalogEntry {
  id: string;
  name: string;
  aliases: string[];
  unitLabel: string | null;
}

export function buildCatalogBlock(catalog: CatalogEntry[]): string {
  return catalog
    .map((product) => {
      const aliasSuffix = product.aliases.length > 0 ? ` (aka: ${product.aliases.join(", ")})` : "";
      const unitSuffix = product.unitLabel ? ` [unit: ${product.unitLabel}]` : "";
      return `- ${product.name}${aliasSuffix}${unitSuffix} [id: ${product.id}]`;
    })
    .join("\n");
}
