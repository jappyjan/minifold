export type FileKind = "md" | "pdf" | "stl" | "3mf" | "image" | "other";

const EXT_TO_KIND: Record<string, FileKind> = {
  md: "md",
  markdown: "md",
  pdf: "pdf",
  stl: "stl",
  "3mf": "3mf",
  jpg: "image",
  jpeg: "image",
  png: "image",
  webp: "image",
  gif: "image",
};

export function fileKindOf(name: string): FileKind {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return "other";
  const ext = name.slice(dot + 1).toLowerCase();
  return EXT_TO_KIND[ext] ?? "other";
}
