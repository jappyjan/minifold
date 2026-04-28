import { describe, it, expect } from "vitest";
import { parseAccessFile } from "@/server/access/format";

describe("parseAccessFile", () => {
  it("parses default + string overrides", () => {
    const out = parseAccessFile(
      [
        "default: signed-in",
        "overrides:",
        "  preview.stl: public",
        "  secret.stl: signed-in",
      ].join("\n"),
    );
    expect(out.default).toBe("signed-in");
    expect(out.overrides).toEqual({
      "preview.stl": "public",
      "secret.stl": "signed-in",
    });
    expect(out.warnings).toEqual([]);
  });

  it("parses a list value as a user-list, lowercased", () => {
    const out = parseAccessFile(
      ["overrides:", "  patrons.stl: [Alice, Bob]"].join("\n"),
    );
    expect(out.overrides["patrons.stl"]).toEqual(["alice", "bob"]);
    expect(out.warnings).toEqual([]);
  });

  it("accepts a default user-list", () => {
    const out = parseAccessFile("default: [alice]");
    expect(out.default).toEqual(["alice"]);
  });

  it("treats malformed YAML as empty + warning", () => {
    const out = parseAccessFile(":\n bad: [unclosed");
    expect(out.default).toBeUndefined();
    expect(out.overrides).toEqual({});
    expect(out.warnings.length).toBeGreaterThan(0);
  });

  it("treats non-object root as empty + warning", () => {
    const out = parseAccessFile("- just\n- a\n- list");
    expect(out.default).toBeUndefined();
    expect(out.overrides).toEqual({});
    expect(out.warnings.length).toBeGreaterThan(0);
  });

  it("drops invalid level value with a warning", () => {
    const out = parseAccessFile("default: secret");
    expect(out.default).toBeUndefined();
    expect(out.warnings.length).toBeGreaterThan(0);
  });

  it("drops invalid override value with a warning, keeps the others", () => {
    const out = parseAccessFile(
      [
        "overrides:",
        "  good.stl: public",
        "  bad.stl: secret",
        "  also-good.stl: [alice]",
      ].join("\n"),
    );
    expect(out.overrides).toEqual({
      "good.stl": "public",
      "also-good.stl": ["alice"],
    });
    expect(out.warnings.length).toBeGreaterThan(0);
  });

  it("drops list entries that are not strings, with a warning", () => {
    const out = parseAccessFile("default: [alice, 123, bob]");
    expect(out.default).toEqual(["alice", "bob"]);
    expect(out.warnings.length).toBeGreaterThan(0);
  });

  it("accepts a file with comments only / no usable keys", () => {
    const out = parseAccessFile("# nothing here\n");
    expect(out.default).toBeUndefined();
    expect(out.overrides).toEqual({});
    expect(out.warnings).toEqual([]);
  });

  it("ignores unknown top-level keys with a warning", () => {
    const out = parseAccessFile(
      ["default: public", "extra: ignored"].join("\n"),
    );
    expect(out.default).toBe("public");
    expect(out.warnings.length).toBeGreaterThan(0);
  });

  it("accepts empty overrides map", () => {
    const out = parseAccessFile("default: public\noverrides: {}");
    expect(out.default).toBe("public");
    expect(out.overrides).toEqual({});
  });

  it("accepts an empty user-list as valid (zero usernames, admin still bypasses)", () => {
    // Spec: empty list = nobody allowed (admin still bypasses via resolver).
    // Parser treats `[]` as a valid user-list of zero usernames; the resolver
    // applies it. No warning here.
    const out = parseAccessFile("default: []");
    expect(out.default).toEqual([]);
    expect(out.warnings).toEqual([]);
  });
});
