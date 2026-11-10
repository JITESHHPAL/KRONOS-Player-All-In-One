const $ = (id) => document.getElementById(id);
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, x) { try { localStorage.setItem(k, x); } catch {} } };
const fmt = (s) => isFinite(s) ? Math.floor(s/60) + ":" + String(Math.floor(s%60)).padStart(2,"0") : "0:00";
const enc = (p) => p.split("/").map(encodeURIComponent).join("/");
let noteT; function note(m) { const e = $("note"); e.textContent = m; e.classList.add("show"); clearTimeout(noteT); noteT = setTimeout(() => e.classList.remove("show"), 2200); }

// ---------- navigation (works with the phone's Back button too) ----------
const SCREENS = { home: $("home"), lib: $("lib"), viewer: $("viewer"), np: $("np"), player: $("wrap") };
let screenNow = "home";
if (document.startViewTransition) document.documentElement.classList.add("vt");
function show(n) {
  const apply = () => {
    for (const k in SCREENS) SCREENS[k].hidden = k !== n;
    $("mini").classList.toggle("show", AU.q.length > 0 && (n === "home" || n === "lib"));
  };
  const smooth = document.startViewTransition && n !== "player" && screenNow !== "player";   // liquid cross-blur between screens
  screenNow = n;
  smooth ? document.startViewTransition(apply) : apply();
}
function go(n) { history.pushState({ s: n }, ""); show(n); }
history.replaceState({ s: "home" }, "");
addEventListener("popstate", (e) => {
  const n = (e.state && e.state.s) || "home";
  if (screenNow === "player") leavePlayer();
  if (screenNow === "viewer") { stopSlide(); if (document.fullscreenElement) document.exitFullscreen(); }
  show(n);
});
$("tRecent").onclick = () => openLib("recent"); $("tVideo").onclick = () => openLib("video"); $("tPhoto").onclick = () => openLib("image"); $("tMusic").onclick = () => openLib("audio");
$("libBack").onclick = $("vback").onclick = $("npBack").onclick = () => history.back();

// ---------- library (videos / photos / music) ----------
let LIB = { video: [], image: [], audio: [] }, DEV = { video: [], image: [], audio: [] }, libType = "video", libLoaded = false;
const TITLES = { recent: "🕘 Recent", video: "🎬 Videos", image: "🖼 Photos", audio: "🎧 Music" };
// recently opened items (server files only; device files can't be reopened later)
let RC = []; try { RC = JSON.parse(store.get("one:recent") || "[]"); } catch {}
function pushRecent(type, name, url) {
  if (!url || url.startsWith("blob:")) return;
  RC = [{ type, name, url, t: Date.now() }, ...RC.filter((r) => r.url !== url)].slice(0, 30); store.set("one:recent", JSON.stringify(RC));
}
const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? "just now" : m < 60 ? m + " min ago" : m < 1440 ? Math.round(m / 60) + " h ago" : Math.round(m / 1440) + " d ago"; };
async function openLib(t) {
  libType = t; $("libTitle").textContent = TITLES[t]; $("libPick").textContent = t === "recent" ? "🗑 Clear" : "＋ Device"; go("lib"); renderLib();
  if (t === "recent") return;
  try { LIB = await (await fetch("/api/list")).json(); } catch {}
  libLoaded = true; if (screenNow === "lib") renderLib();
}
function renderLib() {
  const b = $("libBody"); b.innerHTML = ""; b.className = libType;
  if (libType === "recent") {
    if (!RC.length) { b.innerHTML = '<p class="empty">Nothing yet. Things you play or view will show up here.</p>'; return; }
    const l = document.createElement("div"); l.className = "list"; b.append(l);
    RC.forEach((r, n) => {
      const e = document.createElement("button"); e.className = "gb item2 rc"; e.style.animationDelay = Math.min(n, 14) * 35 + "ms";
      const sv = r.type === "video" ? parseFloat(store.get("one:" + r.name)) || 0 : 0;
      e.innerHTML = `<span>${{ video: "🎬", image: "🖼", audio: "🎧" }[r.type]}</span><div><b></b><small></small></div>`;
      e.querySelector("b").textContent = r.name.split("/").pop(); e.querySelector("small").textContent = ago(r.t) + (sv > 5 ? " · resume " + fmt(sv) : "");
      e.onclick = () => (r.type === "video" ? start(r.url, r.name) : r.type === "image" ? openViewer([r], 0) : playQueue([r], 0));
      l.append(e);
    }); return;
  }
  const items = [...(LIB[libType] || []).map((p) => ({ name: p, url: "/media/" + enc(p), thumb: "/api/thumb?f=" + encodeURIComponent(p) })), ...DEV[libType]];
  if (libType === "video") {
    const r = document.createElement("div"); r.className = "urlrow";
    r.innerHTML = '<input id="url" class="gi" placeholder="Paste a video link (http://…)"><button class="gb" id="go">Play</button>';
    b.append(r); r.querySelector("button").onclick = () => { const u = r.querySelector("input").value.trim(); if (u) start(u, u.split("/").pop()); };
  }
  if (!items.length) { const e = document.createElement("p"); e.className = "empty"; e.textContent = libLoaded ? "Nothing here yet. Put files in the server's videos folder, or tap ＋ Device." : "Loading…"; b.append(e); return; }
  const wrapEl = document.createElement("div"); wrapEl.className = libType === "image" ? "grid" : "list"; b.append(wrapEl);
  items.forEach((it, n) => {
    const e = document.createElement("button"); e.style.animationDelay = Math.min(n, 14) * 35 + "ms";
    if (libType === "image") {
      e.className = "thumb"; const im = new Image(); im.loading = "lazy"; im.decoding = "async"; im.alt = ""; im.src = it.thumb || it.url;
      im.onerror = () => { if (im.src !== new URL(it.url, location.href).href) im.src = it.url; }; e.append(im);
      e.onclick = () => openViewer(items, n);
    } else {
      e.className = "gb item2"; e.textContent = (libType === "video" ? "▶ " : "🎵 ") + it.name.split("/").pop();
      e.onclick = () => (libType === "video" ? start(it.url, it.name) : playQueue(items, n));
    }
    wrapEl.append(e);
  });
}
const ACCEPT = { video: "video/*", image: "image/*", audio: "audio/*" };
$("libPick").onclick = () => {
  if (libType === "recent") { RC = []; store.set("one:recent", "[]"); renderLib(); return note("Recent cleared"); } const f = $("devfile"); f.accept = ACCEPT[libType]; f.multiple = libType !== "video"; f.value = ""; f.click(); };
$("devfile").onchange = (e) => {
  const fs = [...e.target.files]; if (!fs.length) return;
  if (libType === "video") return start(URL.createObjectURL(fs[0]), fs[0].name);
  fs.forEach((f) => DEV[libType].push({ name: f.name, url: URL.createObjectURL(f) })); renderLib(); note(fs.length + " added");
};

// ---------- image viewer ----------
const V = { list: [], i: 0, s: 1, x: 0, y: 0, rot: 0, fit: 0, timer: null };
const FITS = [["Fit", "contain"], ["Fill", "cover"], ["100%", "none"]];
const vimg = $("vimg"), vstage = $("vstage");
function openViewer(list, i) { V.list = list; V.fit = 0; $("vfit").textContent = "Fit"; go("viewer"); showImg(i); $("viewer").classList.remove("vhide"); }
function showImg(i) {
  V.i = (i + V.list.length) % V.list.length; V.s = 1; V.x = V.y = 0; V.rot = 0;
  const it = V.list[V.i]; vimg.classList.remove("fadein"); void vimg.offsetWidth; vimg.classList.add("fadein");
  vimg.src = it.url; pushRecent("image", it.name, it.url); $("vtitle").textContent = it.name.split("/").pop(); $("vcount").textContent = V.i + 1 + " / " + V.list.length;
  new Image().src = V.list[(V.i + 1) % V.list.length].url;       // preload next for instant swipes
  applyImg(true);
}
function applyImg(anim) {
  vimg.style.objectFit = FITS[V.fit][1]; vimg.classList.toggle("anim", !!anim);
  let k = 1;
  if (V.rot % 180 && vimg.naturalWidth) { const W = vstage.clientWidth, H = vstage.clientHeight, f = Math.min(W / vimg.naturalWidth, H / vimg.naturalHeight), w = vimg.naturalWidth * f, h = vimg.naturalHeight * f; k = Math.min(W / h, H / w, 1); }
  vimg.style.transform = `translate(${V.x}px,${V.y}px) scale(${V.s * k}) rotate(${V.rot}deg)`;
}
vimg.onload = () => applyImg(false);
const stepImg = (d) => { showImg(V.i + d); };
function stopSlide() { clearInterval(V.timer); V.timer = null; $("vslide").textContent = "▶"; }
$("vslide").onclick = () => { if (V.timer) return stopSlide(); $("vslide").textContent = "⏸"; V.timer = setInterval(() => stepImg(1), 3000); };
$("vprev").onclick = () => stepImg(-1); $("vnext").onclick = () => stepImg(1);
$("vrot").onclick = () => { V.rot = (V.rot + 90) % 360; applyImg(true); };
const zoom = (f) => { V.s = Math.min(6, Math.max(1, V.s * f)); if (V.s === 1) V.x = V.y = 0; applyImg(true); };
$("vzin").onclick = () => zoom(1.5); $("vzout").onclick = () => zoom(1 / 1.5);
$("vfit").onclick = () => { V.fit = (V.fit + 1) % 3; $("vfit").textContent = FITS[V.fit][0]; V.s = 1; V.x = V.y = 0; applyImg(true); };
$("vfs").onclick = () => (document.fullscreenElement ? document.exitFullscreen() : $("viewer").requestFullscreen().catch(() => {}));
const P = new Map(); let d0 = 0, s0 = 1, px = 0, py = 0, bx = 0, by = 0, moved = false, lastT = 0;
vstage.onpointerdown = (e) => {
  vstage.setPointerCapture(e.pointerId); P.set(e.pointerId, { x: e.clientX, y: e.clientY }); vimg.classList.remove("anim");
  if (P.size === 2) { const [a, b] = [...P.values()]; d0 = Math.hypot(a.x - b.x, a.y - b.y); s0 = V.s; }
  px = e.clientX; py = e.clientY; bx = V.x; by = V.y; moved = false;
};
vstage.onpointermove = (e) => {
  if (!P.has(e.pointerId)) return; P.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (P.size === 2) { const [a, b] = [...P.values()]; V.s = Math.min(6, Math.max(1, s0 * Math.hypot(a.x - b.x, a.y - b.y) / d0)); moved = true; }
  else { const dx = e.clientX - px, dy = e.clientY - py; if (Math.abs(dx) + Math.abs(dy) > 8) moved = true; V.x = bx + dx; V.y = V.s > 1 ? by + dy : 0; }
  applyImg(false);
};
vstage.onpointerup = vstage.onpointercancel = (e) => {
  P.delete(e.pointerId); if (P.size) return;
  if (V.s < 1.05) { const dx = V.x, sw = V.s === 1 && Math.abs(dx) > 70; V.s = 1; V.x = V.y = 0; if (sw) return stepImg(dx < 0 ? 1 : -1); applyImg(true); }
  if (!moved) {
    const n = Date.now();
    if (n - lastT < 300) { lastT = 0; V.s = V.s > 1 ? 1 : 2.5; V.x = V.y = 0; applyImg(true); } else { lastT = n; setTimeout(() => { if (lastT === n) $("viewer").classList.toggle("vhide"); }, 300); }
  }
};
vstage.onwheel = (e) => { e.preventDefault(); zoom(e.deltaY < 0 ? 1.2 : 1 / 1.2); };
document.addEventListener("keydown", (e) => {
  if (screenNow !== "viewer") return;
  if (e.key === "ArrowRight") stepImg(1); if (e.key === "ArrowLeft") stepImg(-1);
  if (e.key === "+" || e.key === "=") zoom(1.3); if (e.key === "-") zoom(1 / 1.3); if (e.key === "Escape") history.back();
});

// ---------- audio listener ----------
const A = new Audio(); A.preload = "auto";
const AU = { q: [], i: 0, rep: 0, shuf: false, rate: 1, sleep: 0, sleepT: null };
const REP = ["🔁", "🔁", "🔂"], RATES = [0.75, 1, 1.25, 1.5, 2], SLEEPS = [0, 15, 30, 60];
function playQueue(items, i) { if (screenNow === "player") return; AU.q = items; playAt(i); go("np"); }
function playAt(i) {
  AU.i = (i + AU.q.length) % AU.q.length; const t = AU.q[AU.i], name = t.name.split("/").pop().replace(/\.[^.]+$/, "");
  pushRecent("audio", t.name, t.url); A.src = t.url; A.playbackRate = AU.rate; A.play().catch(() => {});
  $("ntitle").textContent = $("mtitle").textContent = name;
  if ("mediaSession" in navigator) {
    const m = navigator.mediaSession; m.metadata = new MediaMetadata({ title: name, artist: "KRONOS", artwork: [{ src: "icon-512.png", sizes: "512x512", type: "image/png" }] });
    m.setActionHandler("play", () => A.play()); m.setActionHandler("pause", () => A.pause());
    m.setActionHandler("previoustrack", () => playAt(AU.i - 1)); m.setActionHandler("nexttrack", () => nextTrack(false));
    m.setActionHandler("seekbackward", () => (A.currentTime -= 10)); m.setActionHandler("seekforward", () => (A.currentTime += 10));
  }
}
function nextTrack(auto) {
  if (AU.rep === 2 && auto) { A.currentTime = 0; A.play(); return; }
  let n; if (AU.shuf && AU.q.length > 1) { do n = Math.floor(Math.random() * AU.q.length); while (n === AU.i); } else n = AU.i + 1;
  if (n >= AU.q.length) { if (AU.rep === 0 && auto) { A.pause(); return; } n = 0; }
  playAt(n);
}
A.onended = () => nextTrack(true);
A.onplay = A.onpause = () => { const p = A.paused; $("nplay").textContent = $("mplay").textContent = p ? "▶" : "⏸"; $("np").classList.toggle("playing", !p); };
A.ontimeupdate = () => {
  const p = A.duration ? (A.currentTime / A.duration) * 1000 : 0; $("nseek").value = p; $("nseek").style.setProperty("--p", p / 10 + "%");
  $("ncur").textContent = fmt(A.currentTime); $("ndur").textContent = fmt(A.duration);
};
$("nseek").oninput = (e) => { if (A.duration) A.currentTime = (e.target.value / 1000) * A.duration; };
$("nplay").onclick = $("mplay").onclick = (e) => { e.stopPropagation(); A.paused ? A.play() : A.pause(); };
$("nprev").onclick = () => (A.currentTime > 4 ? (A.currentTime = 0) : playAt(AU.i - 1));
$("nnext").onclick = () => nextTrack(false); $("mnext").onclick = (e) => { e.stopPropagation(); nextTrack(false); };
$("nshuf").onclick = () => { AU.shuf = !AU.shuf; $("nshuf").classList.toggle("on", AU.shuf); note(AU.shuf ? "Shuffle on" : "Shuffle off"); };
$("nrep").onclick = () => { AU.rep = (AU.rep + 1) % 3; $("nrep").textContent = REP[AU.rep]; $("nrep").classList.toggle("on", AU.rep > 0); note(["Repeat off", "Repeat all", "Repeat one"][AU.rep]); };
$("nrate").onclick = () => { AU.rate = RATES[(RATES.indexOf(AU.rate) + 1) % RATES.length]; A.playbackRate = AU.rate; $("nrate").textContent = AU.rate + "x"; };
$("nsleep").onclick = () => {
  AU.sleep = SLEEPS[(SLEEPS.indexOf(AU.sleep) + 1) % SLEEPS.length]; clearTimeout(AU.sleepT);
  if (AU.sleep) AU.sleepT = setTimeout(() => { A.pause(); AU.sleep = 0; $("nsleep").textContent = "😴 Off"; note("Sleep timer: stopped"); }, AU.sleep * 60000);
  $("nsleep").textContent = "😴 " + (AU.sleep ? AU.sleep + " min" : "Off");
};
$("nlist").onclick = () => history.back();
$("mini").onclick = () => go("np");
