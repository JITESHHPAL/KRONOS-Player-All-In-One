const v = $("v"), wrap = $("wrap");
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

let busy = false, pct = 0, swapId = 0, seekT = 0, lite = store.get("one:lite") === "1", idleT, toastT, prepT, prepId = 0, rel = null, directSrc = "", pname = "", info = null, audioSel = -1, qualSel = 0,
    subs = [], activeSub = -1, rate = 1, screenMode = "fit", locked = false, tab = null, stalls = [], hinted = false, lastSave = 0, lastTap = 0, prevIdle = false;
const cur = () => v.currentTime, dur = () => v.duration;
const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
const panelOpen = () => $("menu").classList.contains("show");
function toast(msg, ms = 2500) { const e = $("toast"); e.textContent = msg; e.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => e.classList.remove("show"), ms); }
function setPanel(b) { $("menu").classList.toggle("show", b); if (b) { tab = null; renderPanel(false); wake(); } }

// Immersive mode: real fullscreen (no browser bars) + landscape
async function goImmersive() {
  try {
    if (!fsEl()) await (wrap.requestFullscreen || wrap.webkitRequestFullscreen).call(wrap);
    await screen.orientation.lock("landscape"); locked = true;
  } catch (e) {}
}

function start(src, name) {
  A.pause(); go("player"); v.removeAttribute("poster"); wrap.classList.toggle("lite", lite);
  goImmersive();                                   // runs inside the tap that chose the video
  subs.forEach((s) => (s.tt.mode = "disabled"));
  pname = decodeURIComponent(name || ""); $("title").textContent = pname;
  audioSel = -1; qualSel = 0; subs = []; activeSub = -1; info = null; rel = null; prepId++; clearTimeout(prepT);
  stalls = []; hinted = false; pushRecent("video", pname, src);
  directSrc = src; v.src = src; v.playbackRate = rate;
  const saved = parseFloat(store.get("one:" + pname)) || 0;
  v.addEventListener("loadedmetadata", () => { if (saved > 5 && saved < v.duration - 15) { v.currentTime = saved; toast("Resumed from " + fmt(saved)); } }, { once: true });
  v.play().catch(() => {});
  if (src.startsWith("/media/")) {
    rel = decodeURIComponent(src.slice(7));
    fetch("/api/tracks?f=" + encodeURIComponent(rel)).then((r) => r.json()).then((i) => { info = i; if (panelOpen()) renderPanel(true); }).catch(() => {});
  }
  if (!src.startsWith("blob:")) autoSubs(src);
  if ("mediaSession" in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: pname, artist: "KRONOS", artwork: [{ src: "icon-512.png", sizes: "512x512", type: "image/png" }] });
  wake();
}
$("close").onclick = () => history.back();
function leavePlayer() {
  v.pause(); v.removeAttribute("src"); v.removeAttribute("poster"); v.load(); setPanel(false); prepId++; clearTimeout(prepT); busy = false;
  try { screen.orientation.unlock(); } catch {} if (fsEl()) document.exitFullscreen();
  locked = false;
}
const q = new URLSearchParams(location.search).get("src");
if (q) start(q.startsWith("/media/") ? "/media/" + q.slice(7).split("/").map(encodeURIComponent).join("/") : q, q.split("/").pop());

// Playback
const toggle = () => (v.paused ? v.play() : v.pause());
function seek(t) { const d = dur(); v.currentTime = Math.max(0, d ? Math.min(t, d - 0.5) : t); }
$("play").onclick = toggle;
v.onplay = v.onpause = () => ($("play").textContent = v.paused ? "▶" : "⏸");
$("back").onclick = () => seek(cur() - 10);
$("fwd").onclick = () => seek(cur() + 10);
v.ontimeupdate = () => {
  const d = dur(), p = d ? (cur() / d) * 1000 : 0;
  $("seek").value = p; $("seek").style.setProperty("--p", p / 10 + "%");
  $("time").textContent = fmt(cur()) + " / " + fmt(d);
  if (Date.now() - lastSave > 4000 && cur() > 1) { lastSave = Date.now(); store.set("one:" + pname, cur()); }
};
v.onended = () => store.set("one:" + pname, 0);
$("seek").oninput = (e) => {
  $("seek").style.setProperty("--p", e.target.value / 10 + "%"); $("time").textContent = fmt((e.target.value / 1000) * dur()) + " / " + fmt(dur());
  const n = Date.now(); if (n - seekT > 180) { seekT = n; seek((e.target.value / 1000) * dur()); }   // throttled = no stutter while dragging
};
$("seek").onchange = (e) => seek((e.target.value / 1000) * dur());
$("fs").onclick = () => (fsEl() ? document.exitFullscreen() : goImmersive());
const spin = (b) => $("spin").classList.toggle("show", b);
["waiting", "stalled", "seeking"].forEach((e) => v.addEventListener(e, () => spin(true)));
v.addEventListener("waiting", () => {   // choppy playback? suggest the fix
  const n = Date.now(); stalls = stalls.filter((x) => n - x < 30000); stalls.push(n);
  if (stalls.length >= 3 && !hinted) { hinted = true; toast("Choppy? Open ⚙ → Video and pick ⚡ Optimize or a lower quality", 6000); }
});
["playing", "canplay", "seeked", "pause"].forEach((e) => v.addEventListener(e, () => spin(false)));
if ("mediaSession" in navigator) {
  const m = navigator.mediaSession;
  m.setActionHandler("play", () => v.play()); m.setActionHandler("pause", () => v.pause());
  m.setActionHandler("seekbackward", () => seek(cur() - 10)); m.setActionHandler("seekforward", () => seek(cur() + 10));
}

// Audio + video quality: the server builds a normal MP4 (perfect sync, instant seeking), cached for next time
function swap(url, t, play) {
  const id = ++swapId; spin(true);
  try { if (v.videoWidth) { const c = document.createElement("canvas"); c.width = v.videoWidth >> 1; c.height = v.videoHeight >> 1; c.getContext("2d").drawImage(v, 0, 0, c.width, c.height); v.poster = c.toDataURL("image/jpeg", 0.6); } } catch {}   // frozen frame = no black flash
  v.src = url; v.playbackRate = rate;
  v.addEventListener("loadedmetadata", () => {
    if (id !== swapId) return; v.currentTime = t;
    v.addEventListener("seeked", () => { if (id !== swapId) return; v.removeAttribute("poster"); if (play) v.play().catch(() => {}); }, { once: true });
  }, { once: true });
}
function applyMedia() {
  clearTimeout(prepT); const id = ++prepId;
  if (audioSel < 0 && qualSel === 0) { swap(directSrc, cur(), !v.paused); toast("Original"); return; }
  const ai = audioSel >= 0 ? audioSel : (info.default || 0);
  const label = [audioSel >= 0 ? info.audio[audioSel].label : "", qualSel ? qualSel + "p" : ""].filter(Boolean).join(" · ");
  busy = true; pct = 0; toast("Preparing " + label + "…", 600000); renderPanel(true);
  const poll = async () => {
    try {
      const r = await (await fetch(`/api/prepare?f=${encodeURIComponent(rel)}&a=${ai}&h=${qualSel}`)).json();
      if (id !== prepId) return;
      if (r.state === "ready") { busy = false; renderPanel(true); swap(r.url, cur(), !v.paused); toast("Now playing: " + label); return; }
      if (r.state === "error") { busy = false; audioSel = -1; qualSel = 0; toast("Couldn't prepare that option"); renderPanel(true); return; }
      pct = r.progress || 0; toast("Preparing " + label + "… " + pct + "%", 600000); renderPanel(true);
      prepT = setTimeout(poll, 900);
    } catch { busy = false; toast("Server not reachable"); }
  };
  poll();
}
const setAudio = (i) => { audioSel = i; applyMedia(); };
const setQuality = (h) => { qualSel = h; applyMedia(); };
v.onerror = () => { if (wrap.hidden || !v.getAttribute("src")) return; if (audioSel >= 0 || qualSel > 0) { toast("That version won't play here. Back to original."); audioSel = -1; qualSel = 0; applyMedia(); } };

// Subtitles
const tsec = (s) => s.trim().split(":").reduce((a, x) => a * 60 + parseFloat(x), 0);
function parseVtt(t) {
  const out = [];
  t.replace(/\r/g, "").split(/\n\n+/).forEach((b) => {
    const L = b.split("\n"), i = L.findIndex((l) => l.includes("-->")); if (i < 0) return;
    const [a, c] = L[i].split("-->");
    out.push({ s: tsec(a.replace(",", ".")), e: tsec(c.trim().split(" ")[0].replace(",", ".")), x: L.slice(i + 1).join("\n").replace(/<[^>]+>/g, "") });
  });
  return out;
}
function addSub(label, text) {
  const tt = v.addTextTrack("subtitles", label); tt.mode = "hidden";
  parseVtt(text).forEach((c) => tt.addCue(new VTTCue(c.s, c.e, c.x)));
  subs.push({ tt, label }); return subs.length - 1;
}
function selectSub(i) { activeSub = i; subs.forEach((s, j) => (s.tt.mode = j === i ? "showing" : "hidden")); }
const srtToVtt = (s) => s.replace(/(\d+:\d+:\d+),(\d+)/g, "$1.$2");
$("file").onchange = async (e) => { const f = e.target.files[0]; if (!f) return; selectSub(addSub(f.name, srtToVtt(await f.text()))); e.target.value = ""; renderPanel(true); };
async function autoSubs(src) {
  const base = src.replace(/\.[^./?]+$/, "");
  for (const ext of ["vtt", "srt"]) {
    try { const r = await fetch(base + "." + ext); if (r.ok) { addSub("Auto (" + ext + ")", srtToVtt(await r.text())); break; } } catch {}
  }
}

// Screen size
const modes = [["Fit (original ratio)", "fit"], ["Fill / Zoom (crop)", "fill"], ["Stretch", "stretch"], ["16:9", "16:9"], ["4:3", "4:3"], ["21:9 cinema", "21:9"], ["Original size (100%)", "orig"]];
function applyScreen() {
  const st = v.style; st.cssText = "";
  if (screenMode === "fit") st.objectFit = "contain";
  else if (screenMode === "fill") st.objectFit = "cover";
  else if (screenMode === "stretch") st.objectFit = "fill";
  else if (screenMode === "orig") st.objectFit = "none";
  else {
    const [a, b] = screenMode.split(":").map(Number), r = a / b, W = wrap.clientWidth, H = wrap.clientHeight;
    let w = W, h = W / r; if (h > H) { h = H; w = H * r; }
    Object.assign(st, { objectFit: "fill", inset: "auto", left: "50%", top: "50%", width: w + "px", height: h + "px", transform: "translate(-50%,-50%)" });
  }
  applyFilter();
}

// Picture (image) settings: presets, brightness / contrast / saturation, screenshot
const PRESETS = [["Normal", 100, 100, 100, ""], ["Vivid", 105, 112, 145, ""], ["Cinema", 95, 118, 90, "sepia(12%)"], ["Warm", 102, 100, 112, "sepia(28%)"],
                 ["Cool", 100, 104, 105, "hue-rotate(-14deg)"], ["Night", 78, 105, 95, ""], ["B&W", 100, 110, 0, ""]];
let img = { b: 100, c: 100, s: 100, x: "", pre: "Normal" };
try { Object.assign(img, JSON.parse(store.get("one:img") || "{}")); } catch {}
function applyFilter() {
  const plain = img.b === 100 && img.c === 100 && img.s === 100 && !img.x;
  v.style.filter = plain ? "" : `brightness(${img.b}%) contrast(${img.c}%) saturate(${img.s}%)${img.x ? " " + img.x : ""}`;
  store.set("one:img", JSON.stringify(img));
}
applyFilter();
function shot() {
  try {
    const c = document.createElement("canvas"); c.width = v.videoWidth; c.height = v.videoHeight;
    const x = c.getContext("2d"); x.filter = v.style.filter || "none"; x.drawImage(v, 0, 0);
    c.toBlob((b) => {
      if (!b) return toast("Couldn't capture this frame");
      const a = document.createElement("a"); a.href = URL.createObjectURL(b);
      a.download = pname.replace(/\.[^.]+$/, "") + "_" + fmt(cur()).replace(":", "-") + ".png"; a.click(); toast("📸 Screenshot saved");
    }, "image/png");
  } catch (e) { toast("Screenshot isn't allowed for this video"); }
}
function renderImage(body) {
  const chips = document.createElement("div"); chips.className = "chips";
  PRESETS.forEach(([n, b, c, s, x]) => {
    const e = document.createElement("button"); e.className = "item" + (img.pre === n ? " on" : ""); e.textContent = n;
    e.onclick = () => { img = { b, c, s, x, pre: n }; applyFilter(); wake(); renderPanel(true); }; chips.append(e);
  });
  body.append(chips);
  [["Brightness", "b", 50, 150], ["Contrast", "c", 50, 150], ["Saturation", "s", 0, 200]].forEach(([l, k, lo, hi]) => {
    const d = document.createElement("div"); d.className = "sl";
    d.innerHTML = `<div><span>${l}</span><b>${img[k]}%</b></div><input type="range" min="${lo}" max="${hi}" value="${img[k]}">`;
    d.querySelector("input").oninput = (e) => { img[k] = +e.target.value; img.pre = "Custom"; d.querySelector("b").textContent = img[k] + "%"; applyFilter(); wake(); };
    body.append(d);
  });
  [["↺ Reset picture", () => { img = { b: 100, c: 100, s: 100, x: "", pre: "Normal" }; applyFilter(); renderPanel(true); }], ["📸 Save screenshot", shot]].forEach(([l, fn]) => {
    const e = document.createElement("button"); e.className = "item"; e.textContent = l; e.onclick = () => { fn(); wake(); }; body.append(e);
  });
}
async function toggleLock() {
  try {
    if (!locked) { if (!fsEl()) await wrap.requestFullscreen(); await screen.orientation.lock("landscape"); locked = true; }
    else { screen.orientation.unlock(); locked = false; }
  } catch (e) { toast("Rotation lock isn't supported here"); }
}

// Right-side settings panel
const needFfmpeg = (what) => [{ label: info && info.error === "noffmpeg" ? "Install ffmpeg on the laptop to use " + what : "Not available for this video (play it from the laptop server)" }];
const audioItems = () => {
  if (info && info.audio && info.audio.length) return [
    { label: "Original (browser default)", on: audioSel === -1, fn: () => setAudio(-1) },
    ...info.audio.map((a, i) => ({ label: a.label + (busy && i === audioSel ? " ⏳ " + pct + "%" : ""), on: i === audioSel, fn: () => setAudio(i) }))];
  if (v.audioTracks && v.audioTracks.length > 1) return [...v.audioTracks].map((t, i) => ({ label: t.label || t.language || "Audio " + (i + 1), on: t.enabled,
    fn: () => { for (let j = 0; j < v.audioTracks.length; j++) v.audioTracks[j].enabled = j === i; } }));
  return needFfmpeg("audio languages");
};
const videoItems = () => {
  if (!info || info.error || !info.height) return needFfmpeg("video quality");
  const H = info.height, compat = !["h264", "vp9", "av1"].includes(info.vcodec);
  const hs = [1080, 720, 480, 360].filter((x) => x < H);
  return [{ label: `Original (${H}p)`, on: qualSel === 0 && audioSel < 0, fn: () => { audioSel = -1; setQuality(0); } },
    { label: "⚡ Optimize for smooth playback" + (busy && qualSel === 0 && audioSel >= 0 ? " ⏳ " + pct + "%" : ""), on: qualSel === 0 && audioSel >= 0 && audioSel === (info.default || 0), fn: () => { audioSel = info.default || 0; setQuality(0); } },
    ...(compat ? [{ label: `Convert for this device (${H}p)`, on: qualSel === H, fn: () => setQuality(H) }] : []),
    ...hs.map((x) => ({ label: x + "p" + (x <= 480 ? " (data saver)" : "") + (busy && qualSel === x ? " ⏳ " + pct + "%" : ""), on: qualSel === x, fn: () => setQuality(x) }))];
};
const subItems = () => {
  const it = [{ label: "Off", on: activeSub === -1, fn: () => selectSub(-1) }];
  subs.forEach((s, i) => it.push({ label: s.label, on: i === activeSub, fn: () => selectSub(i) }));
  if (info && info.subs) info.subs.forEach((s, n) => {
    if (subs.some((x) => x.label === "★ " + s.label)) return;
    it.push({ label: "★ " + s.label + " (embedded)", fn: async () => {
      try { selectSub(addSub("★ " + s.label, await (await fetch(`/api/sub?f=${encodeURIComponent(rel)}&s=${n}`)).text())); }
      catch { toast("This subtitle type can't be converted"); } } });
  });
  it.push({ label: "📄 Load subtitle file…", fn: () => $("file").click() });
  return it;
};
const speedItems = () => [0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => ({ label: r + "x" + (r === 1 ? " (normal)" : ""), on: rate === r, fn: () => { rate = r; v.playbackRate = r; } }));
const screenItems = () => [
  ...modes.map(([l, m]) => ({ label: l, on: screenMode === m, fn: () => { screenMode = m; applyScreen(); } })),
  { label: "🔒 Lock landscape", on: locked, fn: toggleLock },
  { label: "⚡ Smooth mode (lighter glass)", on: lite, fn: () => { lite = !lite; wrap.classList.toggle("lite", lite); store.set("one:lite", lite ? "1" : "0"); } },
  { label: "⛶ Fullscreen", on: !!fsEl(), fn: () => (fsEl() ? document.exitFullscreen() : goImmersive()) }];
const CATS = [
  ["audio", "🔊", "Audio", () => (audioSel >= 0 && info && info.audio && info.audio[audioSel] ? info.audio[audioSel].label : "Original")],
  ["video", "🎞", "Video", () => (qualSel ? qualSel + "p" : "Original")],
  ["image", "🖼", "Image", () => img.pre],
  ["subs", "💬", "Subtitles", () => (activeSub >= 0 && subs[activeSub] ? subs[activeSub].label : "Off")],
  ["speed", "⏩", "Speed", () => rate + "x"],
  ["screen", "📐", "Screen", () => (modes.find((m) => m[1] === screenMode) || [""])[0]]];
function renderPanel(keep = false, dir = "fwd") {
  const body = $("mbody"), top = body.scrollTop; body.innerHTML = ""; body.classList.toggle("still", keep);
  $("mhead").querySelector("b").textContent = tab ? CATS.find((c) => c[0] === tab)[2] : "Settings";
  if (!keep) { body.classList.remove("pgf", "pgb"); void body.offsetWidth; body.classList.add(dir === "back" ? "pgb" : "pgf"); }
  if (tab === null) {                                   // main menu
    CATS.forEach(([k, ic, name, val], n) => {
      const b = document.createElement("button"); b.className = "item cat"; b.style.animationDelay = n * 30 + "ms";
      const i = document.createElement("span"), d = document.createElement("div"), t = document.createElement("b"), sm = document.createElement("small"), ar = document.createElement("i");
      i.textContent = ic; t.textContent = name; sm.textContent = val(); ar.textContent = "›"; d.append(t, sm); b.append(i, d, ar);
      b.onclick = () => { tab = k; renderPanel(false, "fwd"); }; body.append(b);
    }); return;
  }
  if (tab === "image") { renderImage(body); body.scrollTop = keep ? top : 0; return; }
  ({ audio: audioItems, video: videoItems, subs: subItems, speed: speedItems, screen: screenItems })[tab]().forEach((it, n) => {
    const b = document.createElement("button"); b.className = "item" + (it.on ? " on" : ""); b.textContent = (it.on ? "✓ " : "") + it.label; b.style.animationDelay = n * 25 + "ms";
    if (it.fn) b.onclick = async () => { await it.fn(); wake(); renderPanel(true); }; else b.disabled = true;
    body.append(b);
  });
  body.scrollTop = keep ? top : 0;
}
$("mback").onclick = () => { if (tab) { tab = null; renderPanel(false, "back"); } else setPanel(false); };
$("gear").onclick = () => setPanel(!panelOpen());

// Tap = show/hide controls · double-tap sides = ±10s · double-tap centre = play/pause
const hideNow = () => { clearTimeout(idleT); wrap.classList.add("idle"); };
function wake() { wrap.classList.remove("idle"); clearTimeout(idleT); idleT = setTimeout(() => { if (!v.paused && !panelOpen()) wrap.classList.add("idle"); }, 3500); }
const flash = (id) => { const e = $(id); e.classList.remove("go"); void e.offsetWidth; e.classList.add("go"); };
v.addEventListener("click", (e) => {
  setPanel(false);
  if (!fsEl()) { goImmersive(); wake(); return; }
  const now = Date.now(), x = e.clientX / wrap.clientWidth;
  if (now - lastTap < 320) {
    lastTap = 0;
    if (x < 0.35) { seek(cur() - 10); flash("ripL"); } else if (x > 0.65) { seek(cur() + 10); flash("ripR"); } else toggle();
    prevIdle ? hideNow() : wake(); return;
  }
  lastTap = now; prevIdle = wrap.classList.contains("idle");
  prevIdle ? wake() : hideNow();
});
["#top", "#bar", "#center", "#menu"].forEach((x) => wrap.querySelector(x).addEventListener("pointerdown", wake));
document.addEventListener("pointermove", (e) => { if (e.pointerType === "mouse") wake(); });
addEventListener("resize", applyScreen);
const onFs = () => { applyScreen(); if (fsEl()) hideNow(); else { locked = false; if (!wrap.hidden) wake(); } };
document.addEventListener("fullscreenchange", onFs); document.addEventListener("webkitfullscreenchange", onFs);
matchMedia("(orientation: landscape)").addEventListener("change", (e) => { if (e.matches && !wrap.hidden && !fsEl()) toast("Tap the screen for fullscreen"); });
document.addEventListener("keydown", (e) => {
  wake();
  if (e.target.tagName === "INPUT" && e.target.type === "text") return;
  if (e.key === "Escape" && panelOpen()) { $("mback").click(); return; }
  if (e.code === "Space") { e.preventDefault(); toggle(); }
  if (e.code === "ArrowLeft") seek(cur() - 10);
  if (e.code === "ArrowRight") seek(cur() + 10);
  if (e.key === "f") $("fs").click();
});
