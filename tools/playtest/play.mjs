import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

const host = "127.0.0.1";
const port = 8080;
const url = `http://${host}:${port}`;

try {
  // Check before importing the game, which opens and initialises the save.
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen({ host, port, exclusive: true }, () => probe.close(resolve));
  });

  Object.assign(process.env, {
    HOST: host,
    DEBUG_CREDITS: "1",
    PORT: String(port),
    TICK_MS: "5000",
    DIFFICULTY: "easy",
    MAP_SEED: "manifest-private-playtest-1",
    BOTS: "30",
    EXPECTED_COMPANIES: "60",
    ADMIN_TOKEN: "",
    TRUST_PROXY: "0",
    DB_PATH: fileURLToPath(new URL("./data/manifest.db", import.meta.url)),
  });
  await import("./server/dist/main.js");

  const health = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(5000) });
  if (!health.ok || !(await health.json()).ok) {
    throw new Error("The game server failed its startup check.");
  }

  console.log(`Ready. Open ${url} to play. Press Ctrl+C here to stop.`);
  if (!process.argv.includes("--no-browser")) {
    const browser = spawn("rundll32.exe", ["url.dll,FileProtocolHandler", url], {
      stdio: "ignore",
      windowsHide: true,
    });
    browser.on("error", () => console.log(`Open ${url} in your browser.`));
    browser.unref();
  }
} catch (error) {
  if (error.code === "EADDRINUSE" || error.code === "EACCES") {
    console.error(`Manifest could not use port ${port}. Close any other Manifest window or app using that port, then try again.`);
  } else {
    console.error(`Manifest could not start: ${error.message}`);
  }
  process.exit(1);
}
