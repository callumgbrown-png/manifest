// Shared helpers for feature-module tests (test/features-*.test.ts). See docs/FEATURES.md.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Engine, type Command, type Company, type Result } from "../src/engine.ts";

export const rules = JSON.parse(readFileSync(new URL("../../config/rules.json", import.meta.url), "utf8"));
export const map = JSON.parse(readFileSync(new URL("../../config/map.json", import.meta.url), "utf8"));

/** A fresh world with the given feature modules switched on. */
export function featureWorld(enabled: string[] = []) {
  const e = new Engine(rules, map);
  const run = (command: Command): Result => e.applyLive(command);
  const apply = (command: Command): Result => {
    const result = run(command);
    assert.ok(result.ok, JSON.stringify(result));
    return result;
  };
  if (enabled.length) apply({ type: "setFeatures", enabled });
  const company = (name: string, startPort = 0): Company => e.companies.get(apply({ type: "register", name, startPort }).id!)!;
  /** Send a feature action as a player would. */
  const act = (company: Company, module: string, action: string, fields: Record<string, unknown> = {}) =>
    run({ type: "feature", company: company.id, module, action, ...fields });
  const hours = (n: number) => { for (let i = 0; i < n; i++) e.advance(); };
  /** A port reachable from `from`, for sailing tests. */
  const reachable = (from = 0) => e.dist[from].findIndex((d, i) => i !== from && Number.isFinite(d));
  return { e, run, apply, company, act, hours, reachable };
}

/** Replays every accepted command and tick into a fresh engine and checks it ends in the same state. */
export function assertReplays(enabled: string[], script: (w: ReturnType<typeof featureWorld>) => void) {
  const log: (Command | "tick")[] = [];
  const a = featureWorld();
  const origApply = a.e.applyLive.bind(a.e), origAdvance = a.e.advance.bind(a.e);
  a.e.applyLive = (c: Command) => { const r = origApply(c); if (r.ok) log.push(structuredClone(c)); return r; };
  a.e.advance = () => { log.push("tick"); origAdvance(); };
  a.apply({ type: "setFeatures", enabled });
  script(a);
  const b = new Engine(rules, map);
  for (const entry of log) entry === "tick" ? b.advance() : b.apply(entry);
  const snapshot = (e: Engine) => JSON.stringify({
    cash: [...e.companies.values()].map(c => Math.round(c.cash * 100)),
    ships: [...e.ships.values()].map(s => [s.id, s.port, s.dest, s.qty]),
    features: [...e.companies.keys()].map(id => e.features.view(id)),
  });
  assert.equal(snapshot(b), snapshot(a.e), "replay diverged");
}
