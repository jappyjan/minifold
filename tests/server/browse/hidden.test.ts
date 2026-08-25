import { describe, it, expect } from "vitest";
import {
  isInternalEntry,
  isHiddenEntry,
  isListableEntry,
} from "@/server/browse/hidden";

describe("isInternalEntry", () => {
  it("marks Minifold bookkeeping files", () => {
    expect(isInternalEntry(".minifold_access.json")).toBe(true);
    expect(isInternalEntry(".minifold_thumb_anchor.stl.webp")).toBe(true);
    expect(isInternalEntry(".minifold_anything")).toBe(true);
  });

  it("does not mark other dotfiles or normal files", () => {
    expect(isInternalEntry(".env")).toBe(false);
    expect(isInternalEntry(".gitkeep")).toBe(false);
    expect(isInternalEntry("README.md")).toBe(false);
  });
});

describe("isHiddenEntry", () => {
  it("hides Unix-style dotfiles", () => {
    expect(isHiddenEntry(".gitkeep")).toBe(true);
    expect(isHiddenEntry(".env")).toBe(true);
    expect(isHiddenEntry(".git")).toBe(true);
    expect(isHiddenEntry(".idea")).toBe(true);
    expect(isHiddenEntry(".vscode")).toBe(true);
    expect(isHiddenEntry(".DS_Store")).toBe(true);
  });

  it("hides non-dotfile OS droppings case-insensitively", () => {
    expect(isHiddenEntry("Thumbs.db")).toBe(true);
    expect(isHiddenEntry("thumbs.db")).toBe(true);
    expect(isHiddenEntry("desktop.ini")).toBe(true);
    expect(isHiddenEntry("__MACOSX")).toBe(true);
    expect(isHiddenEntry("__macosx")).toBe(true);
  });

  it("does not hide normal files or directories", () => {
    expect(isHiddenEntry("anchor.stl")).toBe(false);
    expect(isHiddenEntry("README.md")).toBe(false);
    expect(isHiddenEntry("node_modules")).toBe(false);
  });
});

describe("isListableEntry", () => {
  it("never lists internal .minifold_* files, even with showHidden", () => {
    expect(isListableEntry(".minifold_access.json", false)).toBe(false);
    expect(isListableEntry(".minifold_access.json", true)).toBe(false);
  });

  it("hides dotfiles and OS junk by default", () => {
    expect(isListableEntry(".env", false)).toBe(false);
    expect(isListableEntry("Thumbs.db", false)).toBe(false);
  });

  it("reveals dotfiles and OS junk when showHidden is true", () => {
    expect(isListableEntry(".env", true)).toBe(true);
    expect(isListableEntry("Thumbs.db", true)).toBe(true);
  });

  it("always lists normal files", () => {
    expect(isListableEntry("anchor.stl", false)).toBe(true);
    expect(isListableEntry("anchor.stl", true)).toBe(true);
  });
});
