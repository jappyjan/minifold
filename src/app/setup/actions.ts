"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDatabase } from "@/server/db";
import { createUser, hasAnyAdmin } from "@/server/db/users";
import {
  createProvider,
  findProviderBySlug,
  generateUniqueSlug,
  hasAnyProvider,
  type S3Config,
} from "@/server/db/providers";
import { hashPassword } from "@/server/auth/password";
import { createSession } from "@/server/auth/session";
import { writeSessionCookie } from "@/server/auth/cookies";

const schema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  username: z
    .string()
    .trim()
    .regex(/^[a-z0-9_-]{3,64}$/i, "Username: 3-64 chars, letters/digits/_/- only"),
  password: z.string().min(12, "Password must be at least 12 characters"),
});

export type SetupFormState = {
  error?: string;
  fieldErrors?: Partial<Record<"name" | "username" | "password", string>>;
};

export async function createAdmin(
  _prev: SetupFormState,
  formData: FormData,
): Promise<SetupFormState> {
  const db = getDatabase();
  if (hasAnyAdmin(db)) {
    return { error: "Setup has already been completed." };
  }

  const parsed = schema.safeParse({
    name: formData.get("name"),
    username: formData.get("username"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    const fieldErrors: SetupFormState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as "name" | "username" | "password";
      fieldErrors[key] = issue.message;
    }
    return { fieldErrors };
  }

  const passwordHash = await hashPassword(parsed.data.password);
  const user = createUser(db, {
    name: parsed.data.name,
    username: parsed.data.username,
    passwordHash,
    role: "admin",
    mustChangePassword: false,
  });

  const { token, expiresAt } = createSession(db, user.id);
  await writeSessionCookie(token, expiresAt);
  revalidatePath("/", "layout");
  redirect("/");
}

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

const localProviderSchema = z.object({
  type: z.literal("local"),
  name: z.string().trim().min(1, "Name is required").max(200),
  rootPath: z.string().trim().min(1, "Root path is required"),
  slug: slugField,
});

const s3ProviderSchema = z.object({
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

const providerSchema = z.discriminatedUnion("type", [
  localProviderSchema,
  s3ProviderSchema,
]);

export type ProviderFormState = {
  error?: string;
  fieldErrors?: Partial<Record<string, string>>;
};

export async function createFirstProvider(
  _prev: ProviderFormState,
  formData: FormData,
): Promise<ProviderFormState> {
  const db = getDatabase();
  if (hasAnyProvider(db)) {
    return { error: "A provider already exists." };
  }

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

  let slug: string;
  if (parsed.data.slug) {
    if (findProviderBySlug(db, parsed.data.slug)) {
      return { fieldErrors: { slug: "Slug already in use" } };
    }
    slug = parsed.data.slug;
  } else {
    slug = generateUniqueSlug(db, parsed.data.name);
  }

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

  revalidatePath("/", "layout");
  redirect("/");
}
