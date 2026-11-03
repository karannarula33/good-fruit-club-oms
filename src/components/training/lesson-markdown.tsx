// Renders a parsed lesson screen (src/lib/training/markdown.ts). No HTML is
// injected: every node is a React element, so lesson text can't run script.
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import type { Block, Inline } from "@/lib/training/markdown";

export function InlineText({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.t) {
          case "text":
            return <span key={i}>{n.v}</span>;
          case "bold":
            return (
              <strong key={i} className="font-bold text-foreground">
                <InlineText nodes={n.v} />
              </strong>
            );
          case "italic":
            return (
              <em key={i}>
                <InlineText nodes={n.v} />
              </em>
            );
          case "code":
            return (
              <code key={i} className="rounded bg-neutral-bg px-1 py-0.5 text-[0.92em]">
                {n.v}
              </code>
            );
          case "link":
            return n.href.startsWith("/") ? (
              <Link key={i} href={n.href} className="font-semibold text-brand underline-offset-2 hover:underline">
                <InlineText nodes={n.v} />
              </Link>
            ) : (
              <a key={i} href={n.href} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand underline-offset-2 hover:underline">
                <InlineText nodes={n.v} />
              </a>
            );
        }
      })}
    </>
  );
}

// `renderTryIt` lets the module player draw the interactive "Try it" card.
export function LessonBlocks({
  blocks,
  renderTryIt,
}: {
  blocks: Block[];
  renderTryIt?: (b: Extract<Block, { t: "tryit" }>, key: number) => React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 font-sans text-[14.5px] leading-relaxed text-foreground">
      {blocks.map((b, i) => {
        switch (b.t) {
          case "heading":
            return b.level === 2 ? (
              <h3 key={i} className="pt-1 font-display text-base font-bold text-foreground">
                <InlineText nodes={b.v} />
              </h3>
            ) : (
              <h4 key={i} className="pt-1 font-sans text-sm font-bold text-foreground">
                <InlineText nodes={b.v} />
              </h4>
            );
          case "paragraph":
            return (
              <p key={i}>
                <InlineText nodes={b.v} />
              </p>
            );
          case "list": {
            const Tag = b.ordered ? "ol" : "ul";
            return (
              <Tag key={i} className={b.ordered ? "list-decimal space-y-1.5 pl-5" : "list-disc space-y-1.5 pl-5"}>
                {b.items.map((it, j) => (
                  <li key={j}>
                    <InlineText nodes={it} />
                  </li>
                ))}
              </Tag>
            );
          }
          case "table":
            return (
              <div key={i} className="-mx-1 overflow-x-auto">
                <table className="w-full border-collapse text-[13px]">
                  <thead>
                    <tr>
                      {b.header.map((h, j) => (
                        <th key={j} className="border-b border-[#ECEAE3] px-2 py-1.5 text-left font-bold text-muted">
                          <InlineText nodes={h} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((r, j) => (
                      <tr key={j} className="align-top">
                        {r.map((c, k) => (
                          <td key={k} className="border-b border-[#F3F1EA] px-2 py-1.5">
                            <InlineText nodes={c} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "quote":
            return b.flag ? (
              <div key={i} className="flex gap-2 rounded-xl bg-warning-bg px-3 py-2.5 text-[13.5px] text-warning-text">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <p>
                  <InlineText nodes={b.v.length && b.v[0].t === "text" ? [{ t: "text", v: b.v[0].v.replace(/^⚠️\s*/, "") }, ...b.v.slice(1)] : b.v} />
                </p>
              </div>
            ) : (
              <p key={i} className="rounded-xl bg-neutral-bg px-3 py-2.5 text-[13.5px] text-neutral-text">
                <InlineText nodes={b.v} />
              </p>
            );
          case "tryit":
            return renderTryIt ? (
              renderTryIt(b, i)
            ) : (
              <div key={i} className="rounded-xl border border-dashed border-brand/50 px-3 py-2.5 text-[13.5px]">
                <p className="font-bold">Try it: {b.title}</p>
                <ol className="mt-1 list-decimal pl-5">
                  {b.steps.map((s, j) => (
                    <li key={j}>
                      <InlineText nodes={s} />
                    </li>
                  ))}
                </ol>
              </div>
            );
        }
      })}
    </div>
  );
}
