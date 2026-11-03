// Loads the Learn GFC starter modules (src/lib/training/content.ts) into the
// database. Only adds modules that don't exist yet (matched by slug), so it
// never overwrites a module the admin has edited in the OMS.
//
//   npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/seed_training.ts            # dry run
//   npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/seed_training.ts --execute
import { createClient } from "@supabase/supabase-js";
import { TRAINING_MODULES } from "../src/lib/training/content";
import { screenCount } from "../src/lib/training/markdown";

async function main() {
  const execute = process.argv.includes("--execute");
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data: existing, error } = await supabase.from("training_modules").select("slug");
  if (error) throw new Error(error.message);
  const have = new Set((existing ?? []).map((m) => m.slug));

  for (const [index, m] of TRAINING_MODULES.entries()) {
    const screens = screenCount(m.content);
    if (have.has(m.slug)) {
      console.log(`skip  ${m.slug} (already in the database)`);
      continue;
    }
    console.log(`${execute ? "add " : "would add"}  ${index + 1}. ${m.title} — ${screens} screens, ${m.questions.length} questions`);
    if (!execute) continue;

    const { data: row, error: insErr } = await supabase
      .from("training_modules")
      .insert({ slug: m.slug, title: m.title, summary: m.summary, order_index: index + 1, content_md: m.content })
      .select("id")
      .single();
    if (insErr || !row) throw new Error(insErr?.message ?? "insert failed");

    const { error: qErr } = await supabase.from("training_questions").insert(
      m.questions.map((q, n) => ({
        module_id: row.id,
        order_index: n + 1,
        kind: q.kind ?? "mcq",
        scenario: q.scenario ?? null,
        prompt: q.prompt,
        options: q.options,
        correct_index: q.correct,
        explanation: q.explanation,
      })),
    );
    if (qErr) {
      await supabase.from("training_modules").delete().eq("id", row.id); // so a rerun adds it whole
      throw new Error(qErr.message);
    }
  }
  if (!execute) console.log("\nDry run. Add --execute to write.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
