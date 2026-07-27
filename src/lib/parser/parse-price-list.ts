import Anthropic from "@anthropic-ai/sdk";
import {
  PRICE_PARSER_SYSTEM_PROMPT,
  buildPriceParserUserMessage,
} from "@/lib/prompts/price-parser";
import { buildCatalogBlock, type CatalogEntry } from "@/lib/parser/catalog";

export type { CatalogEntry };
export type ParseConfidence = "clean" | "flagged";
export type FlagReason = "unknown_product" | "vague_price" | "ambiguous_unit" | null;

export interface ParsedPriceItem {
  productId: string | null;
  rawText: string;
  price: number | null;
  confidence: ParseConfidence;
  flagReason: FlagReason;
}

export interface ParsedPriceList {
  items: ParsedPriceItem[];
}

const NULLABLE_STRING = { anyOf: [{ type: "string" }, { type: "null" }] };
const NULLABLE_NUMBER = { anyOf: [{ type: "number" }, { type: "null" }] };

const PRICE_ITEMS_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          product_id: NULLABLE_STRING,
          raw_text: { type: "string" },
          price: NULLABLE_NUMBER,
          confidence: { type: "string", enum: ["clean", "flagged"] },
          flag_reason: {
            anyOf: [
              { type: "string", enum: ["unknown_product", "vague_price", "ambiguous_unit"] },
              { type: "null" },
            ],
          },
        },
        required: ["product_id", "raw_text", "price", "confidence", "flag_reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
} as const;

function validateParsedItem(raw: unknown, index: number): ParsedPriceItem {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`Parser returned a non-object item at index ${index}`);
  }
  const item = raw as Record<string, unknown>;

  if (item.product_id !== null && typeof item.product_id !== "string") {
    throw new Error(`Parser item ${index}: product_id must be string or null`);
  }
  if (typeof item.raw_text !== "string") {
    throw new Error(`Parser item ${index}: raw_text must be a string`);
  }
  if (item.price !== null && typeof item.price !== "number") {
    throw new Error(`Parser item ${index}: price must be a number or null`);
  }
  if (item.confidence !== "clean" && item.confidence !== "flagged") {
    throw new Error(`Parser item ${index}: confidence must be "clean" or "flagged"`);
  }
  const validFlagReasons = ["unknown_product", "vague_price", "ambiguous_unit", null];
  if (!validFlagReasons.includes(item.flag_reason as string | null)) {
    throw new Error(`Parser item ${index}: invalid flag_reason`);
  }

  return {
    productId: item.product_id as string | null,
    rawText: item.raw_text,
    price: item.price as number | null,
    confidence: item.confidence,
    flagReason: item.flag_reason as FlagReason,
  };
}

function validateParsedPriceList(raw: unknown): ParsedPriceList {
  if (typeof raw !== "object" || raw === null || !Array.isArray((raw as Record<string, unknown>).items)) {
    throw new Error("Parser response missing an items array");
  }
  const items = (raw as { items: unknown[] }).items.map((item, index) => validateParsedItem(item, index));
  return { items };
}

export async function parsePriceList(
  rawText: string,
  catalog: CatalogEntry[],
): Promise<ParsedPriceList> {
  const client = new Anthropic();

  const response = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 4096,
    thinking: { type: "disabled" },
    system: PRICE_PARSER_SYSTEM_PROMPT,
    output_config: {
      format: { type: "json_schema", schema: PRICE_ITEMS_SCHEMA },
    },
    messages: [
      {
        role: "user",
        content: buildPriceParserUserMessage({
          catalogBlock: buildCatalogBlock(catalog),
          rawText,
        }),
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("Price parser request was refused");
  }

  const textBlock = response.content.find(
    (block): block is Anthropic.TextBlock => block.type === "text",
  );
  if (!textBlock) {
    throw new Error("Price parser response contained no text block");
  }

  const raw: unknown = JSON.parse(textBlock.text);
  return validateParsedPriceList(raw);
}
