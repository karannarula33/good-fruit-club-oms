// CLAUDE_engagement_engine_FINAL.md §3: all thresholds live in eng_config
// (tunable without code changes) -- this just maps the DB rows onto a typed
// shape so the rest of the engine isn't full of string keys.

export interface EngagementConfig {
  vipPercentile: number;
  cohortDefaultGapDays: number;
  secondOrderGraceDays: number;
  thirdOrderGraceDays: number;
  driftSeverityLow: number;
  driftSeverityMid: number;
  driftSeverityHigh: number;
  lapsedAbsoluteDays: number;
  vipCheckinIntervalDays: number;
  frequencyCapDays: number;
  unansweredCooldownCount: number;
  unansweredCooldownDays: number;
  callEscalationEnabled: boolean;
}

// Every eng_config row is numeric (§3) -- CALL_ESCALATION_ENABLED is stored
// as 1/0 and converted to boolean here, same as every other DB-shape-to-
// typed-shape decision in this file.
const NUMERIC_CONFIG_KEYS: Record<Exclude<keyof EngagementConfig, "callEscalationEnabled">, string> = {
  vipPercentile: "VIP_PERCENTILE",
  cohortDefaultGapDays: "COHORT_DEFAULT_GAP_DAYS",
  secondOrderGraceDays: "SECOND_ORDER_GRACE_DAYS",
  thirdOrderGraceDays: "THIRD_ORDER_GRACE_DAYS",
  driftSeverityLow: "DRIFT_SEVERITY_LOW",
  driftSeverityMid: "DRIFT_SEVERITY_MID",
  driftSeverityHigh: "DRIFT_SEVERITY_HIGH",
  lapsedAbsoluteDays: "LAPSED_ABSOLUTE_DAYS",
  vipCheckinIntervalDays: "VIP_CHECKIN_INTERVAL_DAYS",
  frequencyCapDays: "FREQUENCY_CAP_DAYS",
  unansweredCooldownCount: "UNANSWERED_COOLDOWN_COUNT",
  unansweredCooldownDays: "UNANSWERED_COOLDOWN_DAYS",
};

const CALL_ESCALATION_ENABLED_KEY = "CALL_ESCALATION_ENABLED";

export function buildEngagementConfig(rows: { key: string; value: number }[]): EngagementConfig {
  const byKey = new Map(rows.map((r) => [r.key, r.value]));

  const entries = Object.entries(NUMERIC_CONFIG_KEYS).map(([field, dbKey]) => {
    const value = byKey.get(dbKey);
    if (value === undefined) throw new Error(`Missing eng_config row for ${dbKey}`);
    return [field, value] as const;
  });

  const callEscalationValue = byKey.get(CALL_ESCALATION_ENABLED_KEY);
  if (callEscalationValue === undefined) {
    throw new Error(`Missing eng_config row for ${CALL_ESCALATION_ENABLED_KEY}`);
  }

  return {
    ...(Object.fromEntries(entries) as Omit<EngagementConfig, "callEscalationEnabled">),
    callEscalationEnabled: callEscalationValue !== 0,
  };
}
