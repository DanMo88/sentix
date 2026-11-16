/* Sentix audio engine (v2): Web Audio only.
   Every clip of the open lesson is fetched + decoded into an AudioBuffer up front.
   Leading/trailing silence is trimmed in the files (tools/trim.py) and measured again
   at decode time, so a tap starts a BufferSource at once — no <audio> src swapping. */
(function () {
  const AC = window.AudioContext || window.webkitAudioContext;
  let ctx = null;
  const bufs = new Map();
  const pend = new Map();
  let cur = null;
  let token = 0;
  let safety = 0;
  const stats = { lastStart: 0, log: [] };

  function slug(text) {
    return String(text).trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
      .slice(0, 100).replace(/-+$/g, "");
  }

  function ensure() {
    if (!ctx && AC) {
      try { ctx = new AC({ latencyHint: "interactive" }); } catch (e) { ctx = new AC(); }
    }
    return ctx;
  }

  function unlock() {
    const c = ensure();
    if (!c) return;
    if (c.state !== "running") c.resume().catch(() => {});
    try {
      const s = c.createBufferSource();
      s.buffer = c.createBuffer(1, 1, 22050);
      s.connect(c.destination);
      s.start(0);
    } catch (e) { /* ignore */ }
  }

  function measure(buf) {
    const d = buf.getChannelData(0);
    const th = 0.01;
    let a = 0;
    while (a < d.length && Math.abs(d[a]) < th) a += 1;
    let z = d.length - 1;
    while (z > a && Math.abs(d[z]) < th) z -= 1;
    const sr = buf.sampleRate;
    const start = Math.max(0, a / sr - 0.008);
    const end = Math.min(buf.duration, z / sr + 0.05);
    return { buf, start, dur: Math.max(0.05, end - start) };
  }

  function load(src) {
    if (bufs.has(src)) return Promise.resolve(bufs.get(src));
    if (pend.has(src)) return pend.get(src);
    const c = ensure();
    if (!c) return Promise.reject(new Error("no-webaudio"));
    const p = fetch(src).then((r) => {
      if (!r.ok) throw new Error(String(r.status));
      return r.arrayBuffer();
    }).then((ab) => new Promise((res, rej) => c.decodeAudioData(ab, res, rej)))
      .then((b) => { const t = measure(b); bufs.set(src, t); pend.delete(src); return t; })
      .catch((e) => { pend.delete(src); throw e; });
    pend.set(src, p);
    return p;
  }

  function preload(srcs) {
    return Promise.allSettled(Array.from(new Set((srcs || []).filter(Boolean))).map(load));
  }

  function stop() {
    token += 1;
    clearTimeout(safety);
    if (cur) {
      try { cur.onended = null; cur.stop(); } catch (e) { /* ignore */ }
      cur = null;
    }
    if (window.speechSynthesis) { try { window.speechSynthesis.cancel(); } catch (e) { /* ignore */ } }
  }

  function fallback(text, my, done) {
    if (!("speechSynthesis" in window)) { setTimeout(done, 600); return; }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-US";
    u.rate = 0.85;
    let fired = false;
    const end = () => { if (fired || my !== token) return; fired = true; done(); };
    u.onend = end;
    u.onerror = end;
    setTimeout(end, 900 + text.length * 90);
    try { window.speechSynthesis.speak(u); } catch (e) { end(); }
  }

  /* items: [{src, text}] played in order. hooks: onStart(i), onEnd(), gap (ms between items) */
  function speak(items, hooks) {
    const h = hooks || {};
    stop();
    const my = token;
    const c = ensure();
    if (c && c.state !== "running") c.resume().catch(() => {});
    let i = 0;
    const step = () => {
      if (my !== token) return;
      if (i >= items.length) { h.onEnd && h.onEnd(); return; }
      const it = items[i];
      const next = () => {
        if (my !== token) return;
        clearTimeout(safety); cur = null; i += 1;
        if (h.gap && i < items.length) safety = setTimeout(step, h.gap); else step();
      };
      const go = (t) => {
        if (my !== token) return;
        h.onStart && h.onStart(i);
        const s = c.createBufferSource();
        s.buffer = t.buf;
        s.connect(c.destination);
        const entry = { src: it.src, start: performance.now(), end: 0 };
        if (stats.log.length > 60) stats.log.shift();
        stats.log.push(entry);
        let finished = false;
        const finish = () => { if (finished) return; finished = true; entry.end = entry.end || performance.now(); next(); };
        s.onended = () => { entry.end = performance.now(); finish(); };
        cur = s;
        s.start(0, t.start, t.dur);
        stats.lastStart = performance.now();
        /* If the context is suspended (no gesture yet) onended never fires: keep the flow moving. */
        clearTimeout(safety);
        safety = setTimeout(() => { try { s.onended = null; s.stop(); } catch (e) { /* ignore */ } finish(); }, t.dur * 1000 + 1500);
      };
      const ready = bufs.get(it.src);
      if (ready && c) { go(ready); return; }
      load(it.src).then(go).catch(() => { h.onStart && h.onStart(i); fallback(it.text, my, next); });
    };
    step();
  }

  function duration(src) {
    const t = bufs.get(src);
    return t ? t.dur : 0;
  }

  window.SfAudio = {
    slug, unlock, preload, load, speak, stop, duration, stats,
    get ctx() { return ctx; },
    isReady(src) { return bufs.has(src); },
  };
})();
