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

const providerSchema = z.object({
  slug: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z
      .string()
      .trim()
      .regex(/^[a-z0-9-]{1,32}$/i, "Slug: 1-32 chars, letters/digits/- only")
      .optional(),
  ),
  name: z.string().trim().min(1, "Name is required").max(200),
  rootPath: z.string().trim().min(1, "Root path is required"),
});

export type ProviderFormState = {
  error?: string;
  fieldErrors?: Partial<Record<"slug" | "name" | "rootPath", string>>;
};

export async function createFirstProvider(
  _prev: ProviderFormState,
  formData: FormData,
): Promise<ProviderFormState> {
  const db = getDatabase();
  if (hasAnyProvider(db)) {
    return { error: "A provider already exists." };
  }

  const parsed = providerSchema.safeParse({
    slug: formData.get("slug"),
    name: formData.get("name"),
    rootPath: formData.get("rootPath"),
  });
  if (!parsed.success) {
    const fieldErrors: ProviderFormState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as "slug" | "name" | "rootPath";
      fieldErrors[key] = issue.message;
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

  createProvider(db, {
    slug,
    name: parsed.data.name,
    type: "local",
    config: { rootPath: parsed.data.rootPath },
  });

  revalidatePath("/", "layout");
  redirect("/");
}
