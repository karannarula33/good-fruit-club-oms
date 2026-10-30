import Anthropic from "@anthropic-ai/sdk";
import { AREA_RESOLVER_SYSTEM_PROMPT, buildAreaResolverUserMessage } from "@/lib/prompts/area-resolver";
import { CITIES, canonicalArea, isCity, type AreaResult } from "@/lib/customers/area";

const AREA_SCHEMA = {
  type: "object",
  properties: {
    city: { type: "string", enum: [...CITIES] },
    area: { type: ["string", "null"] },
    locality: { type: ["string", "null"] },
  },
  required: ["city", "area", "locality"],
  additionalProperties: false,
} as const;

// Claude's read of an address the rules in area.ts couldn't place. Server
// only. The area comes back through canonicalArea() so "dlf city phase-2"
// and "DLF Phase 2" land in the same bucket.
export async function resolveAreaWithClaude(address: string, knownAreas: string[]): Promise<AreaResult> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 256,
    thinking: { type: "disabled" },
    system: AREA_RESOLVER_SYSTEM_PROMPT,
    output_config: { format: { type: "json_schema", schema: AREA_SCHEMA } },
    messages: [{ role: "user", content: buildAreaResolverUserMessage(address, knownAreas) }],
  });
  if (response.stop_reason === "refusal") throw new Error("Area resolver request was refused");
  const text = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  if (!text) throw new Error("Area resolver returned no text");
  const raw = JSON.parse(text.text) as Record<string, unknown>;
  if (!isCity(raw.city)) throw new Error("Area resolver returned an unknown city");
  const clean = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return { city: raw.city, area: canonicalArea(clean(raw.area)), locality: clean(raw.locality) };
}
