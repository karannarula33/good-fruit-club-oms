import { describe, expect, it } from "vitest";
import { validateDraftResponse } from "@/lib/engagement/draft";

describe("validateDraftResponse", () => {
  it("accepts a well-formed response", () => {
    expect(
      validateDraftResponse({ draft_message: "Hi Annu!", draft_rationale: "used order-count milestone" }),
    ).toEqual({ draftMessage: "Hi Annu!", draftRationale: "used order-count milestone" });
  });

  it("rejects a non-object response", () => {
    expect(() => validateDraftResponse(null)).toThrow(/must be an object/);
    expect(() => validateDraftResponse("hi")).toThrow(/must be an object/);
  });

  it("rejects a missing draft_message", () => {
    expect(() => validateDraftResponse({ draft_rationale: "why" })).toThrow(/draft_message/);
  });

  it("rejects a non-string draft_message", () => {
    expect(() => validateDraftResponse({ draft_message: 5, draft_rationale: "why" })).toThrow(/draft_message/);
  });

  it("rejects a missing draft_rationale", () => {
    expect(() => validateDraftResponse({ draft_message: "hi" })).toThrow(/draft_rationale/);
  });

  it("rejects a non-string draft_rationale", () => {
    expect(() => validateDraftResponse({ draft_message: "hi", draft_rationale: null })).toThrow(/draft_rationale/);
  });
});
