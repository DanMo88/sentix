/* Sentix v2 — one screen, no scrolling, fully automatic flow.
   Only taps: building the sentence. Solved → full sentence plays at once with its
   Persian meaning → next sentence → after the last one, the reading page opens and plays. */
(function () {
  const Z = "\u200c";
  const E = "\u0654";
  const app = document.getElementById("app");
  const STORE = "sentix-progress-v1";
  const OLD_STORE = "sentencify-progress-v1";
  const A = window.SfAudio;
  const LEVEL_NOTE = {
    A1: "از صفر: معرفی، خانواده، عدد، خانه، غذا",
    A2: "زندگی روزمره: خرید، کار، سفر، گذشته",
    B1: "حرف زدن درباره" + E + " نظر، تجربه و برنامه",
    B2: "جمله" + Z + "های بلندتر، بحث و کار",
    C1: "زبان رسمی، دانشگاهی و حرفه" + Z + "ای",
    C2: "ظرافت" + Z + "ها، اصطلاحات و لحن مثل یک آمریکایی",
  };
  const WORD_TO_SENTENCE = 1000; /* ms after the last word's audio ends */
  const ADVANCE_GAP = 2000;      /* ms after the sentence audio ends */
  const READING_GAP = 1000;      /* ms between reading lines */
  let flow = 0;                  /* cancels pending automatic steps */

  const state = {
    screen: "home", course: null, lesson: null, lessonId: 1, level: "A1",
    page: 0, perPage: 5, index: 0, tiles: [], order: [], placed: [],
    status: "building", wrongCount: 0, helpMode: false, flash: "",
    shake: false, popId: null, loadError: "", lockMsg: "", readingLine: -1, readingPlaying: false,
  };
  let progress = { done: [], at: {} };
  let advanceTimer = 0;
  let lockTimer = 0;
  const cache = {};

  /* ---------- progress ---------- */
  function loadProgress() {
    try {
      /* One-time safe migration from the old Sentencify key; the old key is left in place. */
      if (!localStorage.getItem(STORE) && localStorage.getItem(OLD_STORE)) localStorage.setItem(STORE, localStorage.getItem(OLD_STORE));
      const saved = JSON.parse(localStorage.getItem(STORE) || "null");
      if (!saved || !Array.isArray(saved.done)) return;
      progress = { done: [], at: {} };
      saved.done.forEach((x) => { const id = Number(x); if (Number.isFinite(id) && !progress.done.includes(id)) progress.done.push(id); });
      Object.keys(saved.at || {}).forEach((k) => { const id = Number(k), i = Number(saved.at[k]); if (Number.isFinite(id) && Number.isFinite(i)) progress.at[id] = i; });
    } catch (e) { /* ignore */ }
  }
  function save() { try { localStorage.setItem(STORE, JSON.stringify(progress)); } catch (e) { /* ignore */ } }
  function markDone(id) { if (!progress.done.includes(id)) progress.done.push(id); delete progress.at[id]; save(); }
  function rememberAt(id, i) { if (progress.done.includes(id)) return; progress.at[id] = i; save(); }
  loadProgress();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  /* ---------- helpers ---------- */
  const toFa = (n) => String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function rich(text) {
    return String(text).split(/([A-Za-z][A-Za-z'’ ]*[A-Za-z]|[A-Za-z])/g).map((part, i) =>
      i % 2 ? `<bdi class="en" lang="en" dir="ltr">${esc(part)}</bdi>` : esc(part)).join("");
  }
  const core = (w) => String(w).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  const wordSrc = (w) => "audio/w-" + A.slug(core(w) || w) + ".mp3";
  const sentSrc = (s) => "audio/s-" + A.slug(s.nl) + ".mp3";
  function prOf(w) { const m = (state.lesson && state.lesson.pron) || {}; return m[String(core(w) || w).toLowerCase()] || ""; }
  function allLessons() { return state.course ? state.course.levels.flatMap((l) => l.lessons.map((x) => ({ ...x, level: l.id }))) : []; }
  const lessonMeta = (id) => allLessons().find((l) => l.id === id);
  const isDone = (id) => progress.done.includes(Number(id));
  const resumeAt = (id) => (Number.isFinite(progress.at[id]) ? progress.at[id] : 0);
  function nextLessonId() { const open = allLessons().filter((l) => !l.locked).find((l) => !isDone(l.id)); return open ? open.id : 1; }
  const current = () => state.lesson.sentences[state.index];
  const wordsOf = (s) => s.nl.replace(/[.?!]+$/, "").split(/\s+/);
  const tileById = (id) => state.tiles.find((t) => t.id === id);
  function shuffle(list) { const c = list.slice(); for (let i = c.length - 1; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1)); [c[i], c[j]] = [c[j], c[i]]; } return c; }

  function deal() {
    const words = wordsOf(current());
    state.tiles = words.map((text, i) => ({ id: "w" + i, text }));
    const solved = (o) => o.map((id) => tileById(id).text).join(" ") === words.join(" ");
    let order = shuffle(state.tiles.map((t) => t.id));
    for (let g = 0; solved(order) && g < 12; g += 1) order = shuffle(order);
    if (solved(order) && order.length > 1) [order[0], order[1]] = [order[1], order[0]];
    state.order = order; state.placed = []; state.status = "building";
    state.wrongCount = 0; state.helpMode = false;
  }
  const bankTiles = () => state.order.filter((id) => !state.placed.includes(id)).map(tileById);
  function fitMarks() {
    if (state.status !== "wrong") return state.placed.map(() => false);
    const w = wordsOf(current());
    return state.placed.map((id, i) => tileById(id).text === w[i]);
  }
  function nextHintId() {
    if (!state.helpMode || state.status === "correct") return null;
    const need = wordsOf(current())[state.placed.length];
    return state.order.find((id) => !state.placed.includes(id) && tileById(id).text === need) || null;
  }

  /* ---------- icons ---------- */
  const iconBack = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const iconSpeaker = '<svg class="spk" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 10h3.2L12 6.2v11.6L7.2 14H4z"/><path d="M15.5 9.2a4 4 0 0 1 0 5.6M17.8 7a7 7 0 0 1 0 10" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
  const iconCheck = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const flags = `<div class="flags"><img src="images/shir-o-khorshid.svg" alt="پرچم تاریخی شیر و خورشید" /><img src="images/us.svg" alt="پرچم آمریکا" /></div>`;

  /* ---------- home ---------- */
  function renderHome() {
    const course = state.course;
    const head = `<header class="h-head">${flags}<h1 class="h-title" dir="ltr" lang="en">Sentix</h1>
      <p class="credit">ساخته شده توسط <b dir="ltr" lang="en">Daniel Mozafari</b></p></header>`;
    if (!course) {
      return `<section class="scr home">${head}<p class="h-sub">${state.loadError ? esc(state.loadError) : "در حال آماده" + Z + "سازی درس" + Z + "ها…"}</p></section>`;
    }
    const lessons = allLessons();
    const nextId = nextLessonId();
    const doneCount = lessons.filter((l) => isDone(l.id)).length;
    const started = resumeAt(nextId) > 0 && !isDone(nextId);
    const cta = isDone(nextId) ? "مرور درس " + toFa(nextId) : (started ? "ادامه" + E + " درس " : (doneCount ? "درس بعدی: " : "شروع درس ")) + toFa(nextId);
    const pct = Math.round((doneCount / lessons.length) * 100);
    const tabs = course.levels.map((lv) => {
      const d = lv.lessons.filter((l) => isDone(l.id)).length;
      return `<button type="button" class="lvl${state.level === lv.id ? " on" : ""}" data-action="level" data-level="${lv.id}" aria-pressed="${state.level === lv.id}"><bdi dir="ltr" lang="en">${lv.id}</bdi><small>${toFa(d)}/${toFa(lv.lessons.length)}</small></button>`;
    }).join("");
    const level = course.levels.find((l) => l.id === state.level) || course.levels[0];
    const rows = level.lessons.map((l) => {
      if (l.locked) {
        return `<li><button type="button" class="row locked" data-action="locked" data-id="${l.id}"><span class="num">${toFa(l.id)}</span><span class="txt"><span class="t">${rich(l.titleFa)}</span><span class="s">در نسخه کامل</span></span><span class="lock" aria-hidden="true">🔒</span></button></li>`;
      }
      const done = isDone(l.id), at = resumeAt(l.id), inProg = !done && at > 0;
      const sub = done ? "تمام شد" : inProg ? "ادامه · جمله " + toFa(at + 1) + " از " + toFa(l.count) : toFa(l.count) + " جمله" + (l.id === nextId ? " · نوبت توست" : "");
      return `<li><button type="button" class="row${done ? " done" : ""}${inProg ? " prog" : ""}" data-action="open" data-id="${l.id}"><span class="num">${done ? iconCheck : toFa(l.id)}</span><span class="txt"><span class="t">${rich(l.titleFa)}</span><span class="s">${sub}</span></span>${done ? '<span class="badge">تمام شد</span>' : inProg ? '<span class="badge go">ادامه</span>' : ""}</button></li>`;
    }).join("");
    return `<section class="scr home home-all" data-level="${level.id}">
      ${head}
      <p class="h-sub">جمله${Z}سازی انگلیسی با لهجه${Z} آمریکایی · <bdi dir="ltr" lang="en">A1–C2</bdi></p>
      <div class="hero"><div class="hero-top"><b>${toFa(doneCount)} از ${toFa(lessons.length)} درس تمام شده</b><button type="button" class="inst" data-install>📲 نصب اپ</button></div>
        <div class="track"><div class="fill" style="width:${pct}%"></div></div></div>
      <button type="button" class="btn main" data-action="open" data-id="${nextId}">${esc(cta)}</button>
      <div class="lvls" role="group" aria-label="سطح">${tabs}</div>
      <p class="lvl-note"><b>${esc(level.titleFa)}</b> · ${esc(LEVEL_NOTE[level.id] || "")}</p>
      <ol class="list">${rows}</ol>
      ${state.lockMsg ? `<p class="toast" role="status">${esc(state.lockMsg)}</p>` : ""}
    </section>`;
  }

  /* ---------- lesson ---------- */
  function topBar(count, pct, sub) {
    return `<header class="top"><button type="button" class="back" data-action="home" aria-label="بازگشت به فهرست">${iconBack}</button>
      <div class="brand"><div class="b-en" dir="ltr" lang="en">Sentix</div><div class="b-fa">${rich(sub)}</div></div>
      <div class="prog"><span>${count}</span><div class="track"><div class="fill" style="width:${pct}%"></div></div></div></header>`;
  }
  function tileHtml(t, mode, fit) {
    const action = mode === "locked" ? "noop" : mode === "placed" ? "remove" : "add";
    const cls = ["tile"];
    if (state.popId === t.id) cls.push("pop");
    if (fit) cls.push("fit");
    if (mode === "bank" && nextHintId() === t.id) cls.push("hint");
    const pr = prOf(t.text);
    return `<button type="button" class="${cls.join(" ")}" data-action="${action}" data-id="${t.id}" data-word="${esc(t.text)}" lang="en" dir="ltr"><span class="tw">${esc(t.text)}</span>${pr ? `<span class="tp" dir="rtl" lang="fa">${esc(pr)}</span>` : ""}</button>`;
  }
  function renderLesson() {
    const L = state.lesson, s = current(), total = L.sentences.length;
    const solved = state.status === "correct";
    const marks = fitMarks();
    const placed = state.placed.map((id, i) => tileHtml(tileById(id), solved ? "locked" : "placed", marks[i])).join("");
    let lower;
    if (solved) {
      lower = `<div class="result" role="status"><p class="r-en" dir="ltr" lang="en">${iconSpeaker}<span>${esc(s.nl)}</span></p>
        <p class="r-pr" dir="rtl" lang="fa">${esc(s.pr || "")}</p><p class="r-fa">${esc(s.fa)}</p>
        <div class="r-bar"><i></i></div></div>`;
    } else {
      let fb = "";
      if (state.helpMode) {
        fb = `<div class="help"><p class="k">جمله درست</p><p class="h-en" dir="ltr" lang="en">${esc(s.nl)}</p><p class="h-pr">${esc(s.pr || "")}</p><p class="h-fa">${esc(s.fa)}</p><p class="h-tip">واژه${Z}ای که آبی می${Z}درخشد را بگذار.</p></div>`;
      } else if (state.status === "wrong") {
        const near = marks.some(Boolean);
        fb = `<p class="fb bad">${near ? "نزدیک شدی. واژه" + Z + "های سبز درست هستند؛ بقیه را جابه" + Z + "جا کن." : "این ترتیب درست نیست. واژه" + Z + "ای را بردار و جای دیگری بگذار."}</p>`;
        if (state.wrongCount >= 2) fb += `<button type="button" class="btn help-btn" data-action="take-help">کمک گرفتن</button>`;
      } else if (state.flash) {
        fb = `<p class="fb ok">${esc(state.flash)}</p>`;
      } else {
        fb = `<p class="fb">هر واژه را لمس کنی، همان لحظه می${Z}شنوی. لمس واژه${E} داخل جمله آن را برمی${Z}دارد.</p>`;
        if (state.wrongCount >= 2) fb += `<button type="button" class="btn help-btn" data-action="take-help">کمک گرفتن</button>`;
      }
      const bank = bankTiles().map((t) => tileHtml(t, "bank", false)).join("");
      lower = `${fb}<div class="bank" dir="ltr">${bank || `<p class="bank-empty">برای جابه${Z}جایی، واژه${Z}ای را از جمله بردار.</p>`}</div>`;
    }
    const buildCls = ["build"];
    if (!state.placed.length) buildCls.push("empty");
    if (state.status === "wrong") buildCls.push("wrong");
    if (solved) buildCls.push("ok");
    if (state.shake) buildCls.push("shake");
    const punct = solved ? `<span class="punct">${esc((s.nl.match(/[.?!]+$/) || ["."])[0])}</span>` : "";
    return `<section class="scr lesson" data-status="${state.status}" data-index="${state.index}">
      ${topBar(toFa(state.index + 1) + " از " + toFa(total), ((state.index + (solved ? 1 : 0)) / total) * 100, "درس " + toFa(L.id) + " · " + L.titleFa)}
      <p class="eyebrow">این را به انگلیسی بساز</p>
      <h2 class="meaning">${esc(s.fa)}</h2>
      <div class="${buildCls.join(" ")}" dir="ltr" lang="en">${placed || `<span class="ph">واژه${Z}ها این${Z}جا می${Z}نشینند</span>`}${punct}</div>
      <div class="lower">${lower}</div>
    </section>`;
  }

  /* ---------- reading page ---------- */
  function renderDone() {
    const L = state.lesson;
    const list = allLessons();
    const next = list[list.findIndex((l) => l.id === L.id) + 1];
    const lines = (L.reading || []).map((r, i) => `<li class="rl${state.readingLine === i ? " on" : ""}${state.readingLine > i ? " past" : ""}" data-line="${i}">
      <p class="rl-en" dir="ltr" lang="en">${esc(r.nl)}</p><p class="rl-pr">${esc(r.pr || "")}</p><p class="rl-fa">${esc(r.fa)}</p></li>`).join("");
    const nextHtml = next && !next.locked
      ? `<button type="button" class="btn sm main" data-action="open" data-id="${next.id}">درس بعدی</button>`
      : `<p class="pill">${next ? "درس " + toFa(next.id) + " در نسخه کامل باز می" + Z + "شود" : "همه" + E + " درس" + Z + "ها تمام شد!"}</p>`;
    return `<section class="scr done">
      ${topBar("تمام", 100, "درس " + toFa(L.id) + " · " + L.titleFa)}
      <div class="d-head"><h2>آفرین! درس ${toFa(L.id)} تمام شد</h2>
        <button type="button" class="play" data-action="play-reading" aria-label="پخش دوباره متن">${iconSpeaker}<span>${state.readingPlaying ? "در حال پخش…" : "دوباره بشنو"}</span></button></div>
      <p class="d-kicker">متن پایان درس</p>
      <ol class="reading">${lines}</ol>
      <div class="d-actions">${nextHtml}<button type="button" class="btn sm ghost" data-action="restart">از اول</button><button type="button" class="btn sm ghost" data-action="home">فهرست</button></div>
    </section>`;
  }

  /* ---------- render + fit ---------- */
  function render() {
    app.dataset.screen = state.screen;
    document.body.dataset.screen = state.screen;
    const prev = app.querySelector(".home-all");
    const keep = prev && state.screen === "home" && prev.dataset.level === state.level ? prev.scrollTop : 0;
    app.innerHTML = state.screen === "home" ? renderHome()
      : state.screen === "loading" ? `<section class="scr lesson">${topBar("…", 0, "درس " + toFa(state.lessonId))}<p class="fb">${state.loadError ? esc(state.loadError) : "در حال آماده" + Z + "سازی صداها…"}</p></section>`
      : state.screen === "done" ? renderDone() : renderLesson();
    state.shake = false; state.popId = null;
    if (state.screen === "home") {
      /* Home is the one screen allowed to scroll: all lessons of the level in one list. */
      const scr = app.querySelector(".home-all");
      if (scr) { scr.style.fontSize = "16px"; scr.scrollTop = keep; }
      return;
    }
    fit();
  }
  /* Shrink the screen's base font until it fits one viewport (no scrolling, ever). */
  function fit() {
    const scr = app.querySelector(".scr");
    if (!scr) return;
    let size = 16;
    scr.style.fontSize = size + "px";
    while (scr.scrollHeight > scr.clientHeight + 1 && size > 10) {
      size -= 0.5;
      scr.style.fontSize = size + "px";
    }
  }
  let rz = 0;
  window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(render, 80); });

  /* ---------- flow ---------- */
  function sayWord(id) {
    const t = tileById(id);
    if (t) A.speak([{ src: wordSrc(t.text), text: core(t.text) }]);
  }
  function addTile(id) {
    if (state.status === "correct" || !tileById(id) || state.placed.includes(id)) return;
    state.placed.push(id);
    state.popId = id;
    state.flash = "";
    const s = current(), words = wordsOf(s);
    const complete = state.placed.length === words.length;
    const correct = complete && state.placed.map((x) => tileById(x).text).join(" ") === words.join(" ");
    if (correct && state.helpMode) {
      /* Helped solve: word, 1 s, sentence — then build the same sentence again without help. */
      sentenceChain(id, s, null);
      deal();
      state.flash = "آفرین. حالا همین جمله را بدون کمک دوباره بساز.";
      render();
      return;
    }
    if (correct) {
      state.status = "correct";
      state.wrongCount = 0;
      if (state.index >= state.lesson.sentences.length - 1) markDone(state.lesson.id);
      else rememberAt(state.lesson.id, state.index + 1);
      render();
      sentenceChain(id, s, scheduleAdvance);
      return;
    }
    sayWord(id);
    if (complete) { state.status = "wrong"; state.wrongCount += 1; state.shake = true; }
    else state.status = "building";
    render();
  }
  function removeTile(id) {
    if (state.status === "correct") return;
    sayWord(id);
    state.placed = state.placed.filter((x) => x !== id);
    state.status = "building";
    state.popId = id;
    render();
  }
  /* Last word plays → 1 s → full sentence plays → (then) callback. */
  function sentenceChain(id, s, then) {
    const my = ++flow;
    const t = tileById(id);
    clearTimeout(advanceTimer);
    const playSentence = () => {
      if (my !== flow) return;
      const bar = app.querySelector(".r-bar i");
      const d = A.duration(sentSrc(s));
      if (bar && d) { bar.style.transitionDuration = d + "s"; requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.width = "100%"; })); }
      const ind = app.querySelector(".result");
      if (ind) ind.classList.add("playing");
      A.speak([{ src: sentSrc(s), text: s.nl }], { onEnd: () => { if (my === flow && then) then(); } });
    };
    A.speak([{ src: wordSrc(t.text), text: core(t.text) }], {
      onEnd: () => { if (my !== flow) return; advanceTimer = setTimeout(playSentence, WORD_TO_SENTENCE); },
    });
  }
  function scheduleAdvance() {
    clearTimeout(advanceTimer);
    const at = state.index, lid = state.lesson.id;
    advanceTimer = setTimeout(() => {
      if (state.screen !== "lesson" || state.index !== at || state.lesson.id !== lid || state.status !== "correct") return;
      if (state.index >= state.lesson.sentences.length - 1) { openReading(); return; }
      state.index += 1;
      deal();
      render();
    }, ADVANCE_GAP);
  }
  function takeHelp() {
    if (state.helpMode || state.status === "correct" || state.wrongCount < 2) return;
    state.helpMode = true;
    state.status = "building";
    state.placed = [];
    render();
  }
  function openReading() {
    state.screen = "done";
    state.readingLine = -1;
    render();
    playReading();
  }
  function playReading() {
    const L = state.lesson;
    if (!L || !L.reading) return;
    state.readingPlaying = true;
    const items = L.reading.map((r) => ({ src: r.audio, text: r.nl }));
    A.speak(items, {
      gap: READING_GAP,
      onStart(i) { state.readingLine = i; highlight(); },
      onEnd() { state.readingPlaying = false; state.readingLine = -1; if (state.screen === "done") render(); },
    });
    render();
  }
  function highlight() {
    app.querySelectorAll(".rl").forEach((el) => {
      const i = Number(el.dataset.line);
      el.classList.toggle("on", i === state.readingLine);
      el.classList.toggle("past", i < state.readingLine);
    });
    const p = app.querySelector(".play span");
    if (p) p.textContent = state.readingPlaying ? "در حال پخش…" : "دوباره بشنو";
  }

  function fetchJson(url) {
    if (cache[url]) return Promise.resolve(cache[url]);
    return fetch(url + "?v=" + (window.DS_VERSION || "1")).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then((d) => { cache[url] = d; return d; });
  }
  const lessonUrl = (id) => "data/lessons/" + String(id).padStart(3, "0") + ".json";
  function lessonSrcs(L) {
    const out = [];
    L.sentences.forEach((s) => { wordsOf(s).forEach((w) => out.push(wordSrc(w))); out.push(sentSrc(s)); });
    (L.reading || []).forEach((r) => out.push(r.audio));
    return out;
  }
  function openLesson(id, fromStart) {
    flow += 1;
    const meta = lessonMeta(id);
    if (!meta || meta.locked) return;
    A.stop(); clearTimeout(advanceTimer);
    state.lessonId = id; state.level = meta.level; state.loadError = ""; state.flash = "";
    state.screen = "loading";
    render();
    fetchJson(lessonUrl(id)).then((L) => {
      /* Decode every clip of the lesson before the first tile appears. */
      const t0 = performance.now();
      return A.preload(lessonSrcs(L)).then(() => {
        window.__sfDecodeMs = Math.round(performance.now() - t0);
        if (state.lessonId !== id) return;
        state.lesson = L;
        const done = isDone(id);
        state.index = fromStart || done ? 0 : Math.min(resumeAt(id), L.sentences.length - 1);
        state.screen = "lesson";
        deal();
        render();
      });
    }).catch(() => { state.loadError = "درس باز نشد. اینترنت را بررسی کن و دوباره امتحان کن."; render(); });
  }
  function goHome() {
    flow += 1;
    A.stop(); clearTimeout(advanceTimer);
    state.screen = "home";
    state.readingPlaying = false;
    render();
  }

  /* ---------- input: tiles react on pointerdown (no click delay) ---------- */
  let suppressUntil = 0;
  function doAction(btn) {
    const a = btn.dataset.action;
    if (a === "add") addTile(btn.dataset.id);
    else if (a === "remove") removeTile(btn.dataset.id);
    else if (a === "noop" && state.status !== "correct") sayWord(btn.dataset.id);
  }
  app.addEventListener("pointerdown", (e) => {
    window.__sfTapT = performance.now();
    A.unlock();
    if (e.button && e.button !== 0) return;
    const btn = e.target.closest("[data-action]");
    if (!btn || !app.contains(btn)) return;
    if (["add", "remove", "noop"].includes(btn.dataset.action)) {
      e.preventDefault();
      suppressUntil = performance.now() + 500;
      doAction(btn);
    }
  });
  document.addEventListener("keydown", () => A.unlock(), { once: true });
  app.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn || !app.contains(btn)) return;
    const a = btn.dataset.action;
    if (["add", "remove", "noop"].includes(a)) {
      if (e.detail === 0) doAction(btn); /* keyboard */
      return;
    }
    if (performance.now() < suppressUntil) return; /* ghost click after a re-render */
    A.unlock();
    if (a === "open") openLesson(Number(btn.dataset.id), isDone(Number(btn.dataset.id)));
    else if (a === "locked") {
      state.lockMsg = "درس " + toFa(btn.dataset.id) + " در نسخه کامل باز می" + Z + "شود. فعلاً درس ۱ را امتحان کن.";
      render();
      clearTimeout(lockTimer);
      lockTimer = setTimeout(() => { state.lockMsg = ""; if (state.screen === "home") render(); }, 2600);
    } else if (a === "level") { state.level = btn.dataset.level; state.page = 0; state.lockMsg = ""; render(); }
    else if (a === "home") goHome();
    else if (a === "restart") { progress.at[state.lesson.id] = 0; save(); openLesson(state.lesson.id, true); }
    else if (a === "take-help") takeHelp();
    else if (a === "play-reading") playReading();
  });

  /* Test hooks (used by automated fit checks). */
  window.SentixDebug = {
    open: (id) => openLesson(id, true),
    jump(i) { if (!state.lesson) return; flow += 1; A.stop(); clearTimeout(advanceTimer); state.index = i; deal(); render(); },
    state: () => ({ screen: state.screen, index: state.index, status: state.status, lesson: state.lesson && state.lesson.id }),
  };

  render();
  fetchJson("data/course.json").then((c) => {
    state.course = c;
    const m = lessonMeta(nextLessonId());
    if (m) state.level = m.level;
    render();
  }).catch(() => { state.loadError = "فهرست درس" + Z + "ها باز نشد. اینترنت را بررسی کن."; render(); });
})();
