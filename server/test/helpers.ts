// Test helpers: start the real server against a throwaway database and talk to it
// over HTTP and WebSockets the way the browser client does.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const SERVER_DIR = fileURLToPath(new URL("..", import.meta.url));
export const ADMIN = "test-admin-token-0123456789";

export interface Srv { port: number; url: string; db: string; proc: ChildProcess; log: () => string; stop: () => Promise<void> }

export async function startServer(env: Record<string, string> = {}, db?: string): Promise<Srv> {
  const dir = db ? undefined : mkdtempSync(join(tmpdir(), "manifest-test-"));
  const dbPath = db ?? join(dir!, "game.db");
  const proc = spawn(process.execPath, ["--no-warnings", "--import", "tsx", "src/main.ts"], {
    cwd: SERVER_DIR,
    env: { ...process.env, PORT: "0", DB_PATH: dbPath, BOTS: "0", TICK_MS: "100000000", ADMIN_TOKEN: ADMIN, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  proc.stdout!.on("data", d => { out += d; });
  proc.stderr!.on("data", d => { out += d; });
  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server didn't start:\n" + out)), 15000);
    const check = () => {
      const m = out.match(/running on http:\/\/localhost:(\d+)/);
      if (m) { clearTimeout(timer); resolve(Number(m[1])); }
    };
    proc.stdout!.on("data", check);
    proc.on("exit", code => { clearTimeout(timer); reject(new Error(`server exited (${code}):\n${out}`)); });
  });
  return {
    port, url: `http://localhost:${port}`, db: dbPath, proc, log: () => out,
    stop: () => new Promise(res => {
      if (proc.exitCode !== null || proc.signalCode !== null) return res();
      proc.once("exit", () => res());
      proc.kill();
    }),
  };
}

export const alive = (s: Srv) => s.proc.exitCode === null && s.proc.signalCode === null;

/** A WebSocket client that remembers every message so tests can wait for one. */
export class Client {
  ws: WebSocket;
  msgs: any[] = [];
  private waiters: { pred: (m: any) => boolean; resolve: (m: any) => void }[] = [];
  private reqId = 0;
  /** Index of the first message received after the last command's result. */
  private mark = 0;
  ready: Promise<void>;

  constructor(s: Srv) {
    this.ws = new WebSocket(`ws://localhost:${s.port}/ws`);
    this.ready = new Promise((res, rej) => { this.ws.once("open", () => res()); this.ws.once("error", rej); });
    this.ws.on("message", raw => {
      const m = JSON.parse(String(raw));
      this.msgs.push(m);
      this.waiters = this.waiters.filter(w => (w.pred(m) ? (w.resolve(m), false) : true));
    });
  }

  /** Wait for the next message (from now on) matching pred. */
  next(pred: (m: any) => boolean, ms = 5000): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timed out waiting for message; last got " + JSON.stringify(this.msgs.slice(-3).map(m => m.type === "state" ? "state" : m)))), ms);
      this.waiters.push({ pred, resolve: m => { clearTimeout(timer); resolve(m); } });
    });
  }

  /** Wait for a message, including ones already received. */
  async seen(pred: (m: any) => boolean, ms = 5000) {
    return this.msgs.find(pred) ?? this.next(pred, ms);
  }

  send(m: unknown) { this.ws.send(typeof m === "string" ? m : JSON.stringify(m)); }

  async auth(type: "register" | "login", name: string, password = "password123") {
    await this.ready;
    const p = this.next(m => m.type === "auth" || m.type === "authError");
    this.send({ type, name, password });
    const r = await p;
    if (r.type === "auth") await this.next(m => m.type === "state" && m.me);
    return r;
  }

  async cmd(cmd: Record<string, unknown>) {
    const id = ++this.reqId;
    const p = this.next(m => m.type === "result" && m.reqId === id);
    this.send({ type: "cmd", reqId: id, cmd });
    const r = await p;
    this.mark = this.msgs.indexOf(r) + 1;
    return r;
  }

  /** The latest state, or the next one matching pred. */
  async state(pred: (m: any) => boolean = () => true) {
    const last = [...this.msgs].reverse().find(m => m.type === "state");
    if (last && pred(last)) return last;
    return this.next(m => m.type === "state" && pred(m));
  }

  /** A state sent after the last command finished (already received or still to come). */
  async fresh(pred: (m: any) => boolean = () => true, ms?: number) {
    const p = (m: any) => m.type === "state" && pred(m);
    return this.msgs.slice(this.mark).find(p) ?? this.next(p, ms);
  }

  close() { this.ws.close(); }
}

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export function cleanup(s: Srv) {
  try { rmSync(join(s.db, ".."), { recursive: true, force: true }); } catch {}
}
