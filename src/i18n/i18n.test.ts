import { describe, expect, it } from "vitest";
import { en, type Messages } from "./en";
import { es } from "./es";
import { fromNavigatorLanguage, isLocale, translate } from "./core";

/** Every leaf path (arrays by index) with its string value. */
function leaves(node: unknown, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof node === "string") { out.set(prefix, node); return out; }
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      for (const [p, s] of leaves(v, prefix ? `${prefix}.${k}` : k)) out.set(p, s);
    }
  }
  return out;
}
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("catalogs", () => {
  const enLeaves = leaves(en);
  const esLeaves = leaves(es);

  it("have the same keys", () => {
    expect([...esLeaves.keys()].sort()).toEqual([...enLeaves.keys()].sort());
  });

  it("use the same {placeholders} per key", () => {
    for (const [key, text] of enLeaves) {
      expect(placeholders(esLeaves.get(key) ?? ""), key).toEqual(placeholders(text));
    }
  });

  it("have no empty strings", () => {
    for (const [key, text] of esLeaves) expect(text.trim(), key).not.toBe("");
  });

  it("stay in tú, not usted/vos", () => {
    const all = [...esLeaves.values()].join("\n");
    expect(all).not.toMatch(/\busted(es)?\b|\bvos\b|\bvosotros\b|\bordenador\b|\bmóvil\b/i);
  });

  it("type-check against the English shape", () => {
    const { signOut: _dropped, ...railWithout } = es.rail;
    // @ts-expect-error — a catalog missing a key must not compile
    const bad: Messages = { ...es, rail: railWithout };
    expect(bad).toBeTruthy();
    expect(_dropped).toBeTruthy();
  });
});

describe("translate", () => {
  it("interpolates {name}", () => {
    expect(translate("en", "update.ready", { version: "0.2.0" })).toBe("Update 0.2.0 is ready.");
    expect(translate("es", "update.ready", { version: "0.2.0" })).toBe("La actualización 0.2.0 está lista.");
  });

  it("picks plural forms with Intl.PluralRules", () => {
    expect(translate("en", "stack.approvedCount", { count: 1 })).toBe("1 tool approved for you · ready to use");
    expect(translate("en", "stack.approvedCount", { count: 3 })).toBe("3 tools approved for you · ready to use");
    expect(translate("es", "stack.approvedCount", { count: 1 })).toMatch(/^1 herramienta aprobada/);
    expect(translate("es", "stack.approvedCount", { count: 0 })).toMatch(/^0 herramientas aprobadas/);
  });

  it("leaves unknown placeholders visible rather than blank", () => {
    expect(translate("en", "update.ready")).toBe("Update {version} is ready.");
  });
});

describe("locale detection", () => {
  it("maps any es* browser language to es, everything else to en", () => {
    expect(fromNavigatorLanguage("es-CO")).toBe("es");
    expect(fromNavigatorLanguage("es")).toBe("es");
    expect(fromNavigatorLanguage("ES-419")).toBe("es");
    expect(fromNavigatorLanguage("en-GB")).toBe("en");
    expect(fromNavigatorLanguage("pt-BR")).toBe("en");
    expect(fromNavigatorLanguage(undefined)).toBe("en");
  });

  it("only accepts supported locales", () => {
    expect(isLocale("es")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(isLocale(null)).toBe(false);
  });
});
