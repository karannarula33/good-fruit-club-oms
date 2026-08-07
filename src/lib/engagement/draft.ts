// CLAUDE_engagement_engine_FINAL.md §9 (draft agent) / §5 STEP 4. Server-
// side Claude call per `message` candidate, following the same call/
// validate shape as src/lib/parser/parse-order.ts's parseOrderPaste
// (refusal check, find the text block, JSON.parse, validate). Response
// validation is a standalone pure function so it's unit-testable without
// the network.

import Anthropic from "@anthropic-ai/sdk";
import {
  NUDGE_DRAFTER_SYSTEM_PROMPT,
  buildNudgeDrafterUserMessage,
  type NudgeDrafterInputPayload,
} from "@/lib/prompts/nudge-drafter";
import type { TriggerType } from "./priority";

export interface DraftAgentInput {
  customerName: string;
  zone: string;
  triggerType: TriggerType;
  isFollowup: boolean;
  rationale: string;
  orderCount: number;
  lastOrderProducts: string[];
  favouriteProducts: string[];
  todaysCatalogueHighlights: string[];
  seasonalNote: string | null;
}

export interface DraftAgentOutput {
  draftMessage: string;
  draftRationale: string;
}

const DRAFT_SCHEMA = {
  type: "object",
  properties: {
    draft_message: { type: "string" },
    draft_rationale: { type: "string" },
  },
  required: ["draft_message", "draft_rationale"],
  additionalProperties: false,
} as const;

function toPayload(input: DraftAgentInput): NudgeDrafterInputPayload {
  return {
    customer_name: input.customerName,
    zone: input.zone,
    trigger_type: input.triggerType,
    is_followup: input.isFollowup,
    rationale: input.rationale,
    order_count: input.orderCount,
    last_order_products: input.lastOrderProducts,
    favourite_products: input.favouriteProducts,
    todays_catalogue_highlights: input.todaysCatalogueHighlights,
    seasonal_note: input.seasonalNote,
  };
}

export function validateDraftResponse(raw: unknown): DraftAgentOutput {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Nudge drafter response must be an object");
  }
  const draft = raw as Record<string, unknown>;
  if (typeof draft.draft_message !== "string") {
    throw new Error("Nudge drafter response: draft_message must be a string");
  }
  if (typeof draft.draft_rationale !== "string") {
    throw new Error("Nudge drafter response: draft_rationale must be a string");
  }
  return { draftMessage: draft.draft_message, draftRationale: draft.draft_rationale };
}

export async function draftNudgeMessage(input: DraftAgentInput): Promise<DraftAgentOutput> {
  const client = new Anthropic();

  const response = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 1024,
    thinking: { type: "disabled" },
    system: NUDGE_DRAFTER_SYSTEM_PROMPT,
    output_config: {
      format: { type: "json_schema", schema: DRAFT_SCHEMA },
    },
    messages: [
      {
        role: "user",
        content: buildNudgeDrafterUserMessage(toPayload(input)),
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("Nudge drafter request was refused");
  }

  const textBlock = response.content.find(
    (block): block is Anthropic.TextBlock => block.type === "text",
  );
  if (!textBlock) {
    throw new Error("Nudge drafter response contained no text block");
  }

  const raw: unknown = JSON.parse(textBlock.text);
  return validateDraftResponse(raw);
}
