// Client code for the art feature modules (ideas 161-172 and 441-480): weather, light, wildlife, harbour life, flags,
// battle effects, the cameo ship, synthesised music and sound, and the "Sea stories" panel (news, lore, diary...).
// Uses ManifestHooks (features/api.js) and app.js globals (world, me, command, toast, render, $, ctx, P, view, cam,
// shipPos, W, H, layout). Everything here is cosmetic; the server decides anything all players must see alike.
(() => {
  const fd = id => world?.featureData?.[id];
  const md = id => me?.featureData?.[id];
  const on = id => ManifestHooks.enabled(id);
  const store = {
    get(k, d) { try { const v = localStorage.getItem("manifest.art." + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem("manifest.art." + k, JSON.stringify(v)); } catch { /* private mode */ } },
  };
  // Small seeded noise so every client draws the same gulls in the same places at the same moment.
  const h1 = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  const BIOME_TINT = ["#2fb67a", "#6aa84f", "#2e6b4a", "#c2563a", "#3a3030"];
  const FLAG_RGB = ["#b3261e", "#e8812c", "#e9c046", "#f2f2f2", "#1a1a1a", "#1f3a73", "#7cc4f0", "#1e8c8c", "#2e8b3a", "#7b4aa8", "#e58fb1", "#8a8f96"];

  // ------------------------------------------------------------ flags (171)
  function defaultFlag(id) {   // same hash as server/src/features/art/flags.ts
    let h = 0x811c9dc5;
    for (const v of [id, 171]) { h = Math.imul(h ^ (v | 0), 16777619); h ^= h >>> 13; }
    h >>>= 0;
    const n = 12, c1 = h % n, c2 = (c1 + 1 + ((h >>> 8) % (n - 1))) % n;
    let c3 = (h >>> 16) % n; if (c3 === c1 || c3 === c2) c3 = (c3 + 3) % n;
    return [(h >>> 4) % 8, c1, c2, c3];
  }
  const flagOf = owner => fd("art.flags")?.custom?.[owner] ?? defaultFlag(owner);
  function drawFlag(c, x, y, w, flag, t) {
    const [p, a, b, e] = flag, hgt = w * 0.66, wave = Math.sin(t / 180 + x) * w * 0.06;
    c.save(); c.translate(x, y);
    c.fillStyle = "#3b2a1a"; c.fillRect(-1, 0, 1.5, hgt * 2);                       // mast
    c.beginPath(); c.moveTo(0, 0); c.lineTo(w, wave); c.lineTo(w, hgt + wave); c.lineTo(0, hgt); c.closePath(); c.clip();
    c.fillStyle = FLAG_RGB[a]; c.fillRect(0, -2, w, hgt + 4);
    c.fillStyle = FLAG_RGB[b];
    if (p === 0) c.fillRect(0, hgt / 2, w, hgt);
    else if (p === 1) c.fillRect(w / 3, -2, w / 3, hgt + 4);
    else if (p === 2) { c.fillRect(w * 0.3, -2, w * 0.15, hgt + 4); c.fillRect(0, hgt * 0.42, w, hgt * 0.18); }
    else if (p === 3) { c.lineWidth = hgt * 0.18; c.strokeStyle = FLAG_RGB[b]; c.beginPath(); c.moveTo(0, 0); c.lineTo(w, hgt); c.moveTo(w, 0); c.lineTo(0, hgt); c.stroke(); }
    else if (p === 4) c.fillRect(0, 0, w * 0.45, hgt * 0.5);
    else if (p === 5) { c.beginPath(); c.moveTo(0, hgt); c.lineTo(w, 0); c.lineTo(w, hgt); c.fill(); }
    else if (p === 6) { c.lineWidth = hgt * 0.2; c.strokeStyle = FLAG_RGB[b]; c.strokeRect(0, 0, w, hgt); }
    c.fillStyle = FLAG_RGB[e]; c.beginPath(); c.arc(w / 2, hgt / 2, hgt * (p === 7 ? 0.3 : 0.14), 0, Math.PI * 2); c.fill();
    c.restore();
  }

  // ------------------------------------------------------------ zoom presets (170)
  const ZOOMS = [1, 1.5, 2.25, 3.4, 5];
  document.addEventListener("keydown", ev => {
    if (ev.target && /INPUT|SELECT|TEXTAREA/.test(ev.target.tagName)) return;
    const i = Number(ev.key) - 1;
    if (!on("art.scene") || !(i >= 0 && i < ZOOMS.length) || typeof cam === "undefined") return;
    cam.z = ZOOMS[i]; layout();
  });

  // ------------------------------------------------------------ the map overlay
  const lastSeen = { cue: 0, radio: 0, fx: 0, thunder: 0 };
  function shipsOnScreen() {
    const out = [];
    for (const s of world.ships ?? []) {
      if (s.dest === null) continue;
      const pos = shipPos(s), [x, y] = P(pos);
      if (x < -40 || y < -40 || x > W + 40 || y > H + 40) continue;
      out.push({ s, x, y, angle: pos.angle });
    }
    return out;
  }
  ManifestHooks.on("draw", () => {
    if (!world?.ports || typeof ctx === "undefined") return;
    const t = performance.now(), scene = fd("art.scene"), life = fd("art.portlife");
    const sailing = shipsOnScreen(), k = Math.max(0.6, view.scale);
    ctx.save();
    if (scene) {
      // Pixelated water sparkle and port reflections (448, 449).
      ctx.fillStyle = "rgba(255,255,255,.10)";
      for (let i = 0; i < 70; i++) {
        const cell = Math.floor(t / 900) + i, x = h1(cell * 3.1) * W, y = h1(cell * 7.7) * H, s = 2 * Math.ceil(k);
        ctx.fillRect(Math.round(x / s) * s, Math.round(y / s) * s, s, s);
      }
      for (const p of world.ports) {
        const [x, y] = P(p);
        ctx.fillStyle = `rgba(255,240,200,${0.05 + 0.04 * Math.sin(t / 700 + p.id)})`;
        for (let r = 0; r < 3; r++) ctx.fillRect(x - 8 + r * 2, y + 10 + r * 3, 16 - r * 4, 2);
      }
      // Wakes and funnel smoke (161, 442); dolphins alongside some ships (458); pirate flags (453).
      for (const { s, x, y, angle } of sailing) {
        const bx = -Math.cos(angle), by = -Math.sin(angle);
        for (let i = 1; i <= 6; i++) {
          const d = i * 5 * k * 0.6, spread = i * 1.6;
          ctx.fillStyle = `rgba(230,245,255,${0.35 - i * 0.05})`;
          ctx.fillRect(x + bx * d - by * spread, y + by * d + bx * spread, 2, 2);
          ctx.fillRect(x + bx * d + by * spread, y + by * d - bx * spread, 2, 2);
        }
        if (s.type !== "pirate") for (let i = 0; i < 3; i++) {
          const age = ((t / 600 + i / 3 + s.id * 0.37) % 1);
          ctx.fillStyle = `rgba(90,90,95,${0.45 * (1 - age)})`;
          ctx.beginPath(); ctx.arc(x + bx * 4 + age * 6, y + by * 4 - 8 - age * 14, 2 + age * 4, 0, Math.PI * 2); ctx.fill();
        }
        if (s.id % 4 === 0) {
          const ph = t / 260 + s.id;
          ctx.fillStyle = "#7d97a8";
          ctx.fillRect(x - by * 12 + Math.cos(ph) * 3, y + bx * 12 - Math.abs(Math.sin(ph)) * 5, 4, 2);
        }
        if (s.type === "pirate") {
          ctx.save(); ctx.translate(x, y - 22);
          const wv = Math.sin(t / 120 + s.id) * 2;
          ctx.fillStyle = "#111"; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(12, wv); ctx.lineTo(12, 8 + wv); ctx.lineTo(0, 8); ctx.fill();
          ctx.fillStyle = "#eee"; ctx.fillRect(5, 2 + wv / 2, 3, 3); ctx.restore();
        }
      }
      // Police lights (454).
      for (const p of world.police ?? []) {
        if (p.dest === null) continue;
        const [x, y] = P(shipPos(p)), blink = Math.floor(t / 250) % 2;
        ctx.fillStyle = blink ? "#ff3b3b" : "#3b7bff"; ctx.fillRect(x - 3, y - 15, 3, 3);
        ctx.fillStyle = blink ? "#3b7bff" : "#ff3b3b"; ctx.fillRect(x + 1, y - 15, 3, 3);
      }
      // Gulls over harbours and fish jumping (165, 456); whales in open water (457).
      for (const p of world.ports) {
        const [px, py] = P(p);
        for (let g = 0; g < 2; g++) {
          const a = t / (1400 + g * 300) + p.id * 1.7 + g * 3, gx = px + Math.cos(a) * 26 * k * 0.6, gy = py - 18 + Math.sin(a * 1.3) * 10;
          const flap = Math.sin(t / 90 + g) * 2;
          ctx.strokeStyle = "rgba(245,245,245,.9)"; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(gx - 3, gy - flap); ctx.lineTo(gx, gy); ctx.lineTo(gx + 3, gy - flap); ctx.stroke();
        }
        const jump = (t / 1000 + p.id * 0.61) % 6;
        if (jump < 0.6) { ctx.fillStyle = "#c0d8e6"; ctx.fillRect(px + 22, py + 18 - Math.sin(jump / 0.6 * Math.PI) * 6, 3, 2); }
      }
      const whaleCycle = Math.floor(t / 14000), wph = (t % 14000) / 14000;
      if (wph < 0.35) {
        const wx = (0.15 + h1(whaleCycle) * 0.7) * W, wy = (0.15 + h1(whaleCycle + 9) * 0.7) * H;
        ctx.fillStyle = "#2b4250"; ctx.beginPath(); ctx.ellipse(wx, wy, 10, 3, 0, Math.PI, 0); ctx.fill();
        if (wph < 0.12) { ctx.fillStyle = "rgba(220,240,255,.8)"; for (let i = 0; i < 4; i++) ctx.fillRect(wx - 3 + i * 2, wy - 6 - wph * 60 + i % 2 * 2, 1.5, 3); }
      }
      // Squalls: rain and lightning (164, 451, 452).
      for (const q of scene.squalls ?? []) {
        const [qx, qy] = P(q), r = q.r * view.scale;
        ctx.fillStyle = `rgba(20,25,35,${0.12 + q.strength * 0.05})`;
        ctx.beginPath(); ctx.arc(qx, qy, r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "rgba(180,200,230,.45)"; ctx.lineWidth = 1; ctx.beginPath();
        for (let i = 0; i < 30 * q.strength; i++) {
          const a = h1(q.id * 100 + i) * Math.PI * 2, d = Math.sqrt(h1(q.id * 200 + i)) * r;
          const fall = ((t / 400 + h1(i)) % 1) * 12;
          const rx = qx + Math.cos(a) * d, ry = qy + Math.sin(a) * d - 6 + fall;
          ctx.moveTo(rx, ry); ctx.lineTo(rx - 2, ry + 5);
        }
        ctx.stroke();
        if (q.strength === 3 && (Math.floor(t / 97) + q.id) % 41 === 0) {
          ctx.fillStyle = "rgba(255,255,255,.18)"; ctx.fillRect(0, 0, W, H);
          ctx.strokeStyle = "#fffbe0"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(qx, qy - r);
          for (let i = 1; i <= 5; i++) ctx.lineTo(qx + (h1(t + i) - 0.5) * 20, qy - r + i * r / 5);
          ctx.stroke();
          if (sound.ready && t - lastSeen.thunder > 1500) { lastSeen.thunder = t; sound.thunder(); }
        }
      }
      // Seasons: snow on winter ports, autumn haze, spring blossom (446, 447).
      if (scene.season === 3) {
        ctx.fillStyle = "rgba(255,255,255,.85)";
        for (const p of world.ports) { const [x, y] = P(p); for (let i = 0; i < 5; i++) ctx.fillRect(x - 10 + h1(p.id * 9 + i) * 20, y - 6 + h1(p.id * 5 + i) * 10, 2, 2); }
        for (let i = 0; i < 60; i++) { const x = (h1(i) * W + t / 40 * (0.5 + h1(i + 3))) % W, y = (h1(i + 7) * H + t / 25) % H; ctx.fillRect(x, y, 1.5, 1.5); }
      } else if (scene.season === 2) { ctx.fillStyle = "rgba(160,90,20,.05)"; ctx.fillRect(0, 0, W, H); }
      else if (scene.season === 0) { ctx.fillStyle = "rgba(255,190,220,.7)"; for (const p of world.ports) { const [x, y] = P(p); ctx.fillRect(x + 9, y - 9, 2, 2); } }
      // Day and night (162) with harbour lights after dark (450).
      const hour = scene.hour, dark = hour >= 20 || hour < 5 ? 0.38 : hour >= 18 || hour < 7 ? 0.18 : 0;
      if (dark) {
        ctx.fillStyle = `rgba(8,12,40,${dark})`; ctx.fillRect(0, 0, W, H);
        for (const p of world.ports) {
          const [x, y] = P(p), g = ctx.createRadialGradient(x, y, 0, x, y, 18 * k * 0.6);
          g.addColorStop(0, "rgba(255,210,120,.55)"); g.addColorStop(1, "rgba(255,210,120,0)");
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 18 * k * 0.6, 0, Math.PI * 2); ctx.fill();
        }
        for (const { x, y } of sailing) { ctx.fillStyle = "#ffe9a8"; ctx.fillRect(x - 1, y - 3, 2, 2); }
      } else if (hour >= 6 && hour < 8 || hour >= 17 && hour < 19) { ctx.fillStyle = "rgba(255,140,60,.07)"; ctx.fillRect(0, 0, W, H); }
    }
    if (life) {
      // Cranes swing while ships work a port; containers stack higher and warehouses appear as ports grow (163, 444, 445, 460);
      // a small biome mark dresses each island (459).
      world.ports.forEach((p, i) => {
        const [x, y] = P(p), busy = life.busy?.[i] ?? 0, stage = life.stage?.[i] ?? 0;
        ctx.fillStyle = BIOME_TINT[life.biome?.[i] ?? 1]; ctx.fillRect(x - 14, y + 8, 4, 4);
        const stacks = 1 + stage + Math.min(2, busy);
        for (let s = 0; s < stacks; s++) for (let lvl = 0; lvl <= (s + i) % (2 + stage); lvl++) {
          ctx.fillStyle = ["#c0392b", "#2980b9", "#27ae60", "#e67e22"][(i + s + lvl) % 4];
          ctx.fillRect(x + 12 + s * 4, y + 6 - lvl * 3, 3, 2.5);
        }
        if (stage >= 2) { ctx.fillStyle = "#6b5b4b"; ctx.fillRect(x - 20, y - 2, 6, 5); }
        if (stage >= 3) { ctx.fillStyle = "#6b5b4b"; ctx.fillRect(x - 20, y - 9, 6, 5); }
        if (busy > 0) {
          const swing = Math.sin(t / (500 - busy * 20) + i) * 0.8, cx = x + 8, cy = y - 4;
          ctx.strokeStyle = "#f1c40f"; ctx.lineWidth = 1.5; ctx.beginPath();
          ctx.moveTo(cx, cy + 8); ctx.lineTo(cx, cy - 8); ctx.lineTo(cx + Math.cos(swing) * 10, cy - 8 + Math.sin(swing) * 3); ctx.stroke();
          const hx = cx + Math.cos(swing) * 10, hy = cy - 8 + Math.sin(swing) * 3 + 4 + Math.sin(t / 300) * 2;
          ctx.strokeStyle = "rgba(220,220,220,.8)"; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.moveTo(hx, cy - 8); ctx.lineTo(hx, hy); ctx.stroke();
          ctx.fillStyle = "#c0392b"; ctx.fillRect(hx - 1.5, hy, 3, 2);
        }
      });
    }
    if (on("art.flags") && me) {
      const home = world.ports[me.home ?? -1];
      if (home) { const [x, y] = P(home); drawFlag(ctx, x - 4, y - 30, 12, md("art.flags")?.flag ?? flagOf(me.id), t); }
      for (const { s, x, y } of sailing) if (s.owner !== undefined && s.type !== "pirate") drawFlag(ctx, x + 3, y - 20, 6, flagOf(s.owner), t);
    }
    const combat = fd("art.combat");
    if (combat) {
      // Damage (441): smoke and sparks over hit ships. Explosions (455) and sinkings (443).
      for (const d of combat.damaged ?? []) {
        const s = world.ships?.find(x => x.id === d.ship);
        if (!s) continue;
        const [x, y] = P(shipPos(s));
        for (let i = 0; i < 4; i++) {
          const age = (t / 700 + i / 4) % 1;
          ctx.fillStyle = `rgba(40,40,40,${0.6 * (1 - age)})`;
          ctx.beginPath(); ctx.arc(x + 2 + age * 5, y - 6 - age * 16, 2 + age * 3, 0, Math.PI * 2); ctx.fill();
        }
        if (Math.floor(t / 150) % 3 === 0) { ctx.fillStyle = "#ffb347"; ctx.fillRect(x - 2, y - 3, 2, 2); }
      }
      for (const f of combat.fx ?? []) {
        const [x, y] = P(f), ph = (t % 1800) / 1800;
        if (f.kind === "explosion") {
          for (let i = 0; i < 10; i++) {
            const a = i / 10 * Math.PI * 2, d = ph * 22;
            ctx.fillStyle = i % 2 ? `rgba(255,170,40,${1 - ph})` : `rgba(255,80,20,${1 - ph})`;
            ctx.fillRect(x + Math.cos(a) * d - 2, y + Math.sin(a) * d - 2, 4, 4);
          }
        } else {
          ctx.strokeStyle = `rgba(220,240,255,${1 - ph})`; ctx.lineWidth = 1;
          for (let r = 0; r < 3; r++) { ctx.beginPath(); ctx.ellipse(x + 14, y + 12, 4 + (ph + r / 3) % 1 * 18, 2 + (ph + r / 3) % 1 * 7, 0, 0, Math.PI * 2); ctx.stroke(); }
          ctx.fillStyle = "#5b4636"; ctx.fillRect(x + 12, y + 8 + ph * 6, 5, 4 * (1 - ph));
        }
        if (f.tick > lastSeen.fx) { lastSeen.fx = f.tick; if (sound.ready) sound.boom(); }
      }
    }
    const cameo = fd("art.cameo");
    if (cameo) {
      const pos = shipPos({ port: cameo.port, dest: cameo.dest, departTick: cameo.departTick, arriveTick: cameo.arriveTick }), [x, y] = P(pos);
      ctx.fillStyle = "#e84393"; ctx.fillRect(x - 6, y - 2, 12, 4); ctx.fillStyle = "#fff"; ctx.fillRect(x - 2, y - 6, 4, 4);
      if (cam.z >= 1.5) { ctx.font = "10px monospace"; ctx.fillStyle = "rgba(255,255,255,.9)"; ctx.fillText(`${cameo.name}: ${cameo.line}`, x + 8, y - 8); }
    }
    const sighting = fd("art.legend")?.sighting;
    if (sighting && world.ports[sighting.port]) {
      const [x, y] = P(world.ports[sighting.port]), a = 0.3 + 0.25 * Math.sin(t / 400);
      ctx.fillStyle = `rgba(200,255,230,${a})`; ctx.fillRect(x + 18, y - 4, 14, 4);
      for (let i = 0; i < 4; i++) { ctx.fillStyle = `rgba(255,240,150,${a + 0.3})`; ctx.fillRect(x + 19 + i * 3.5, y - 7, 2, 2); }
    }
    ctx.restore();
  });

  // ------------------------------------------------------------ sound (166-169, 461-470): all synthesised, no files
  const sound = (() => {
    let ac = null, master = null, musicGain = null, sfxGain = null, seaNode = null, step = 0, nextAt = 0, theme = "";
    const prefs = { music: store.get("music", true), sfx: store.get("sfx", true), volume: store.get("volume", 0.5) };
    const NOTE = n => 440 * Math.pow(2, (n - 69) / 12);
    // Melodies as MIDI note numbers (0 = rest), 8 steps a bar. Original tunes.
    const TUNES = {
      "Reef Calypso": [72, 0, 76, 79, 0, 76, 74, 72, 74, 0, 77, 81, 79, 77, 76, 74], "Hedgerow Reel": [67, 69, 71, 72, 74, 72, 71, 69, 67, 71, 74, 79, 78, 76, 74, 72],
      "Pine Hymn": [64, 0, 67, 0, 71, 0, 69, 67, 64, 0, 62, 0, 64, 0, 0, 0], "Red Cliff Waltz": [69, 72, 76, 0, 74, 72, 71, 0, 69, 71, 72, 0, 64, 0, 69, 0],
      "Ember Drums": [57, 0, 57, 60, 0, 57, 55, 0, 57, 0, 60, 62, 0, 60, 57, 0], "Squall Line": [62, 63, 62, 0, 65, 63, 62, 0, 60, 62, 63, 0, 58, 0, 0, 0],
      "Black Flag": [62, 0, 65, 62, 69, 0, 67, 65, 64, 0, 67, 64, 62, 0, 0, 0], "Haul Away": [67, 0, 67, 72, 0, 72, 76, 74, 72, 0, 69, 67, 69, 72, 0, 0],
    };
    function init() {
      if (ac) return;
      ac = new (window.AudioContext || window.webkitAudioContext)();
      master = ac.createGain(); master.gain.value = prefs.volume; master.connect(ac.destination);
      musicGain = ac.createGain(); musicGain.gain.value = prefs.music ? 0.12 : 0; musicGain.connect(master);
      sfxGain = ac.createGain(); sfxGain.gain.value = prefs.sfx ? 0.5 : 0; sfxGain.connect(master);
      // Sea: looping filtered noise whose loudness swells like waves (166).
      const buf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      seaNode = ac.createBufferSource(); seaNode.buffer = buf; seaNode.loop = true;
      const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 500;
      const swell = ac.createGain(); swell.gain.value = 0.12;
      const lfo = ac.createOscillator(), lfoGain = ac.createGain(); lfo.frequency.value = 0.12; lfoGain.gain.value = 0.08;
      lfo.connect(lfoGain); lfoGain.connect(swell.gain); lfo.start();
      seaNode.connect(lp); lp.connect(swell); swell.connect(sfxGain); seaNode.start();
      api.ready = true;
    }
    function tone(freq, dur, type = "square", gain = 0.3, out = sfxGain, slide = 0, at = ac.currentTime) {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, at); if (slide) o.frequency.linearRampToValueAtTime(freq + slide, at + dur);
      g.gain.setValueAtTime(gain, at); g.gain.exponentialRampToValueAtTime(0.001, at + dur);
      o.connect(g); g.connect(out); o.start(at); o.stop(at + dur + 0.02);
    }
    function noise(dur, freq, gain = 0.3) {
      const b = ac.createBuffer(1, Math.ceil(ac.sampleRate * dur), ac.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
      const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
      f.type = "bandpass"; f.frequency.value = freq; g.gain.value = gain; s.buffer = b; s.connect(f); f.connect(g); g.connect(sfxGain); s.start();
    }
    function pickTheme() {
      const m = fd("art.music"), mine = md("art.music"), scene = fd("art.scene");
      if (!m) return "";
      const myShips = (world.ships ?? []).filter(s => s.owner === me?.id);
      const stormy = scene?.squalls?.some(q => myShips.some(s => { const p = shipPos(s); return Math.hypot(p.x - q.x, p.y - q.y) < q.r; }));
      if (stormy) return m.situations.storm;                    // 462
      if (mine?.pirate) return m.situations.pirate;              // 463
      if (mine?.shanty) return m.situations.shanty;              // 469
      return m.themes[mine?.home ?? 0];                          // 461
    }
    function tick() {     // the chiptune sequencer (167), scheduled a little ahead
      if (!ac || !prefs.music) return;
      if (ac.currentTime + 0.3 < nextAt) return;
      const want = pickTheme();
      if (want !== theme) { theme = want; step = 0; }
      const tune = TUNES[theme]; if (!tune) return;
      nextAt = Math.max(nextAt, ac.currentTime);
      for (let i = 0; i < 4; i++) {
        const n = tune[step % tune.length], at = nextAt + i * 0.18;
        if (n) tone(NOTE(n), 0.16, "square", 0.25, musicGain, 0, at);
        if (step % 4 === 0) tone(NOTE((tune[0] || 60) - 24), 0.3, "triangle", 0.35, musicGain, 0, at);
        step++;
      }
      nextAt += 4 * 0.18;
    }
    const api = {
      ready: false, prefs, init,
      set(k, v) { prefs[k] = v; store.set(k, v); if (!ac) return; master.gain.value = prefs.volume; musicGain.gain.value = prefs.music ? 0.12 : 0; sfxGain.gain.value = prefs.sfx ? 0.5 : 0; },
      tick,
      pause(off) { if (ac) off ? ac.suspend() : ac.resume(); },
      click() { tone(880, 0.05, "square", 0.15); },                                         // 168
      horn(mine) { tone(110, 0.9, "sawtooth", mine ? 0.25 : 0.08); tone(138, 0.9, "sawtooth", mine ? 0.15 : 0.05); },   // 169
      siren() { tone(700, 0.6, "triangle", 0.08, sfxGain, 300); setTimeout(() => ac && tone(1000, 0.6, "triangle", 0.08, sfxGain, -300), 600); },   // 464
      clank() { tone(320 + Math.random() * 80, 0.12, "square", 0.08); noise(0.08, 2500, 0.1); },                // 465
      gull() { tone(1800, 0.25, "triangle", 0.05, sfxGain, -700); },                         // 466
      radio() { noise(0.35, 1800, 0.12); },                                                   // 467
      cricket() { for (let i = 0; i < 3; i++) tone(4200, 0.03, "sine", 0.03, sfxGain, 0, ac.currentTime + i * 0.06); },   // 470
      thunder() { noise(1.2, 120, 0.4); },
      boom() { noise(0.8, 200, 0.5); tone(60, 0.6, "sine", 0.4); },
    };
    return api;
  })();
  document.addEventListener("pointerdown", () => { if (!sound.ready && (sound.prefs.music || sound.prefs.sfx) && store.get("enabled", false)) sound.init(); }, { capture: true });
  document.addEventListener("click", ev => { if (sound.ready && ev.target?.closest?.("button")) sound.click(); }, { capture: true });
  setInterval(() => {
    if (!sound.ready || !world) return;
    sound.tick();
    const snd = fd("art.sound"), life = fd("art.portlife"), radio = fd("art.chatter")?.radio ?? [];
    for (const q of snd?.cues ?? []) {
      const key = q.tick * 100000 + q.ship * 2 + (q.kind === "horn-in" ? 1 : 0);
      if (key <= lastSeen.cue) continue;
      lastSeen.cue = key;
      const mine = (me?.ships ?? []).some(s => s.id === q.ship);
      sound.horn(mine);
      if (mine && q.kind === "horn-in") { const bark = md("art.chatter")?.barks?.[q.ship]; if (bark) toast(`Ship ${q.ship}: “${bark}”`); }   // 468
    }
    const r = Math.random();
    if (snd?.sirens?.length && r < 0.02) sound.siren();
    if (life?.busy?.some(b => b > 0) && r > 0.9) sound.clank();
    if (snd && !snd.night && r > 0.5 && r < 0.53) sound.gull();
    if (snd?.night && r > 0.3 && r < 0.36) sound.cricket();
    const latest = radio.at(-1);
    if (latest && latest.tick > lastSeen.radio) { lastSeen.radio = latest.tick; sound.radio(); }
  }, 250);

  // ------------------------------------------------------------ pixel-art headline illustrations (172)
  const ART = {
    spike: [["#2ecc71", [[1, 6], [2, 5], [3, 4], [4, 5], [5, 3], [6, 2], [7, 1]]]], crash: [["#e74c3c", [[1, 1], [2, 2], [3, 4], [4, 3], [5, 5], [6, 6], [7, 7]]]],
    leader: [["#f1c40f", [[2, 2], [4, 1], [6, 2], [2, 3], [3, 3], [4, 3], [5, 3], [6, 3], [2, 4], [3, 4], [4, 4], [5, 4], [6, 4]]]],
    raids: [["#111", [[2, 1], [3, 1], [4, 1], [5, 1], [6, 1], [2, 2], [6, 2], [3, 4], [5, 4], [4, 5]]], ["#ddd", [[3, 2], [5, 2], [4, 3]]]],
    busy: [["#e67e22", [[1, 6], [2, 6], [3, 6], [4, 6], [5, 6], [6, 6], [2, 5], [3, 5], [5, 5]]], ["#f1c40f", [[6, 1], [6, 2], [6, 3], [6, 4], [5, 1], [4, 1], [4, 2]]]],
    quiet: [["#7fb3d5", [[0, 5], [1, 4], [2, 5], [3, 4], [4, 5], [5, 4], [6, 5], [7, 4]]], ["#f9e79f", [[5, 1], [6, 1], [5, 2], [6, 2]]]],
  };
  function illustration(kind) {
    const c = document.createElement("canvas"); c.width = c.height = 32;
    const x = c.getContext("2d"); x.fillStyle = "#1b2631"; x.fillRect(0, 0, 32, 32);
    for (const [col, px] of ART[kind] ?? ART.quiet) { x.fillStyle = col; for (const [a, b] of px) x.fillRect(a * 4, b * 4, 4, 4); }
    return c.toDataURL();
  }
  const artCache = {};
  const esc2 = s => String(s ?? "").replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);

  // ------------------------------------------------------------ the "Sea stories" panel
  let open = store.get("panelOpen", false), tab = store.get("panelTab", "news");
  ManifestHooks.on("render", () => {
    const panel = typeof $ === "function" ? $("panel") : null;
    if (!panel || !me || !world) return;
    const tabs = [
      ["news", "Gazette", on("art.news") || on("art.chatter")], ["diary", "Diary", on("art.diary")], ["lore", "Lore", on("art.lore") || on("art.relics")],
      ["quests", "Quests", on("art.mystery") || on("art.legend") || on("art.rivals") || on("art.eggs")], ["sound", "Sound", on("art.music") || on("art.sound")],
    ].filter(t => t[2]);
    if (!tabs.length) return;
    if (!tabs.some(t => t[0] === tab)) tab = tabs[0][0];
    let body = "";
    if (tab === "news") {
      const heads = (fd("art.news")?.headlines ?? []).slice().reverse();
      body += heads.map(h => `<div class="row" style="gap:8px;align-items:center"><img alt="" width="32" height="32" style="image-rendering:pixelated" src="${artCache[h.art] ??= illustration(h.art)}"><b>${esc2(h.text)}</b><span class="quiet">Day ${Math.floor(h.tick / 24) + 1}</span></div>`).join("") || '<p class="quiet">The presses are warming up.</p>';
      const radio = (fd("art.chatter")?.radio ?? []).slice().reverse();
      if (radio.length) body += `<h4>Harbour radio</h4><ul>${radio.map(r => `<li>${esc2(r.text)}</li>`).join("")}</ul>`;
      const barks = md("art.chatter")?.barks ?? {};
      if (Object.keys(barks).length) body += `<h4>Your captains</h4><ul>${Object.entries(barks).map(([id, b]) => `<li>Ship ${esc2(id)}: “${esc2(b)}”</li>`).join("")}</ul>`;
    } else if (tab === "diary") {
      body = (md("art.diary")?.pages ?? []).map(p => `<p>${esc2(p.text)}</p>`).join("") || '<p class="quiet">The first page is blank.</p>';
    } else if (tab === "lore") {
      const l = md("art.lore"), r = md("art.relics");
      if (l) body += l.founding.map(f => `<details><summary>${esc2(f.title)}</summary><p>${esc2(f.text)}</p></details>`).join("")
        + `<h4>Islands (${l.islands.length} of ${l.total})</h4>` + l.islands.map(i => `<p><b>${esc2(i.name)}</b> <span class="quiet">${esc2(i.biome)}</span><br>${esc2(i.text)}</p>`).join("");
      if (r) body += `<h4>Relics (${r.relics.length} of ${r.total})</h4>` + r.relics.map(x => `<p><b>${esc2(x.name)}</b> <span class="quiet">found at ${esc2(x.port)}</span><br>${esc2(x.text)}</p>`).join("")
        + r.bottles.map(b => `<p class="quiet">${esc2(b.text)} (${esc2(b.port)})</p>`).join("");
    } else if (tab === "quests") {
      const rv = md("art.rivals");
      if (rv?.story?.length) body += `<h4>Rivals</h4>` + rv.story.map(s => `<p>${esc2(s.text)}</p>`).join("");
      for (const id of ["art.mystery", "art.legend"]) { const v = md(id); if (v?.title) body += `<p>Title earned: <b>${esc2(v.title)}</b></p>`; }
      body += '<p class="quiet">Mystery and legend cases are in the Opportunities tab.</p>';
      if (on("art.eggs")) {
        const e = md("art.eggs");
        body += `<h4>Shout into the fog</h4><form id="artShout" class="row"><input name="word" maxlength="30" pattern="[A-Za-z ]+" required><button class="secondary">Shout</button></form>
          <p class="quiet">${esc2(e?.last ?? "")} ${e ? `(${e.found} of ${e.total} found)` : ""}</p>`;
      }
    } else if (tab === "sound") {
      const p = sound.prefs;
      body = `<label><input type="checkbox" id="artSoundOn"${store.get("enabled", false) ? " checked" : ""}> Sound on</label>
        <label><input type="checkbox" id="artMusic"${p.music ? " checked" : ""}> Chiptune music</label>
        <label><input type="checkbox" id="artSfx"${p.sfx ? " checked" : ""}> Sea, horns and effects</label>
        <label>Volume <input type="range" id="artVol" min="0" max="1" step="0.05" value="${p.volume}"></label>
        <p class="quiet">Keys 1-5 jump between zoom levels.</p>`;
    }
    const box = document.createElement("details");
    box.className = "est artStories"; box.open = open;
    box.innerHTML = `<summary><b>Sea stories</b></summary><div class="row">${tabs.map(([k, label]) => `<button class="link" data-arttab="${k}"${k === tab ? ' aria-current="true"' : ""}>${label}</button>`).join(" ")}</div>${body}`;
    panel.appendChild(box);
    box.addEventListener("toggle", () => { open = box.open; store.set("panelOpen", open); });
    box.querySelectorAll("[data-arttab]").forEach(b => b.onclick = () => { tab = b.dataset.arttab; store.set("panelTab", tab); render(); });
    const shout = box.querySelector("#artShout");
    if (shout) shout.onsubmit = ev => { ev.preventDefault(); command({ type: "feature", module: "art.eggs", action: "shout", word: String(new FormData(shout).get("word") ?? "") }, () => render()); };
    const bind = (id, fn) => { const el = box.querySelector("#" + id); if (el) el.onchange = () => fn(el); };
    bind("artSoundOn", el => { store.set("enabled", el.checked); if (el.checked) sound.init(); sound.pause(!el.checked); });
    bind("artMusic", el => sound.set("music", el.checked));
    bind("artSfx", el => sound.set("sfx", el.checked));
    bind("artVol", el => sound.set("volume", Number(el.value)));
  });
})();
