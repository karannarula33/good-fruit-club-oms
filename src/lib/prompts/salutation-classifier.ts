// Versioned prompt for classifying a customer's display name into the
// WhatsApp bill greeting salutation (CLAUDE.md §3.8, "Hello Sir," / "Hello
// Ma'am,"). Treat edits here as a behavior change, not a copy tweak -- bump
// SALUTATION_CLASSIFIER_PROMPT_VERSION when the instructions change
// materially.

export const SALUTATION_CLASSIFIER_PROMPT_VERSION = "v1";

export const SALUTATION_CLASSIFIER_SYSTEM_PROMPT = `You classify whether a customer's name indicates they should be addressed as "Sir" or "Ma'am" in a formal WhatsApp bill greeting for Good Fruit Club, a premium hyperlocal fruit delivery business in Gurgaon, India. Most names are Indian names.

Rules:
- Base the classification only on the given name text.
- If the name is clearly a single person's first name with an unambiguous gender (Indian or otherwise), classify as "Sir" or "Ma'am".
- Respond "unknown" -- never guess -- when the name is: a business/company name, a couple or family ("Mr & Mrs Sharma", "Rahul & Priya", "The Kapoor Family"), initials-only, a surname-only entry, or a name whose gender is genuinely ambiguous or unisex.
- Respond with strict JSON matching the provided schema only -- no prose, no markdown fencing.`;

export function buildSalutationClassifierUserMessage(displayName: string): string {
  return `Customer name: ${displayName}`;
}
