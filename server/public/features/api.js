// Client hooks for feature modules (see docs/FEATURES.md). Loaded before app.js.
// Category scripts in this folder are loaded after app.js and can use app.js globals (world, me, command, toast, render, $).
// Hooks:
//   ManifestHooks.on("state", (world, me) => ...)   after every server state update
//   ManifestHooks.on("draw", () => ...)             after the map is drawn each frame (canvas id "map")
//   ManifestHooks.on("render", (world, me) => ...)  after the side panel is re-rendered
// A hook that throws is reported once in the console and switched off, so one bad feature cannot break the game.
window.ManifestHooks = (() => {
  const hooks = { state: [], draw: [], render: [] };
  const dead = new Set();
  return {
    on(name, fn) { (hooks[name] ??= []).push(fn); },
    run(name, ...args) {
      for (const fn of hooks[name] ?? []) {
        if (dead.has(fn)) continue;
        try { fn(...args); } catch (err) { dead.add(fn); console.error(`feature hook "${name}" switched off:`, err); }
      }
    },
    /** True if the server has the module switched on (it sent data or cards for it). */
    enabled(id) {
      const w = typeof world === "undefined" ? null : world, m = typeof me === "undefined" ? null : me;
      return !!(w?.featureData?.[id] !== undefined || m?.featureData?.[id] !== undefined || m?.features?.[id]);
    },
  };
})();
