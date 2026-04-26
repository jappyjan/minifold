"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getDatabase } from "@/server/db";
import {
  createProvider,
  deleteProvider as dbDeleteProvider,
  findProviderBySlug,
  generateUniqueSlug,
} from "@/server/db/providers";
import type { S3Config } from "@/server/db/providers";
import { isReservedSlug } from "@/server/browse/reserved-slugs";

// ── Zod schemas ──────────────────────────────────────────────────────────────

const slugField = z.preprocess(
  (v) => {
    if (v == null) return undefined;
    if (typeof v === "string" && v.trim() === "") return undefined;
    return v;
  },
  z
    .string()
    .trim()
    .regex(/^[a-z0-9-]{1,32}$/i, "Slug: 1-32 chars, letters/digits/- only")
    .optional(),
);

const localSchema = z.object({
  type: z.literal("local"),
  name: z.string().trim().min(1, "Name is required").max(200),
  rootPath: z.string().trim().min(1, "Root path is required"),
  slug: slugField,
});

const s3Schema = z.object({
  type: z.literal("s3"),
  name: z.string().trim().min(1, "Name is required").max(200),
  bucket: z.string().trim().min(1, "Bucket is required"),
  region: z.string().trim().min(1, "Region is required"),
  accessKeyId: z.string().trim().min(1, "Access Key ID is required"),
  secretAccessKey: z.string().trim().min(1, "Secret Access Key is required"),
  endpoint: z.string().trim().default(""),
  pathStyle: z
    .preprocess((v) => v === "true" || v === "on" || v === true, z.boolean())
    .default(false),
  slug: slugField,
});

const providerSchema = z.discriminatedUnion("type", [localSchema, s3Schema]);

// ── Types ─────────────────────────────────────────────────────────────────────

export type AddProviderFormState = {
  success?: boolean;
  error?: string;
  fieldErrors?: Partial<Record<string, string>>;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function resolveSlug(
  db: ReturnType<typeof getDatabase>,
  providedSlug: string | undefined,
  name: string,
): Promise<{ slug: string } | { fieldErrors: { slug: string } }> {
  if (providedSlug) {
    if (findProviderBySlug(db, providedSlug)) {
      return { fieldErrors: { slug: "Slug already in use" } };
    }
    return { slug: providedSlug };
  }
  return { slug: generateUniqueSlug(db, name) };
}

// ── Actions ───────────────────────────────────────────────────────────────────

export async function addProvider(
  _prev: AddProviderFormState,
  formData: FormData,
): Promise<AddProviderFormState> {
  const raw = {
    type: formData.get("type") ?? "local",
    name: formData.get("name"),
    rootPath: formData.get("rootPath"),
    bucket: formData.get("bucket"),
    region: formData.get("region"),
    accessKeyId: formData.get("accessKeyId"),
    secretAccessKey: formData.get("secretAccessKey"),
    endpoint: formData.get("endpoint") ?? "",
    pathStyle: formData.get("pathStyle") ?? undefined,
    slug: formData.get("slug"),
  };

  const parsed = providerSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { fieldErrors };
  }

  if (parsed.data.slug && isReservedSlug(parsed.data.slug)) {
    return { fieldErrors: { slug: "Slug is reserved" } };
  }

  const db = getDatabase();
  const slugResult = await resolveSlug(db, parsed.data.slug, parsed.data.name);
  if ("fieldErrors" in slugResult) return slugResult;
  const { slug } = slugResult;

  try {
    if (parsed.data.type === "local") {
      createProvider(db, {
        slug,
        name: parsed.data.name,
        type: "local",
        config: { rootPath: parsed.data.rootPath },
      });
    } else {
      const s3Config: S3Config = {
        bucket: parsed.data.bucket,
        region: parsed.data.region,
        accessKeyId: parsed.data.accessKeyId,
        secretAccessKey: parsed.data.secretAccessKey,
        endpoint: parsed.data.endpoint,
        pathStyle: parsed.data.pathStyle,
      };
      createProvider(db, { slug, name: parsed.data.name, type: "s3", config: s3Config });
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to create provider" };
  }

  revalidatePath("/admin/providers");
  revalidatePath("/", "layout");
  return { success: true };
}

export async function deleteProvider(
  _prev: unknown,
  formData: FormData,
): Promise<undefined> {
  const slug = formData.get("slug");
  if (typeof slug !== "string" || !slug) return;
  const db = getDatabase();
  dbDeleteProvider(db, slug);
  revalidatePath("/admin/providers");
  revalidatePath("/", "layout");
}
