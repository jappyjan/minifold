export type FileKind =
  | "md"
  | "pdf"
  | "stl"
  | "3mf"
  | "step"
  | "obj"
  | "gcode"
  | "bgcode"
  | "f3d"
  | "image"
  | "other";

const EXT_TO_KIND: Record<string, FileKind> = {
  // documents
  md: "md",
  markdown: "md",
  pdf: "pdf",
  // 3D models
  stl: "stl",
  "3mf": "3mf",
  step: "step",
  stp: "step",
  obj: "obj",
  gcode: "gcode",
  bgcode: "bgcode",
  f3d: "f3d",
  // images
  jpg: "image",
  jpeg: "image",
  png: "image",
  webp: "image",
  gif: "image",
  svg: "image",
};

export function fileKindOf(name: string): FileKind {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return "other";
  const ext = name.slice(dot + 1).toLowerCase();
  return EXT_TO_KIND[ext] ?? "other";
}
