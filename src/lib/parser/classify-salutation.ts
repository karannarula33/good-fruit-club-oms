import Anthropic from "@anthropic-ai/sdk";
import {
  SALUTATION_CLASSIFIER_SYSTEM_PROMPT,
  buildSalutationClassifierUserMessage,
} from "@/lib/prompts/salutation-classifier";

export type SalutationClassification = "Sir" | "Ma'am" | "unknown";

const SALUTATION_SCHEMA = {
  type: "object",
  properties: {
    salutation: { type: "string", enum: ["Sir", "Ma'am", "unknown"] },
  },
  required: ["salutation"],
  additionalProperties: false,
} as const;

function validateSalutationResult(raw: unknown): SalutationClassification {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Salutation classifier returned a non-object response");
  }
  const { salutation } = raw as Record<string, unknown>;
  if (salutation !== "Sir" && salutation !== "Ma'am" && salutation !== "unknown") {
    throw new Error("Salutation classifier returned an invalid salutation value");
  }
  return salutation;
}

export async function classifySalutation(displayName: string): Promise<SalutationClassification> {
  const client = new Anthropic();

  const response = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 256,
    thinking: { type: "disabled" },
    system: SALUTATION_CLASSIFIER_SYSTEM_PROMPT,
    output_config: {
      format: { type: "json_schema", schema: SALUTATION_SCHEMA },
    },
    messages: [
      {
        role: "user",
        content: buildSalutationClassifierUserMessage(displayName),
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("Salutation classifier request was refused");
  }

  const textBlock = response.content.find(
    (block): block is Anthropic.TextBlock => block.type === "text",
  );
  if (!textBlock) {
    throw new Error("Salutation classifier response contained no text block");
  }

  const raw: unknown = JSON.parse(textBlock.text);
  return validateSalutationResult(raw);
}
