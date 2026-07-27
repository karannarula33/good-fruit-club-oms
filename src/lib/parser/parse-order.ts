import Anthropic from "@anthropic-ai/sdk";
import {
  ORDER_PARSER_SYSTEM_PROMPT,
  buildOrderParserUserMessage,
} from "@/lib/prompts/order-parser";
import { buildCatalogBlock, type CatalogEntry } from "@/lib/parser/catalog";

export type { CatalogEntry };

export interface CustomerEntry {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
}

export type ParseConfidence = "clean" | "flagged";
export type LineFlagReason = "unknown_product" | "vague_qty" | "ambiguous_unit" | null;

export interface ParsedOrderCustomer {
  matchedId: string | null;
  nameText: string;
  isNew: boolean;
  parsedPhone: string | null;
  parsedAddress: string | null;
  confidence: ParseConfidence;
}

export interface ParsedOrderLine {
  productId: string | null;
  rawText: string;
  qty: number | null;
  unit: string | null;
  confidence: ParseConfidence;
  flagReason: LineFlagReason;
}

export interface ParsedOrder {
  customer: ParsedOrderCustomer;
  lines: ParsedOrderLine[];
  notes: string;
}

const NULLABLE_STRING = { anyOf: [{ type: "string" }, { type: "null" }] };
const NULLABLE_NUMBER = { anyOf: [{ type: "number" }, { type: "null" }] };
const CONFIDENCE = { type: "string", enum: ["clean", "flagged"] };

const ORDER_SCHEMA = {
  type: "object",
  properties: {
    customer: {
      type: "object",
      properties: {
        matched_id: NULLABLE_STRING,
        name_text: { type: "string" },
        is_new: { type: "boolean" },
        parsed_phone: NULLABLE_STRING,
        parsed_address: NULLABLE_STRING,
        confidence: CONFIDENCE,
      },
      required: ["matched_id", "name_text", "is_new", "parsed_phone", "parsed_address", "confidence"],
      additionalProperties: false,
    },
    lines: {
      type: "array",
      items: {
        type: "object",
        properties: {
          product_id: NULLABLE_STRING,
          raw_text: { type: "string" },
          qty: NULLABLE_NUMBER,
          unit: NULLABLE_STRING,
          confidence: CONFIDENCE,
          flag_reason: {
            anyOf: [
              { type: "string", enum: ["unknown_product", "vague_qty", "ambiguous_unit"] },
              { type: "null" },
            ],
          },
        },
        required: ["product_id", "raw_text", "qty", "unit", "confidence", "flag_reason"],
        additionalProperties: false,
      },
    },
    notes: { type: "string" },
  },
  required: ["customer", "lines", "notes"],
  additionalProperties: false,
} as const;

function buildCustomerBlock(customers: CustomerEntry[]): string {
  return customers
    .map((customer) => {
      const phone = customer.phone ? `, phone: ${customer.phone}` : "";
      const address = customer.address ? `, address: ${customer.address}` : "";
      return `- ${customer.name}${phone}${address} [id: ${customer.id}]`;
    })
    .join("\n");
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`Parser response: ${field} must be a string`);
  return value;
}

function requireNullableString(value: unknown, field: string): string | null {
  if (value !== null && typeof value !== "string") {
    throw new Error(`Parser response: ${field} must be a string or null`);
  }
  return value as string | null;
}

function requireConfidence(value: unknown, field: string): ParseConfidence {
  if (value !== "clean" && value !== "flagged") {
    throw new Error(`Parser response: ${field} must be "clean" or "flagged"`);
  }
  return value;
}

function validateCustomer(raw: unknown): ParsedOrderCustomer {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Parser response: customer must be an object");
  }
  const customer = raw as Record<string, unknown>;
  if (typeof customer.is_new !== "boolean") {
    throw new Error("Parser response: customer.is_new must be a boolean");
  }

  return {
    matchedId: requireNullableString(customer.matched_id, "customer.matched_id"),
    nameText: requireString(customer.name_text, "customer.name_text"),
    isNew: customer.is_new,
    parsedPhone: requireNullableString(customer.parsed_phone, "customer.parsed_phone"),
    parsedAddress: requireNullableString(customer.parsed_address, "customer.parsed_address"),
    confidence: requireConfidence(customer.confidence, "customer.confidence"),
  };
}

function validateLine(raw: unknown, index: number): ParsedOrderLine {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`Parser response: lines[${index}] must be an object`);
  }
  const line = raw as Record<string, unknown>;
  if (line.qty !== null && typeof line.qty !== "number") {
    throw new Error(`Parser response: lines[${index}].qty must be a number or null`);
  }
  const validFlagReasons = ["unknown_product", "vague_qty", "ambiguous_unit", null];
  if (!validFlagReasons.includes(line.flag_reason as string | null)) {
    throw new Error(`Parser response: lines[${index}].flag_reason is invalid`);
  }

  return {
    productId: requireNullableString(line.product_id, `lines[${index}].product_id`),
    rawText: requireString(line.raw_text, `lines[${index}].raw_text`),
    qty: line.qty as number | null,
    unit: requireNullableString(line.unit, `lines[${index}].unit`),
    confidence: requireConfidence(line.confidence, `lines[${index}].confidence`),
    flagReason: line.flag_reason as LineFlagReason,
  };
}

function validateParsedOrder(raw: unknown): ParsedOrder {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Parser response must be an object");
  }
  const order = raw as Record<string, unknown>;
  if (!Array.isArray(order.lines)) {
    throw new Error("Parser response missing a lines array");
  }

  return {
    customer: validateCustomer(order.customer),
    lines: order.lines.map((line, index) => validateLine(line, index)),
    notes: requireString(order.notes, "notes"),
  };
}

export async function parseOrderPaste(
  rawText: string,
  catalog: CatalogEntry[],
  customers: CustomerEntry[],
): Promise<ParsedOrder> {
  const client = new Anthropic();

  const response = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 4096,
    thinking: { type: "disabled" },
    system: ORDER_PARSER_SYSTEM_PROMPT,
    output_config: {
      format: { type: "json_schema", schema: ORDER_SCHEMA },
    },
    messages: [
      {
        role: "user",
        content: buildOrderParserUserMessage({
          catalogBlock: buildCatalogBlock(catalog),
          customerBlock: buildCustomerBlock(customers),
          rawText,
        }),
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("Order parser request was refused");
  }

  const textBlock = response.content.find(
    (block): block is Anthropic.TextBlock => block.type === "text",
  );
  if (!textBlock) {
    throw new Error("Order parser response contained no text block");
  }

  const raw: unknown = JSON.parse(textBlock.text);
  return validateParsedOrder(raw);
}
