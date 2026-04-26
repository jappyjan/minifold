// Minimal, no-deps frontmatter parser. Only extracts `tags`. Anything else
// in the frontmatter is dropped from the body but otherwise ignored.
//
// Recognised tag forms:
//   tags:
//     - one
//     - two
//   tags: [one, two]
//   tags: one, two
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseFrontmatter(src: string): {
  tags: string[];
  body: string;
} {
  const m = FRONTMATTER_RE.exec(src);
  if (!m) return { tags: [], body: src };
  const fmBody = m[1] ?? "";
  const body = src.slice(m[0].length);
  const tags = extractTags(fmBody);
  return { tags, body };
}

function extractTags(fm: string): string[] {
  const lines = fm.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const inline = /^tags:\s*(.*)$/.exec(line);
    if (!inline) continue;
    const value = (inline[1] ?? "").trim();
    if (value === "") {
      // Block list on subsequent lines
      const out: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        const item = /^\s*-\s*(.+?)\s*$/.exec(lines[j] ?? "");
        if (!item) break;
        out.push(stripQuotes(item[1] ?? ""));
      }
      return out;
    }
    if (value.startsWith("[") && value.endsWith("]")) {
      // Flow-style list
      return value
        .slice(1, -1)
        .split(",")
        .map((s) => stripQuotes(s.trim()))
        .filter((s) => s.length > 0);
    }
    // Comma-separated string
    return value
      .split(",")
      .map((s) => stripQuotes(s.trim()))
      .filter((s) => s.length > 0);
  }
  return [];
}

function stripQuotes(s: string): string {
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1);
  }
  return s;
}
