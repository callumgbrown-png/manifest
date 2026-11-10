import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Which feature modules should be switched on. Each config/features/<category>.json maps module id to true/false.
 * A module missing from every file stays off. FEATURES=all switches everything on (testing only);
 * FEATURES=none switches everything off; FEATURES=+id,-id adjusts the files' choice.
 */
export function desiredFeatures(dir: string, known: string[], env?: string): string[] {
  const on = new Set<string>();
  if (existsSync(dir)) {
    for (const file of readdirSync(dir).filter(f => f.endsWith(".json")).sort()) {
      const data = JSON.parse(readFileSync(join(dir, file), "utf8")) as Record<string, unknown>;
      for (const [id, value] of Object.entries(data)) if (!id.startsWith("_") && value === true) on.add(id);
    }
  }
  const spec = env?.trim();
  if (spec === "all") known.forEach(id => on.add(id));
  else if (spec === "none") on.clear();
  else if (spec) for (const part of spec.split(",").map(p => p.trim()).filter(Boolean)) {
    if (part.startsWith("-")) on.delete(part.slice(1)); else on.add(part.replace(/^\+/, ""));
  }
  return [...on].filter(id => known.includes(id)).sort();
}
