"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { dirname, join } from "node:path";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { getDatabase } from "@/server/db";
import { getSetting, setSetting } from "@/server/db/settings";
import { validateAccent } from "@/server/auth/contrast";
import {
  writeLogo,
  clearLogo as clearLogoFile,
  regenerateMaskable,
} from "@/server/settings/logo-storage";

const MAX_LOGO_BYTES = 256 * 1024;

export type SimpleFormState<K extends string = string> = {
  success?: true;
  error?: string;
  fieldErrors?: Partial<Record<K, string>>;
};

function dataDir(): string {
  const dbPath = process.env.DATABASE_PATH ?? "/app/data/minifold.db";
  return dirname(dbPath);
}

// ── App name ─────────────────────────────────────────────────────────────────

const appNameSchema = z.object({
  value: z.string().trim().min(1, "Name is required").max(60, "Name must be 60 chars or fewer"),
});

export async function saveAppName(
  _prev: SimpleFormState<"value">,
  formData: FormData,
): Promise<SimpleFormState<"value">> {
  const parsed = appNameSchema.safeParse({ value: formData.get("value") });
  if (!parsed.success) {
    return { fieldErrors: { value: parsed.error.issues[0]?.message ?? "Invalid" } };
  }
  setSetting(getDatabase(), "app_name", parsed.data.value);
  revalidatePath("/", "layout");
  return { success: true };
}

// ── Logo ─────────────────────────────────────────────────────────────────────

const logoUrlSchema = z.object({
  source: z.literal("url"),
  url: z
    .string()
    .trim()
    .min(1, "URL is required")
    .refine(
      (s) => /^(https?:\/\/|\/)/.test(s),
      "Must start with http://, https://, or /",
    ),
});

export async function saveLogo(
  _prev: SimpleFormState<"url" | "file">,
  formData: FormData,
): Promise<SimpleFormState<"url" | "file">> {
  const source = formData.get("source");
  if (source === "url") {
    const parsed = logoUrlSchema.safeParse({
      source,
      url: formData.get("url"),
    });
    if (!parsed.success) {
      return { fieldErrors: { url: parsed.error.issues[0]?.message ?? "Invalid URL" } };
    }
    setSetting(getDatabase(), "logo_url", parsed.data.url);
    revalidatePath("/", "layout");
    revalidatePath("/api/logo");
    return { success: true };
  }

  if (source !== "upload") return { error: "Invalid source" };

  const fileEntry = formData.get("file");
  if (!(fileEntry instanceof Blob)) {
    return { fieldErrors: { file: "No file provided" } };
  }
  if (fileEntry.size > MAX_LOGO_BYTES) {
    return { fieldErrors: { file: `Max size is ${MAX_LOGO_BYTES} bytes (256 KB)` } };
  }
  const buf = Buffer.from(await fileEntry.arrayBuffer());
  let ext: "png" | "svg" | "webp";
  try {
    const accentHex = getSetting(getDatabase(), "accent_color") ?? "#3b82f6";
    ext = await writeLogo(dataDir(), buf, accentHex);
  } catch (e) {
    return { fieldErrors: { file: e instanceof Error ? e.message : "Unsupported type" } };
  }
  setSetting(getDatabase(), "logo_url", `internal:${ext}`);
  revalidatePath("/", "layout");
  revalidatePath("/api/logo");
  revalidatePath("/api/icon/180/any.png");
  revalidatePath("/api/icon/192/any.png");
  revalidatePath("/api/icon/512/any.png");
  revalidatePath("/api/icon/512/maskable.png");
  revalidatePath("/manifest.webmanifest");
  return { success: true };
}

export async function clearLogo(): Promise<void> {
  clearLogoFile(dataDir());
  setSetting(getDatabase(), "logo_url", "");
  revalidatePath("/", "layout");
  revalidatePath("/api/logo");
  revalidatePath("/api/icon/180/any.png");
  revalidatePath("/api/icon/192/any.png");
  revalidatePath("/api/icon/512/any.png");
  revalidatePath("/api/icon/512/maskable.png");
  revalidatePath("/manifest.webmanifest");
}

// ── Accent colour ────────────────────────────────────────────────────────────

const HEX_RE = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;
const accentSchema = z.object({
  value: z
    .string()
    .trim()
    .regex(HEX_RE, "Must be a hex colour like #3b82f6"),
});

export async function saveAccentColor(
  _prev: SimpleFormState<"value">,
  formData: FormData,
): Promise<SimpleFormState<"value">> {
  const parsed = accentSchema.safeParse({ value: formData.get("value") });
  if (!parsed.success) {
    return { fieldErrors: { value: parsed.error.issues[0]?.message ?? "Invalid colour" } };
  }
  if (!validateAccent(parsed.data.value).passes) {
    return {
      fieldErrors: {
        value: "Colour fails WCAG AA contrast on light or dark background",
      },
    };
  }
  setSetting(getDatabase(), "accent_color", parsed.data.value);
  // If a logo is currently uploaded, regenerate the maskable variant against the new accent.
  const dir = dataDir();
  let logoFile: string | null = null;
  for (const e of ["png", "webp", "svg"] as const) {
    const p = join(dir, `logo.${e}`);
    if (existsSync(p)) { logoFile = p; break; }
  }
  if (logoFile) {
    const buf = await readFile(logoFile);
    await regenerateMaskable(dir, buf, parsed.data.value);
    revalidatePath("/api/icon/512/maskable.png");
  }
  revalidatePath("/manifest.webmanifest");
  revalidatePath("/", "layout");
  return { success: true };
}
