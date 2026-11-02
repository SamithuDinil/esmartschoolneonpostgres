import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type IndexDef = { collectionGroup: string; queryScope: string; fields: { fieldPath: string }[] };

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : /\.tsx?$/.test(name) ? [full] : [];
  });
}

const config = JSON.parse(readFileSync("firestore.indexes.json", "utf8")) as {
  indexes: IndexDef[];
  fieldOverrides: {
    collectionGroup: string;
    fieldPath: string;
    indexes: { queryScope: string }[];
  }[];
};
const chain =
  /(?:collection|collectionGroup)\(\s*["'`]([^"'`]+)["'`]\s*\)((?:\s*\.(?:where|orderBy|limit|startAfter)\((?:[^()]|\([^()]*\))*\))+)/g;

describe("firestore composite indexes", () => {
  it("declares an index for every equality + orderBy query", () => {
    const missing: string[] = [];
    for (const file of walk("src")) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(chain)) {
        const wheres = [
          ...match[2].matchAll(/\.where\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']/g),
        ];
        const orders = [...match[2].matchAll(/\.orderBy\(\s*["']([^"']+)["']/g)].map((m) => m[1]);
        const equality = wheres
          .filter((w) => ["==", "in", "array-contains"].includes(w[2]))
          .map((w) => w[1]);
        if (!orders.length || !equality.length) continue;
        if (equality.length === 1 && orders.length === 1 && equality[0] === orders[0]) continue;
        const wanted = [...new Set([...equality, ...orders])];
        const found = config.indexes.some(
          (index) =>
            index.collectionGroup === match[1] &&
            wanted.every((f) => index.fields.some((x) => x.fieldPath === f)),
        );
        if (!found) missing.push(`${file}: ${match[1]} ${wanted.join(",")}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("enables collection-group scope for registrationRequests.uid", () => {
    const override = config.fieldOverrides.find(
      (o) => o.collectionGroup === "registrationRequests" && o.fieldPath === "uid",
    );
    expect(override?.indexes.some((i) => i.queryScope === "COLLECTION_GROUP")).toBe(true);
  });
});
