// The small Markdown dialect the Learn GFC lessons are written in (and the
// admin edits): a module's content_md is split into screens by a line that is
// just "---"; each screen's first "## " heading is its title. Inside a screen:
//   ## / ### headings, paragraphs, - bullet and 1. numbered lists,
//   | tables |, > quotes ("> Check with Karan: ..." shows as a flag),
//   **bold**, *italic*, `code`, [links](/admin/orders),
//   and "try it" steps:
//     ```tryit
//     title: Find today's route
//     href: /delivery
//     - Open Route
//     - Look at which stops are out for delivery
//     ```
// Parsed into plain data (no HTML), rendered by src/components/training/markdown.tsx.

export type Inline =
  | { t: "text"; v: string }
  | { t: "bold"; v: Inline[] }
  | { t: "italic"; v: Inline[] }
  | { t: "code"; v: string }
  | { t: "link"; href: string; v: Inline[] };

export type Block =
  | { t: "heading"; level: 2 | 3; v: Inline[] }
  | { t: "paragraph"; v: Inline[] }
  | { t: "list"; ordered: boolean; items: Inline[][] }
  | { t: "table"; header: Inline[][]; rows: Inline[][][] }
  | { t: "quote"; flag: boolean; v: Inline[] }
  | { t: "tryit"; title: string; href: string | null; steps: Inline[][] };

export interface Screen {
  title: string;
  blocks: Block[];
}

// Safe link targets only: in-app paths, or http(s).
export function safeHref(href: string): string | null {
  const h = href.trim();
  if (/^\/(?![/\\])/.test(h)) return h;
  if (/^https?:\/\//i.test(h)) return h;
  return null;
}

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let i = 0;
  let buf = "";
  const flush = () => {
    if (buf) out.push({ t: "text", v: buf });
    buf = "";
  };
  while (i < src.length) {
    const rest = src.slice(i);
    // Escaped characters (\[ \] \* etc. from the doc export).
    if (rest[0] === "\\" && rest.length > 1 && /[\\[\]*_`|~>#-]/.test(rest[1])) {
      buf += rest[1];
      i += 2;
      continue;
    }
    let m = /^\*\*(.+?)\*\*/.exec(rest);
    if (m) {
      flush();
      out.push({ t: "bold", v: parseInline(m[1]) });
      i += m[0].length;
      continue;
    }
    m = /^\*(?!\s)(.+?)\*/.exec(rest);
    if (m) {
      flush();
      out.push({ t: "italic", v: parseInline(m[1]) });
      i += m[0].length;
      continue;
    }
    m = /^`([^`]+)`/.exec(rest);
    if (m) {
      flush();
      out.push({ t: "code", v: m[1] });
      i += m[0].length;
      continue;
    }
    m = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(rest);
    if (m) {
      const href = safeHref(m[2]);
      flush();
      if (href) out.push({ t: "link", href, v: parseInline(m[1]) });
      else out.push(...parseInline(m[1]));
      i += m[0].length;
      continue;
    }
    buf += rest[0];
    i += 1;
  }
  flush();
  return out;
}

const splitRow = (line: string) =>
  line.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim());

export function parseBlocks(md: string): Block[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) {
      i++;
      continue;
    }
    if (/^```tryit\s*$/.test(trimmed)) {
      let title = "Try it";
      let href: string | null = null;
      const steps: Inline[][] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i].trim())) {
        const l = lines[i].trim();
        let m: RegExpExecArray | null;
        if ((m = /^title:\s*(.+)$/i.exec(l))) title = m[1];
        else if ((m = /^href:\s*(.+)$/i.exec(l))) href = safeHref(m[1]);
        else if ((m = /^(?:[-*]|\d+\.)\s+(.+)$/.exec(l))) steps.push(parseInline(m[1]));
        else if (l) steps.push(parseInline(l));
        i++;
      }
      i++; // closing fence
      blocks.push({ t: "tryit", title, href, steps });
      continue;
    }
    let m = /^(#{2,3})\s+(.+)$/.exec(trimmed);
    if (m) {
      blocks.push({ t: "heading", level: m[1].length as 2 | 3, v: parseInline(m[2]) });
      i++;
      continue;
    }
    if (trimmed.startsWith("|")) {
      const rows: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(lines[i++].trim());
      const cells = rows.map(splitRow);
      const isSep = (r: string[]) => r.every((c) => /^:?-{2,}:?$/.test(c));
      const header = cells[0];
      const body = cells.slice(1).filter((r) => !isSep(r));
      blocks.push({ t: "table", header: header.map(parseInline), rows: body.map((r) => r.map(parseInline)) });
      continue;
    }
    if (trimmed.startsWith(">")) {
      const parts: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) parts.push(lines[i++].trim().replace(/^>\s?/, ""));
      const text = parts.join(" ");
      blocks.push({ t: "quote", flag: /^(⚠️\s*)?(\*\*)?check with karan/i.test(text), v: parseInline(text) });
      continue;
    }
    if ((m = /^([-*]|\d+\.)\s+/.exec(trimmed))) {
      const ordered = /\d/.test(m[1]);
      const items: Inline[][] = [];
      while (i < lines.length) {
        const l = lines[i].trim();
        const im = /^([-*]|\d+\.)\s+(.+)$/.exec(l);
        if (!im || /\d/.test(im[1]) !== ordered) break;
        items.push(parseInline(im[2]));
        i++;
      }
      blocks.push({ t: "list", ordered, items });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length) {
      const l = lines[i].trim();
      if (para.length > 0 && (!l || /^(#{2,3}\s|```|\||>|[-*]\s|\d+\.\s)/.test(l))) break;
      if (!l) break;
      // A line no other rule takes (e.g. a stray ``` fence) is plain text,
      // so the parser always moves forward.
      para.push(l);
      i++;
    }
    blocks.push({ t: "paragraph", v: parseInline(para.join(" ")) });
  }
  return blocks;
}

export function inlineText(v: Inline[]): string {
  return v.map((n) => (n.t === "text" || n.t === "code" ? n.v : inlineText(n.v))).join("");
}

// Screens of a module: chunks between lines that are just "---".
export function splitScreens(contentMd: string): Screen[] {
  const chunks = contentMd
    .replace(/\r\n/g, "\n")
    .split(/\n\s*---\s*\n/)
    .map((c) => c.trim())
    .filter(Boolean);
  return chunks.map((chunk, n) => {
    const blocks = parseBlocks(chunk);
    const first = blocks.find((b) => b.t === "heading");
    const title = first && first.t === "heading" ? inlineText(first.v) : `Part ${n + 1}`;
    return { title, blocks: first ? blocks.filter((b) => b !== first) : blocks };
  });
}

export function screenCount(contentMd: string): number {
  return splitScreens(contentMd).length;
}
