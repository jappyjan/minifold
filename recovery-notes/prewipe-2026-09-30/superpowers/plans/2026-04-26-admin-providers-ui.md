# Admin Providers UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/admin/providers` — a web UI for listing, adding (local + S3), and removing storage providers — and update the setup wizard to also support S3.

**Architecture:** Next.js App Router Server Components for data fetching, Server Actions for mutations, a thin client shell (`"use client"`) for the slide-over open/close state. Auth guard lives in a shared `/admin/layout.tsx` that checks `getCurrentUser()` server-side.

**Tech Stack:** Next.js 16 App Router, React 19 (`useActionState`, `useCallback`), Server Actions, Zod, better-sqlite3, Tailwind v4, Vitest.

---

## File Map

| Status | Path | Responsibility |
|---|---|---|
| **Create** | `src/app/admin/layout.tsx` | Auth guard: redirect non-admins |
| **Create** | `src/app/admin/page.tsx` | Redirect `/admin` → `/admin/providers` |
| **Create** | `src/app/admin/providers/page.tsx` | RSC: loads providers, renders client shell |
| **Create** | `src/app/admin/providers/actions.ts` | `addProvider` + `deleteProvider` Server Actions |
| **Create** | `src/components/admin/ProvidersPageClient.tsx` | Client wrapper: slide-over open/close state + list |
| **Create** | `src/components/admin/AddProviderSlideOver.tsx` | Slide-over panel: owns `useActionState`, detects success |
| **Create** | `src/components/admin/AddProviderForm.tsx` | Form: type toggle, local/S3 fields, validation display |
| **Create** | `tests/app/admin/providers/actions.test.ts` | Unit tests for Server Actions |
| **Modify** | `src/components/setup/ProviderForm.tsx` | Add S3 type toggle + S3 fields |
| **Modify** | `src/app/setup/actions.ts` | Add S3 Zod branch to `createFirstProvider` |

---

## Task 1: Admin auth guard + redirect page

**Files:**
- Create: `src/app/admin/layout.tsx`
- Create: `src/app/admin/page.tsx`

- [ ] **Step 1: Create the admin layout (auth guard)**

```tsx
// src/app/admin/layout.tsx
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/current-user";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/");
  return <>{children}</>;
}
```

- [ ] **Step 2: Create the /admin redirect page**

```tsx
// src/app/admin/page.tsx
import { redirect } from "next/navigation";

export default function AdminPage() {
  redirect("/admin/providers");
}
```

- [ ] **Step 3: Verify the build is clean**

```bash
cd /Users/jappy/code/jappyjan/minifold && pnpm build 2>&1 | tail -10
```

Expected: no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/layout.tsx src/app/admin/page.tsx
git commit -m "feat(admin): /admin layout with auth guard + redirect to /admin/providers"
```

---

## Task 2: Server Actions — addProvider + deleteProvider (TDD)

**Files:**
- Create: `src/app/admin/providers/actions.ts`
- Create: `tests/app/admin/providers/actions.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/app/admin/providers/actions.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createDatabase } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { findProviderBySlug, hasAnyProvider } from "@/server/db/providers";

// Mock Next.js modules before any imports that use them
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "minifold-admin-actions-"));
  // Seed a real DB at a temp path; getDatabase() picks this up via env var
  const db = createDatabase(join(tmp, "test.db"));
  runMigrations(db, resolve(process.cwd(), "src/server/db/migrations"));
  db.close();
  vi.stubEnv("DATABASE_PATH", join(tmp, "test.db"));
  vi.resetModules();
});

afterEach(async () => {
  const { __resetDatabase } = await import("@/server/db");
  __resetDatabase();
  vi.unstubAllEnvs();
  rmSync(tmp, { recursive: true, force: true });
});

function makeFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

describe("addProvider — local", () => {
  it("returns fieldErrors when name is empty", async () => {
    const { addProvider } = await import(
      "@/app/admin/providers/actions"
    );
    const state = await addProvider({}, makeFormData({ type: "local", name: "", rootPath: "/files" }));
    expect(state.fieldErrors?.name).toBeTruthy();
  });

  it("returns fieldErrors when rootPath is empty", async () => {
    const { addProvider } = await import("@/app/admin/providers/actions");
    const state = await addProvider({}, makeFormData({ type: "local", name: "NAS", rootPath: "" }));
    expect(state.fieldErrors?.rootPath).toBeTruthy();
  });

  it("returns fieldErrors when slug is invalid", async () => {
    const { addProvider } = await import("@/app/admin/providers/actions");
    const state = await addProvider(
      {},
      makeFormData({ type: "local", name: "NAS", rootPath: "/files", slug: "Bad Slug!" }),
    );
    expect(state.fieldErrors?.slug).toBeTruthy();
  });

  it("creates a local provider and returns success", async () => {
    const { addProvider } = await import("@/app/admin/providers/actions");
    const { getDatabase } = await import("@/server/db");
    const state = await addProvider(
      {},
      makeFormData({ type: "local", name: "NAS", rootPath: "/files" }),
    );
    expect(state.success).toBe(true);
    expect(state.fieldErrors).toBeUndefined();
    const row = findProviderBySlug(getDatabase(), "nas");
    expect(row).not.toBeNull();
    expect(row?.type).toBe("local");
    expect((row?.config as { rootPath: string }).rootPath).toBe("/files");
  });

  it("returns fieldErrors when slug already exists", async () => {
    const { addProvider } = await import("@/app/admin/providers/actions");
    await addProvider({}, makeFormData({ type: "local", name: "NAS", rootPath: "/files", slug: "nas" }));
    vi.resetModules();
    const { addProvider: addProvider2 } = await import("@/app/admin/providers/actions");
    const state = await addProvider2(
      {},
      makeFormData({ type: "local", name: "NAS2", rootPath: "/files2", slug: "nas" }),
    );
    expect(state.fieldErrors?.slug).toBeTruthy();
  });
});

describe("addProvider — S3", () => {
  it("returns fieldErrors when bucket is empty", async () => {
    const { addProvider } = await import("@/app/admin/providers/actions");
    const state = await addProvider(
      {},
      makeFormData({
        type: "s3",
        name: "B2",
        bucket: "",
        region: "us-east-1",
        accessKeyId: "AKID",
        secretAccessKey: "SECRET",
      }),
    );
    expect(state.fieldErrors?.bucket).toBeTruthy();
  });

  it("returns fieldErrors when region is empty", async () => {
    const { addProvider } = await import("@/app/admin/providers/actions");
    const state = await addProvider(
      {},
      makeFormData({
        type: "s3",
        name: "B2",
        bucket: "my-bucket",
        region: "",
        accessKeyId: "AKID",
        secretAccessKey: "SECRET",
      }),
    );
    expect(state.fieldErrors?.region).toBeTruthy();
  });

  it("creates an S3 provider and returns success", async () => {
    const { addProvider } = await import("@/app/admin/providers/actions");
    const { getDatabase } = await import("@/server/db");
    const state = await addProvider(
      {},
      makeFormData({
        type: "s3",
        name: "Backblaze",
        bucket: "my-bucket",
        region: "us-west-001",
        accessKeyId: "AKID",
        secretAccessKey: "SECRET",
        endpoint: "https://s3.us-west-001.backblazeb2.com",
      }),
    );
    expect(state.success).toBe(true);
    const row = findProviderBySlug(getDatabase(), "backblaze");
    expect(row?.type).toBe("s3");
    const cfg = row?.config as {
      bucket: string;
      region: string;
      accessKeyId: string;
      endpoint: string;
    };
    expect(cfg.bucket).toBe("my-bucket");
    expect(cfg.region).toBe("us-west-001");
    expect(cfg.endpoint).toBe("https://s3.us-west-001.backblazeb2.com");
  });
});

describe("deleteProvider", () => {
  it("removes an existing provider", async () => {
    const { addProvider, deleteProvider } = await import(
      "@/app/admin/providers/actions"
    );
    const { getDatabase } = await import("@/server/db");
    await addProvider({}, makeFormData({ type: "local", name: "NAS", rootPath: "/files", slug: "nas" }));
    expect(hasAnyProvider(getDatabase())).toBe(true);

    await deleteProvider(undefined, makeFormData({ slug: "nas" }));
    expect(hasAnyProvider(getDatabase())).toBe(false);
  });

  it("is a no-op for an unknown slug", async () => {
    const { deleteProvider } = await import("@/app/admin/providers/actions");
    // Should not throw
    await expect(
      deleteProvider(undefined, makeFormData({ slug: "nonexistent" })),
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests — confirm they all fail**

```bash
cd /Users/jappy/code/jappyjan/minifold && pnpm vitest run tests/app/admin/providers/actions.test.ts 2>&1 | tail -15
```

Expected: failures because the actions file doesn't exist yet.

- [ ] **Step 3: Create the actions file**

```ts
// src/app/admin/providers/actions.ts
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

  const db = getDatabase();
  const slugResult = await resolveSlug(db, parsed.data.slug, parsed.data.name);
  if ("fieldErrors" in slugResult) return slugResult;
  const { slug } = slugResult;

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
```

- [ ] **Step 4: Run the tests — confirm they all pass**

```bash
cd /Users/jappy/code/jappyjan/minifold && pnpm vitest run tests/app/admin/providers/actions.test.ts 2>&1 | tail -15
```

Expected: all tests pass.

- [ ] **Step 5: Run the full suite — confirm nothing regressed**

```bash
cd /Users/jappy/code/jappyjan/minifold && pnpm vitest run 2>&1 | tail -8
```

Expected: 23 test files, all pass (previous 151 + new tests).

- [ ] **Step 6: Commit**

```bash
git add src/app/admin/providers/actions.ts tests/app/admin/providers/actions.test.ts
git commit -m "feat(admin): addProvider + deleteProvider Server Actions with TDD"
```

---

## Task 3: /admin/providers page — RSC + client shell + list + delete

**Files:**
- Create: `src/app/admin/providers/page.tsx`
- Create: `src/components/admin/ProvidersPageClient.tsx`

- [ ] **Step 1: Create the RSC page**

```tsx
// src/app/admin/providers/page.tsx
import { getDatabase } from "@/server/db";
import { listProviders } from "@/server/db/providers";
import { ProvidersPageClient } from "@/components/admin/ProvidersPageClient";

export default function AdminProvidersPage() {
  const providers = listProviders(getDatabase());
  return <ProvidersPageClient providers={providers} />;
}
```

- [ ] **Step 2: Create ProvidersPageClient**

```tsx
// src/components/admin/ProvidersPageClient.tsx
"use client";

import { useCallback, useState } from "react";
import type { ProviderRow } from "@/server/db/providers";
import { deleteProvider } from "@/app/admin/providers/actions";
import { AddProviderSlideOver } from "./AddProviderSlideOver";

export function ProvidersPageClient({
  providers,
}: {
  providers: ProviderRow[];
}) {
  const [open, setOpen] = useState(false);
  const handleClose = useCallback(() => setOpen(false), []);

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Providers</h1>
        <button
          onClick={() => setOpen(true)}
          className="rounded bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        >
          + Add provider
        </button>
      </div>

      {providers.length === 0 ? (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          No providers yet.{" "}
          <button
            onClick={() => setOpen(true)}
            className="underline hover:no-underline"
          >
            Add one
          </button>
          .
        </p>
      ) : (
        <ul className="divide-y divide-neutral-200 rounded border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
          {providers.map((p) => (
            <li
              key={p.slug}
              className="flex items-center justify-between px-4 py-3"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{p.name}</span>
                <span className="font-mono text-xs text-neutral-500 dark:text-neutral-400">
                  {p.slug}
                </span>
                <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs dark:bg-neutral-800">
                  {p.type}
                </span>
              </div>
              <form
                action={deleteProvider}
                onSubmit={(e) => {
                  if (
                    !window.confirm(
                      `Remove provider "${p.name}"? This cannot be undone.`,
                    )
                  ) {
                    e.preventDefault();
                  }
                }}
              >
                <input type="hidden" name="slug" value={p.slug} />
                <button
                  type="submit"
                  className="text-xs text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
                >
                  Remove
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      <AddProviderSlideOver open={open} onClose={handleClose} />
    </div>
  );
}
```

- [ ] **Step 3: Create a placeholder AddProviderSlideOver so the build compiles**

```tsx
// src/components/admin/AddProviderSlideOver.tsx
"use client";

export function AddProviderSlideOver({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose}>
      <div
        className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-white p-4 shadow-xl dark:bg-neutral-950"
        onClick={(e) => e.stopPropagation()}
        role="presentation"
      >
        <p className="text-sm text-neutral-500">Add provider form — coming in next task</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify the build is clean**

```bash
cd /Users/jappy/code/jappyjan/minifold && pnpm build 2>&1 | tail -10
```

Expected: no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/providers/page.tsx src/components/admin/ProvidersPageClient.tsx src/components/admin/AddProviderSlideOver.tsx
git commit -m "feat(admin): /admin/providers page with provider list and delete"
```

---

## Task 4: AddProviderForm + full AddProviderSlideOver

**Files:**
- Create: `src/components/admin/AddProviderForm.tsx`
- Modify: `src/components/admin/AddProviderSlideOver.tsx` (replace placeholder)

- [ ] **Step 1: Create AddProviderForm**

```tsx
// src/components/admin/AddProviderForm.tsx
"use client";

import { useState } from "react";
import type { AddProviderFormState } from "@/app/admin/providers/actions";

type Props = {
  action: (formData: FormData) => void;
  state: AddProviderFormState;
  pending: boolean;
};

export function AddProviderForm({ action, state, pending }: Props) {
  const [type, setType] = useState<"local" | "s3">("local");

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="type" value={type} />

      {/* Type toggle */}
      <div>
        <p className="mb-2 text-sm font-medium">Type</p>
        <div className="flex gap-2">
          {(["local", "s3"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                type === t
                  ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                  : "border border-neutral-300 text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-900"
              }`}
            >
              {t === "local" ? "Local" : "S3"}
            </button>
          ))}
        </div>
      </div>

      {/* Name — shared */}
      <label className="flex flex-col gap-1 text-sm">
        <span>Name</span>
        <input
          name="name"
          type="text"
          required
          placeholder="e.g. NAS Files"
          className="rounded border border-neutral-300 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
        />
        {state.fieldErrors?.name && (
          <span className="text-xs text-red-600">{state.fieldErrors.name}</span>
        )}
      </label>

      {/* Local fields */}
      {type === "local" && (
        <label className="flex flex-col gap-1 text-sm">
          <span>Root path</span>
          <span className="text-xs text-neutral-500 dark:text-neutral-400">
            Absolute path inside the container, e.g.{" "}
            <code className="font-mono">/files</code>
          </span>
          <input
            name="rootPath"
            type="text"
            required
            defaultValue="/files"
            className="rounded border border-neutral-300 bg-white px-3 py-2 font-mono dark:border-neutral-700 dark:bg-neutral-900"
          />
          {state.fieldErrors?.rootPath && (
            <span className="text-xs text-red-600">
              {state.fieldErrors.rootPath}
            </span>
          )}
        </label>
      )}

      {/* S3 fields */}
      {type === "s3" && (
        <>
          <label className="flex flex-col gap-1 text-sm">
            <span>Bucket</span>
            <input
              name="bucket"
              type="text"
              required
              className="rounded border border-neutral-300 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
            />
            {state.fieldErrors?.bucket && (
              <span className="text-xs text-red-600">
                {state.fieldErrors.bucket}
              </span>
            )}
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span>Region</span>
            <input
              name="region"
              type="text"
              required
              placeholder="us-east-1"
              className="rounded border border-neutral-300 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
            />
            {state.fieldErrors?.region && (
              <span className="text-xs text-red-600">
                {state.fieldErrors.region}
              </span>
            )}
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span>Access Key ID</span>
            <input
              name="accessKeyId"
              type="text"
              required
              autoComplete="off"
              className="rounded border border-neutral-300 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
            />
            {state.fieldErrors?.accessKeyId && (
              <span className="text-xs text-red-600">
                {state.fieldErrors.accessKeyId}
              </span>
            )}
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span>Secret Access Key</span>
            <input
              name="secretAccessKey"
              type="password"
              required
              autoComplete="new-password"
              className="rounded border border-neutral-300 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
            />
            {state.fieldErrors?.secretAccessKey && (
              <span className="text-xs text-red-600">
                {state.fieldErrors.secretAccessKey}
              </span>
            )}
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span>
              Endpoint URL{" "}
              <span className="font-normal text-neutral-500">(optional)</span>
            </span>
            <span className="text-xs text-neutral-500 dark:text-neutral-400">
              For MinIO, Backblaze B2, Cloudflare R2, etc.
            </span>
            <input
              name="endpoint"
              type="text"
              placeholder="https://s3.example.com"
              className="rounded border border-neutral-300 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
            />
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input
              name="pathStyle"
              type="checkbox"
              value="true"
              className="rounded"
            />
            <span>Path-style URLs</span>
            <span className="text-xs text-neutral-500 dark:text-neutral-400">
              (needed for some self-hosted S3)
            </span>
          </label>
        </>
      )}

      {/* Advanced: slug */}
      <details className="rounded border border-neutral-200 px-3 py-2 text-sm open:pb-3 dark:border-neutral-800">
        <summary className="cursor-pointer text-neutral-600 dark:text-neutral-400">
          Advanced
        </summary>
        <label className="mt-3 flex flex-col gap-1">
          <span>Slug</span>
          <span className="text-xs text-neutral-500 dark:text-neutral-400">
            URL-safe identifier — auto-generated from name if left blank.
          </span>
          <input
            name="slug"
            type="text"
            placeholder="auto"
            className="rounded border border-neutral-300 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
          />
          {state.fieldErrors?.slug && (
            <span className="text-xs text-red-600">
              {state.fieldErrors.slug}
            </span>
          )}
        </label>
      </details>

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
      >
        {pending ? "Adding…" : "Add provider"}
      </button>
    </form>
  );
}
```

- [ ] **Step 2: Replace the placeholder AddProviderSlideOver with the full implementation**

```tsx
// src/components/admin/AddProviderSlideOver.tsx
"use client";

import { useActionState, useEffect, useRef } from "react";
import {
  addProvider,
  type AddProviderFormState,
} from "@/app/admin/providers/actions";
import { AddProviderForm } from "./AddProviderForm";

const initialState: AddProviderFormState = {};

export function AddProviderSlideOver({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState(
    addProvider,
    initialState,
  );
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  // Close on successful submission
  useEffect(() => {
    if (state.success) onClose();
    // onClose is useCallback-memoized in the parent — safe dep
  }, [state.success, onClose]);

  // Focus first input when opened
  useEffect(() => {
    if (open) {
      const first = panelRef.current?.querySelector<HTMLElement>(
        "input, button, select, textarea",
      );
      first?.focus();
    }
  }, [open]);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40"
        aria-hidden="true"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Add provider"
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-white shadow-xl dark:bg-neutral-950"
      >
        <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <h2 className="text-sm font-semibold">Add provider</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <AddProviderForm
            action={formAction}
            state={state}
            pending={pending}
          />
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 3: Verify the build is clean**

```bash
cd /Users/jappy/code/jappyjan/minifold && pnpm build 2>&1 | tail -10
```

Expected: no TypeScript errors.

- [ ] **Step 4: Run full test suite**

```bash
cd /Users/jappy/code/jappyjan/minifold && pnpm vitest run 2>&1 | tail -8
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/admin/AddProviderForm.tsx src/components/admin/AddProviderSlideOver.tsx
git commit -m "feat(admin): AddProviderForm + AddProviderSlideOver with local + S3 support"
```

---

## Task 5: Update setup wizard to support S3 (TDD)

**Files:**
- Modify: `src/app/setup/actions.ts`
- Modify: `src/components/setup/ProviderForm.tsx`
- Create: `tests/app/setup/actions.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/app/setup/actions.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createDatabase } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { findProviderBySlug } from "@/server/db/providers";
import { createUser } from "@/server/db/users";
import { hashPassword } from "@/server/auth/password";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/server/auth/cookies", () => ({ writeSessionCookie: vi.fn() }));

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "minifold-setup-actions-"));
  const db = createDatabase(join(tmp, "test.db"));
  runMigrations(db, resolve(process.cwd(), "src/server/db/migrations"));
  db.close();
  vi.stubEnv("DATABASE_PATH", join(tmp, "test.db"));
  vi.resetModules();
});

afterEach(async () => {
  const { __resetDatabase } = await import("@/server/db");
  __resetDatabase();
  vi.unstubAllEnvs();
  rmSync(tmp, { recursive: true, force: true });
});

async function seedAdmin() {
  const { getDatabase } = await import("@/server/db");
  const db = getDatabase();
  const hash = await hashPassword("password123456");
  createUser(db, {
    name: "Admin",
    username: "admin",
    passwordHash: hash,
    role: "admin",
    mustChangePassword: false,
  });
}

function makeFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

describe("createFirstProvider — S3", () => {
  it("creates an S3 provider on valid input", async () => {
    await seedAdmin();
    const { createFirstProvider } = await import("@/app/setup/actions");
    const { getDatabase } = await import("@/server/db");
    const state = await createFirstProvider(
      {},
      makeFormData({
        type: "s3",
        name: "My Bucket",
        bucket: "my-bucket",
        region: "eu-central-1",
        accessKeyId: "AKID",
        secretAccessKey: "SECRET",
      }),
    );
    // redirect is mocked so state comes back (no throw)
    const row = findProviderBySlug(getDatabase(), "my-bucket");
    expect(row?.type).toBe("s3");
    const cfg = row?.config as { bucket: string; region: string };
    expect(cfg.bucket).toBe("my-bucket");
    expect(cfg.region).toBe("eu-central-1");
  });

  it("returns fieldErrors when bucket is missing", async () => {
    await seedAdmin();
    const { createFirstProvider } = await import("@/app/setup/actions");
    const state = await createFirstProvider(
      {},
      makeFormData({
        type: "s3",
        name: "My Bucket",
        bucket: "",
        region: "eu-central-1",
        accessKeyId: "AKID",
        secretAccessKey: "SECRET",
      }),
    );
    expect(state.fieldErrors?.bucket).toBeTruthy();
  });
});

describe("createFirstProvider — local (regression)", () => {
  it("still creates a local provider on valid input", async () => {
    await seedAdmin();
    const { createFirstProvider } = await import("@/app/setup/actions");
    const { getDatabase } = await import("@/server/db");
    await createFirstProvider(
      {},
      makeFormData({ type: "local", name: "Files", rootPath: "/files" }),
    );
    const row = findProviderBySlug(getDatabase(), "files");
    expect(row?.type).toBe("local");
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
cd /Users/jappy/code/jappyjan/minifold && pnpm vitest run tests/app/setup/actions.test.ts 2>&1 | tail -15
```

Expected: failures (S3 branch not yet implemented).

- [ ] **Step 3: Update createFirstProvider in setup/actions.ts**

Replace the existing `providerSchema` and `createFirstProvider` function. The file stays exactly the same except for these two changes:

```ts
// src/app/setup/actions.ts
// Replace the existing providerSchema (lines ~70-85) with:

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
```

And replace the `ProviderFormState` type and `createFirstProvider` function body:

```ts
// Replace the old ProviderFormState and createFirstProvider:

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
    createProvider(db, {
      slug,
      name: parsed.data.name,
      type: "s3",
      config: {
        bucket: parsed.data.bucket,
        region: parsed.data.region,
        accessKeyId: parsed.data.accessKeyId,
        secretAccessKey: parsed.data.secretAccessKey,
        endpoint: parsed.data.endpoint,
        pathStyle: parsed.data.pathStyle,
      },
    });
  }

  revalidatePath("/", "layout");
  redirect("/");
}
```

Add `import type { S3Config } from "@/server/db/providers"` to the existing import line in `setup/actions.ts`, and use it to type the S3 config inline:

```ts
// in the s3 branch of createFirstProvider:
const s3Config: S3Config = {
  bucket: parsed.data.bucket,
  region: parsed.data.region,
  accessKeyId: parsed.data.accessKeyId,
  secretAccessKey: parsed.data.secretAccessKey,
  endpoint: parsed.data.endpoint,
  pathStyle: parsed.data.pathStyle,
};
createProvider(db, { slug, name: parsed.data.name, type: "s3", config: s3Config });
```

The existing imports (`createProvider`, `findProviderBySlug`, `generateUniqueSlug`, `hasAnyProvider`) are already in `setup/actions.ts` — only `S3Config` is new.

- [ ] **Step 4: Update ProviderForm.tsx to support S3**

Replace the entire file:

```tsx
// src/components/setup/ProviderForm.tsx
"use client";

import { useActionState, useState } from "react";
import {
  createFirstProvider,
  type ProviderFormState,
} from "@/app/setup/actions";

const initialState: ProviderFormState = {};

export function ProviderForm() {
  const [state, action, pending] = useActionState(
    createFirstProvider,
    initialState,
  );
  const [type, setType] = useState<"local" | "s3">("local");

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="type" value={type} />

      {/* Type toggle */}
      <div>
        <p className="mb-2 text-sm font-medium">Type</p>
        <div className="flex gap-2">
          {(["local", "s3"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                type === t
                  ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                  : "border border-neutral-300 text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-900"
              }`}
            >
              {t === "local" ? "Local" : "S3"}
            </button>
          ))}
        </div>
      </div>

      {/* Name — shared */}
      <label className="flex flex-col gap-1 text-sm">
        <span>Name</span>
        <input
          name="name"
          type="text"
          required
          placeholder="e.g. NAS Files"
          className="rounded border border-neutral-300 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
        />
        {state.fieldErrors?.name && (
          <span className="text-xs text-red-600">{state.fieldErrors.name}</span>
        )}
      </label>

      {/* Local fields */}
      {type === "local" && (
        <label className="flex flex-col gap-1 text-sm">
          <span>Root path</span>
          <span className="text-xs text-neutral-500 dark:text-neutral-400">
            Absolute path inside the container, e.g.{" "}
            <code className="font-mono">/files</code>
          </span>
          <input
            name="rootPath"
            type="text"
            required
            defaultValue="/files"
            className="rounded border border-neutral-300 bg-white px-3 py-2 font-mono dark:border-neutral-700 dark:bg-neutral-900"
          />
          {state.fieldErrors?.rootPath && (
            <span className="text-xs text-red-600">
              {state.fieldErrors.rootPath}
            </span>
          )}
        </label>
      )}

      {/* S3 fields */}
      {type === "s3" && (
        <>
          <label className="flex flex-col gap-1 text-sm">
            <span>Bucket</span>
            <input
              name="bucket"
              type="text"
              required
              className="rounded border border-neutral-300 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
            />
            {state.fieldErrors?.bucket && (
              <span className="text-xs text-red-600">
                {state.fieldErrors.bucket}
              </span>
            )}
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span>Region</span>
            <input
              name="region"
              type="text"
              required
              placeholder="us-east-1"
              className="rounded border border-neutral-300 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
            />
            {state.fieldErrors?.region && (
              <span className="text-xs text-red-600">
                {state.fieldErrors.region}
              </span>
            )}
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span>Access Key ID</span>
            <input
              name="accessKeyId"
              type="text"
              required
              autoComplete="off"
              className="rounded border border-neutral-300 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
            />
            {state.fieldErrors?.accessKeyId && (
              <span className="text-xs text-red-600">
                {state.fieldErrors.accessKeyId}
              </span>
            )}
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span>Secret Access Key</span>
            <input
              name="secretAccessKey"
              type="password"
              required
              autoComplete="new-password"
              className="rounded border border-neutral-300 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
            />
            {state.fieldErrors?.secretAccessKey && (
              <span className="text-xs text-red-600">
                {state.fieldErrors.secretAccessKey}
              </span>
            )}
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span>
              Endpoint URL{" "}
              <span className="font-normal text-neutral-500">(optional)</span>
            </span>
            <span className="text-xs text-neutral-500 dark:text-neutral-400">
              For MinIO, Backblaze B2, Cloudflare R2, etc.
            </span>
            <input
              name="endpoint"
              type="text"
              placeholder="https://s3.example.com"
              className="rounded border border-neutral-300 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
            />
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input
              name="pathStyle"
              type="checkbox"
              value="true"
              className="rounded"
            />
            <span>Path-style URLs</span>
            <span className="text-xs text-neutral-500 dark:text-neutral-400">
              (needed for some self-hosted S3)
            </span>
          </label>
        </>
      )}

      {/* Advanced: slug */}
      <details className="rounded border border-neutral-200 px-3 py-2 text-sm open:pb-3 dark:border-neutral-800">
        <summary className="cursor-pointer text-neutral-600 dark:text-neutral-400">
          Advanced
        </summary>
        <label className="mt-3 flex flex-col gap-1">
          <span>Slug</span>
          <span className="text-xs text-neutral-500 dark:text-neutral-400">
            URL-safe identifier — auto-generated from name if left blank.
          </span>
          <input
            name="slug"
            type="text"
            placeholder="auto"
            className="rounded border border-neutral-300 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
          />
          {state.fieldErrors?.slug && (
            <span className="text-xs text-red-600">
              {state.fieldErrors.slug}
            </span>
          )}
        </label>
      </details>

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
      >
        {pending ? "Adding…" : "Add provider"}
      </button>
    </form>
  );
}
```

- [ ] **Step 5: Run the new tests — confirm they pass**

```bash
cd /Users/jappy/code/jappyjan/minifold && pnpm vitest run tests/app/setup/actions.test.ts 2>&1 | tail -15
```

Expected: all pass.

- [ ] **Step 6: Run the full test suite**

```bash
cd /Users/jappy/code/jappyjan/minifold && pnpm vitest run 2>&1 | tail -8
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/app/setup/actions.ts src/components/setup/ProviderForm.tsx tests/app/setup/actions.test.ts
git commit -m "feat(setup): add S3 support to setup wizard ProviderForm + createFirstProvider"
```

---

## Task 6: Full verification gauntlet

- [ ] **Step 1: Run the full test suite one final time**

```bash
cd /Users/jappy/code/jappyjan/minifold && pnpm vitest run 2>&1 | tail -8
```

Expected: all test files pass, count is ≥ 165 (151 baseline + ~14 new).

- [ ] **Step 2: Production build**

```bash
cd /Users/jappy/code/jappyjan/minifold && pnpm build 2>&1 | tail -15
```

Expected: `✓ Compiled successfully`, no TypeScript errors.

- [ ] **Step 3: Docker build + smoke test**

```bash
docker build -t minifold:phase36-verify /Users/jappy/code/jappyjan/minifold 2>&1 | tail -5
docker run --rm -d --name mf36-smoke -p 13501:3000 -e DATABASE_PATH=/tmp/test.db minifold:phase36-verify
sleep 4
curl -sf http://localhost:13501/ -o /dev/null -w "%{http_code}\n"
docker stop mf36-smoke
```

Expected: HTTP `307` (redirect to `/setup` on fresh DB).

- [ ] **Step 4: Push to trigger Coolify deploy**

```bash
cd /Users/jappy/code/jappyjan/minifold && git push origin main
```
