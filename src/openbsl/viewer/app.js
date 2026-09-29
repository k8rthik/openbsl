"use strict";
// openbsl viewer: a minimal stand-in for BSL "Review Saved Data" mode.
// Drag = I-beam selection; measurements mirror BSL (Delta T, BPM, per-channel P-P and Value).
const RECS = window.RECORDINGS || [];
const $ = (id) => document.getElementById(id);
const STORE_KEY = "ecg-annotations-v2";
const PARAM_KEY = "ecg-params-v1";
const CYCLES = [1, 2, 3];

const state = { rec: null, lesson: null, t0: 0, t1: 3.5, sel: null, dragging: false, hoverT: null,
                ann: load(STORE_KEY, []), params: load(PARAM_KEY, {}) };

function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function persist(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { console.warn("localStorage unavailable", e); }
}

// ---------------- channel access ----------------
const nSamples = (ch) => (ch.kind === "step" ? ch.n : ch.data.length);
const clampIdx = (ch, i) => Math.min(Math.max(i, 0), nSamples(ch) - 1);
function stepIndex(ch, i) {
  let lo = 0, hi = ch.idx.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (ch.idx[m] <= i) lo = m; else hi = m - 1; }
  return lo;
}
function valueAt(ch, t) {
  const i = clampIdx(ch, Math.round(t * ch.fs));
  return ch.kind === "step" ? ch.val[stepIndex(ch, i)] : ch.data[i];
}
function minMax(ch, ta, tb) {
  const a = clampIdx(ch, Math.round(ta * ch.fs)), b = clampIdx(ch, Math.round(tb * ch.fs));
  let mn = Infinity, mx = -Infinity;
  if (ch.kind === "step") {
    for (let k = stepIndex(ch, a); k < ch.idx.length && (ch.idx[k] <= b || k === stepIndex(ch, a)); k++) {
      mn = Math.min(mn, ch.val[k]); mx = Math.max(mx, ch.val[k]);
    }
  } else {
    for (let i = a; i <= b; i++) { const v = ch.data[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
  }
  return [mn, mx];
}
function measure(sel) {
  const ta = Math.min(sel.a, sel.b), tb = Math.max(sel.a, sel.b), dtMs = (tb - ta) * 1000;
  const pp = {}, val = {};
  state.rec.channels.forEach((ch) => {
    const [mn, mx] = minMax(ch, ta, tb); pp[ch.name] = mx - mn;
    val[ch.name] = valueAt(ch, sel.b); // BSL reads Value at the end the cursor was dragged to
  });
  return { dtMs, bpm: dtMs > 0 ? 60000 / dtMs : NaN, pp, val };
}

// ---------------- conditions / components ----------------
function conditionAt(t) {
  const marks = state.rec.markers.filter((m) => m.t <= t + 1e-9).reverse();
  for (const m of marks) {
    const hit = state.lesson.match.find(([re]) => re.test(m.text));
    if (hit) return hit[1];
  }
  return state.lesson.conditions[0];
}
const component = (name) => state.lesson.components.find((c) => c.name === name);
function channelFor(comp) {
  const chans = state.rec.channels;
  return (comp && comp.ch && chans.find((c) => comp.ch.test(c.name))) || chans[0];
}
function metric(a, name) {
  if (!a) return NaN;
  if (name === "dt") return a.dtMs;
  if (name === "bpm") return a.bpm;
  const ch = channelFor(component(a.component));
  return (name === "pp" ? a.pp : a.val)[ch.name];
}
const api = {
  get: (cond, comp, cycle, name) => metric(state.ann.find((a) => a.rec === state.rec.name && a.condition === cond && a.component === comp && a.cycle === cycle), name),
  param: (id) => state.params[`${state.rec.name}:${id}`] ?? "",
};

// ---------------- plotting ----------------
const cv = $("plot"), ctx = cv.getContext("2d");
const PAD = { l: 58, r: 10, t: 18, b: 18, gap: 10 };
function layout() {
  const w = cv.clientWidth, h = cv.clientHeight, chans = state.rec.channels;
  const weights = chans.map((c) => (c.kind === "step" ? 0.45 : 1)), total = weights.reduce((s, x) => s + x, 0);
  const avail = h - PAD.t - PAD.b - PAD.gap * (chans.length - 1);
  let y = PAD.t;
  const panes = weights.map((wt) => { const ph = (avail * wt) / total, p = [y, y + ph]; y += ph + PAD.gap; return p; });
  return { w, h, x0: PAD.l, x1: w - PAD.r, panes, top: PAD.t, bottom: h - PAD.b };
}
const tToX = (L, t) => L.x0 + ((t - state.t0) / (state.t1 - state.t0)) * (L.x1 - L.x0);
const xToT = (L, x) => state.t0 + ((x - L.x0) / (L.x1 - L.x0)) * (state.t1 - state.t0);
function niceStep(range, target) {
  const raw = range / target || 1, p = Math.pow(10, Math.floor(Math.log10(raw)));
  return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw);
}
const hue = (name) => (state.lesson.components.findIndex((c) => c.name === name) * 47 + 20) % 360;

function drawChannel(L, ch, [top, bot]) {
  let [mn, mx] = minMax(ch, state.t0, state.t1);
  if (!Number.isFinite(mn)) return;
  const MIN_STEP_SPAN = 20; // keep rate channels (BPM) from zooming into ±1 BPM noise
  if (ch.kind === "step" && mx - mn < MIN_STEP_SPAN) { const c = (mx + mn) / 2; mn = c - MIN_STEP_SPAN / 2; mx = c + MIN_STEP_SPAN / 2; }
  const pad = (mx - mn) * 0.08 || 1; mn -= pad; mx += pad;
  const y = (v) => bot - ((v - mn) / (mx - mn)) * (bot - top);

  ctx.strokeStyle = "#eee"; ctx.fillStyle = "#777"; ctx.textAlign = "right";
  const vs = niceStep(mx - mn, ch.kind === "step" ? 3 : 6);
  for (let v = Math.ceil(mn / vs) * vs; v <= mx; v += vs) {
    ctx.beginPath(); ctx.moveTo(L.x0, y(v)); ctx.lineTo(L.x1, y(v)); ctx.stroke();
    ctx.fillText(+v.toFixed(4), L.x0 - 4, y(v));
  }
  ctx.save(); ctx.translate(10, (top + bot) / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = "center";
  ctx.fillText(`${ch.name} (${ch.units})`, 0, 0); ctx.restore();

  ctx.save(); ctx.beginPath(); ctx.rect(L.x0, top, L.x1 - L.x0, bot - top); ctx.clip();
  ctx.strokeStyle = ch.kind === "step" ? "#1f6fd1" : "#111"; ctx.lineWidth = 1; ctx.beginPath();
  if (ch.kind === "step") {
    const k0 = stepIndex(ch, clampIdx(ch, Math.floor(state.t0 * ch.fs)));
    for (let k = k0; k < ch.idx.length && ch.idx[k] / ch.fs <= state.t1; k++) {
      const xa = tToX(L, Math.max(ch.idx[k] / ch.fs, state.t0));
      const xb = tToX(L, Math.min(k + 1 < ch.idx.length ? ch.idx[k + 1] / ch.fs : ch.n / ch.fs, state.t1));
      k === k0 ? ctx.moveTo(xa, y(ch.val[k])) : ctx.lineTo(xa, y(ch.val[k]));
      ctx.lineTo(xb, y(ch.val[k]));
    }
  } else {
    const i0 = clampIdx(ch, Math.floor(state.t0 * ch.fs)), i1 = clampIdx(ch, Math.ceil(state.t1 * ch.fs));
    const spp = (i1 - i0) / (L.x1 - L.x0);
    if (spp > 2) { // min/max decimation per pixel column
      for (let px = 0; px <= L.x1 - L.x0; px++) {
        const a = i0 + Math.floor(px * spp), b = Math.min(i1, i0 + Math.floor((px + 1) * spp));
        let lo = Infinity, hi = -Infinity;
        for (let i = a; i <= b; i++) { const v = ch.data[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
        ctx.moveTo(L.x0 + px, y(lo)); ctx.lineTo(L.x0 + px, y(hi));
      }
    } else {
      for (let i = i0; i <= i1; i++) { const px = tToX(L, i / ch.fs); i === i0 ? ctx.moveTo(px, y(ch.data[i])) : ctx.lineTo(px, y(ch.data[i])); }
    }
  }
  ctx.stroke(); ctx.restore();
}

function draw() {
  if (!state.rec) return;
  const dpr = window.devicePixelRatio || 1;
  cv.width = cv.clientWidth * dpr; cv.height = cv.clientHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const L = layout();
  ctx.clearRect(0, 0, L.w, L.h); ctx.font = "11px system-ui"; ctx.textBaseline = "middle"; ctx.lineWidth = 1;

  // time grid
  ctx.strokeStyle = "#eee"; ctx.fillStyle = "#777"; ctx.textAlign = "center";
  const ts = niceStep(state.t1 - state.t0, 10);
  for (let t = Math.ceil(state.t0 / ts) * ts; t <= state.t1; t += ts) {
    const x = tToX(L, t); ctx.beginPath(); ctx.moveTo(x, L.top); ctx.lineTo(x, L.bottom); ctx.stroke();
    ctx.fillText(+t.toFixed(3) + " s", x, L.h - 8);
  }

  ctx.save(); ctx.beginPath(); ctx.rect(L.x0, 0, L.x1 - L.x0, L.h); ctx.clip();
  state.ann.filter((a) => a.rec === state.rec.name && a.t1 >= state.t0 && a.t0 <= state.t1).forEach((a) => {
    const xa = tToX(L, a.t0), xb = tToX(L, a.t1), hh = hue(a.component);
    ctx.fillStyle = `hsla(${hh},70%,55%,.15)`; ctx.fillRect(xa, L.top, Math.max(xb - xa, 1), L.bottom - L.top);
    ctx.fillStyle = `hsl(${hh},60%,32%)`; ctx.textAlign = "left"; ctx.fillText(`${a.component} #${a.cycle}`, xa + 2, L.bottom - 6);
  });
  if (state.sel) {
    const xa = tToX(L, Math.min(state.sel.a, state.sel.b)), xb = tToX(L, Math.max(state.sel.a, state.sel.b));
    ctx.fillStyle = "rgba(255,170,0,.25)"; ctx.fillRect(xa, L.top, Math.max(xb - xa, 1), L.bottom - L.top);
    ctx.strokeStyle = "#d80"; ctx.beginPath();
    [xa, xb].forEach((x) => { ctx.moveTo(x, L.top); ctx.lineTo(x, L.bottom); }); ctx.stroke();
  }
  state.rec.markers.forEach((m) => {
    if (m.t < state.t0 || m.t > state.t1) return;
    const x = tToX(L, m.t), seg = m.type === "apnd", col = seg ? "#c00" : "#2a2";
    ctx.strokeStyle = col; ctx.setLineDash(seg ? [] : [4, 3]);
    ctx.beginPath(); ctx.moveTo(x, 3); ctx.lineTo(x, L.bottom); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = col; ctx.textAlign = "left"; ctx.fillText(m.text, x + 3, 9);
  });
  if (state.hoverT !== null) {
    const x = tToX(L, state.hoverT); ctx.strokeStyle = "rgba(0,0,0,.3)";
    ctx.beginPath(); ctx.moveTo(x, L.top); ctx.lineTo(x, L.bottom); ctx.stroke();
  }
  ctx.restore();
  state.rec.channels.forEach((ch, i) => drawChannel(L, ch, L.panes[i]));
}

// ---------------- measurement boxes ----------------
const fmt = (v, d) => (Number.isFinite(v) ? v.toFixed(d) : "–");
function buildMeasureBoxes() {
  const chans = state.rec.channels.map((ch, i) =>
    `<div>CH${i + 1} ${ch.name} · P-P <b id="pp${i}">–</b> · Value <b id="val${i}">–</b> ${ch.units}</div>`).join("");
  $("meas").innerHTML = `<div>Delta T <b id="mDT">–</b> ms</div><div>BPM <b id="mBPM">–</b></div>${chans}<div>Cursor <b id="mCur">–</b></div>`;
}
function updateMeasures() {
  const m = state.sel ? measure(state.sel) : null;
  $("mDT").textContent = m ? fmt(m.dtMs, 0) : "–";
  $("mBPM").textContent = m ? fmt(m.bpm, 1) : "–";
  state.rec.channels.forEach((ch, i) => {
    $(`pp${i}`).textContent = m ? fmt(m.pp[ch.name], 4) : "–";
    $(`val${i}`).textContent = m ? fmt(m.val[ch.name], 3) : "–";
  });
  $("mCur").textContent = state.hoverT === null ? "–" : `${state.hoverT.toFixed(3)} s`;
}

// ---------------- view control ----------------
function setView(t0, t1) {
  const D = state.rec.duration, w = Math.min(Math.max(t1 - t0, 0.05), D);
  state.t0 = Math.min(Math.max(t0, 0), D - w); state.t1 = state.t0 + w; draw();
}
function setWindow(w) {
  if (w === "all") return setView(0, state.rec.duration);
  const c = (state.t0 + state.t1) / 2; setView(c - w / 2, c + w / 2);
}

cv.addEventListener("mousedown", (e) => {
  const t = xToT(layout(), e.offsetX);
  state.dragging = true; state.sel = { a: t, b: t }; draw(); updateMeasures();
});
window.addEventListener("mousemove", (e) => {
  const rect = cv.getBoundingClientRect(), t = xToT(layout(), e.clientX - rect.left);
  const inside = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
  if (state.dragging) state.sel = { a: state.sel.a, b: t };
  state.hoverT = inside ? t : null;
  if (state.dragging || inside) { draw(); updateMeasures(); }
});
window.addEventListener("mouseup", () => {
  if (!state.dragging) return;
  state.dragging = false;
  $("cond").value = conditionAt(Math.min(state.sel.a, state.sel.b)); suggestCycle();
  draw(); updateMeasures();
});
cv.addEventListener("wheel", (e) => {
  e.preventDefault();
  const L = layout(), span = state.t1 - state.t0;
  if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
    const d = ((e.shiftKey ? e.deltaY : e.deltaX) / (L.x1 - L.x0)) * span; setView(state.t0 + d, state.t1 + d);
  } else {
    const t = xToT(L, e.offsetX), k = Math.exp(e.deltaY * 0.002); setView(t - (t - state.t0) * k, t + (state.t1 - t) * k);
  }
}, { passive: false });
window.addEventListener("keydown", (e) => {
  if (["INPUT", "SELECT"].includes(e.target.tagName) && e.key !== "Enter") return;
  const span = state.t1 - state.t0;
  if (e.key === "ArrowRight") setView(state.t0 + span * 0.25, state.t1 + span * 0.25);
  else if (e.key === "ArrowLeft") setView(state.t0 - span * 0.25, state.t1 - span * 0.25);
  else if (e.key === "Enter") { e.preventDefault(); saveSelection(); }
  else if (e.key === "Escape") { state.sel = null; draw(); updateMeasures(); }
});
window.addEventListener("resize", draw);

// ---------------- annotations ----------------
function suggestCycle() {
  const cond = $("cond").value, comp = $("comp").value;
  const used = state.ann.filter((a) => a.rec === state.rec.name && a.condition === cond && a.component === comp).map((a) => a.cycle);
  $("cyc").value = String(CYCLES.find((c) => !used.includes(c)) || 3);
}
function saveSelection() {
  if (!state.sel) return;
  const m = measure(state.sel), comp = $("comp").value, cond = $("cond").value, cycle = +$("cyc").value;
  const entry = { id: Date.now(), rec: state.rec.name, condition: cond, component: comp, cycle,
                  t0: Math.min(state.sel.a, state.sel.b), t1: Math.max(state.sel.a, state.sel.b), ...m };
  state.ann = [...state.ann.filter((a) => !(a.rec === entry.rec && a.condition === cond && a.component === comp && a.cycle === cycle)), entry];
  persist(STORE_KEY, state.ann);
  state.sel = null; renderTables(); draw(); updateMeasures(); suggestCycle();
}
function renderTables() {
  const order = (a) => state.lesson.conditions.indexOf(a.condition);
  const rows = state.ann.filter((a) => a.rec === state.rec.name)
    .sort((a, b) => order(a) - order(b) || a.component.localeCompare(b.component) || a.cycle - b.cycle);
  $("nAnn").textContent = rows.length;
  $("annTbl").innerHTML = "<tr><th>Condition</th><th>Component</th><th>#</th><th>t (s)</th><th>ΔT ms</th><th>BPM</th><th>P-P</th><th>Value</th><th></th></tr>" +
    rows.map((a) => {
      const ch = channelFor(component(a.component));
      return `<tr data-id="${a.id}"><td>${a.condition}</td><td>${a.component}</td><td>${a.cycle}</td><td>${a.t0.toFixed(3)}</td>` +
        `<td>${fmt(a.dtMs, 0)}</td><td>${fmt(a.bpm, 1)}</td><td>${fmt(a.pp[ch.name], 4)}</td><td>${fmt(a.val[ch.name], 2)}</td>` +
        `<td class="x" data-del="${a.id}" title="Delete">✕</td></tr>`;
    }).join("");
  renderReport();
}
$("annTbl").addEventListener("click", (e) => {
  const del = e.target.dataset.del;
  if (del) { state.ann = state.ann.filter((a) => String(a.id) !== del); persist(STORE_KEY, state.ann); renderTables(); draw(); return; }
  const tr = e.target.closest("tr[data-id]"); if (!tr) return;
  const a = state.ann.find((x) => String(x.id) === tr.dataset.id);
  const pad = Math.max(0.4, (a.t1 - a.t0) * 0.6); setView(a.t0 - pad, a.t1 + pad);
});

// ---------------- data report ----------------
function renderParams() {
  const params = state.lesson.params || [];
  $("params").innerHTML = params.map((p) =>
    `<label>${p.label} <input type="number" step="0.1" data-param="${p.id}" value="${api.param(p.id)}" style="width:80px"></label>`).join(" ");
}
$("params").addEventListener("input", (e) => {
  const id = e.target.dataset.param; if (!id) return;
  state.params = { ...state.params, [`${state.rec.name}:${id}`]: e.target.value };
  persist(PARAM_KEY, state.params); renderReport();
});
function renderReport() {
  let tables;
  try { tables = state.lesson.report(api); } catch (err) {
    console.error(err); $("report").textContent = `Report error: ${err.message}`; return;
  }
  $("report").innerHTML = tables.map((t) =>
    `<h3>${t.title}</h3><table><tr>${t.head.map((h) => `<th>${h}</th>`).join("")}</tr>` +
    t.rows.map((row) => `<tr>${row.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("") + "</table>").join("");
}

// ---------------- export ----------------
function download(name, text) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const csvRow = (cells) => cells.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",");
$("csvAnn").onclick = () => {
  const chNames = [...new Set(state.ann.flatMap((a) => Object.keys(a.pp)))];
  const head = ["recording", "condition", "component", "cycle", "t_start_s", "t_end_s", "delta_t_ms", "bpm",
                ...chNames.flatMap((n) => [`pp_${n}`, `value_${n}`])];
  const rows = state.ann.map((a) => [a.rec, a.condition, a.component, a.cycle, a.t0.toFixed(4), a.t1.toFixed(4),
    a.dtMs.toFixed(1), fmt(a.bpm, 2), ...chNames.flatMap((n) => [fmt(a.pp[n], 5), fmt(a.val[n], 4)])]);
  download("annotations.csv", [head, ...rows].map(csvRow).join("\n"));
};
$("csvRep").onclick = () => {
  const lines = state.lesson.report(api).flatMap((t) => [csvRow([t.title]), csvRow(t.head), ...t.rows.map(csvRow), ""]);
  download(`${state.rec.name}-data-report.csv`, lines.join("\n"));
};
$("clear").onclick = () => {
  if (!confirm(`Delete all annotations for ${state.rec.name}?`)) return;
  state.ann = state.ann.filter((a) => a.rec !== state.rec.name); persist(STORE_KEY, state.ann); renderTables(); draw();
};

// ---------------- init ----------------
function selectRecording(name) {
  state.rec = RECS.find((r) => r.name === name); state.lesson = lessonFor(state.rec); state.sel = null;
  $("lessonName").textContent = state.lesson.title;
  $("segs").innerHTML = state.rec.segments.map((s) => `<button data-seg="${s.start}">${s.name}</button>`).join(" ");
  $("cond").innerHTML = state.lesson.conditions.map((c) => `<option>${c}</option>`).join("");
  $("comp").innerHTML = state.lesson.components.map((c) => `<option>${c.name}</option>`).join("");
  buildMeasureBoxes(); renderParams(); showTip(); suggestCycle();
  setView(0, 3.5); renderTables(); updateMeasures();
}
function showTip() { $("tip").textContent = component($("comp").value).tip; }

if (!RECS.length) {
  document.body.innerHTML = "<p style='padding:20px'>No recordings loaded. Build this page with <code>openbsl view FILE...</code> or <code>openbsl demo</code>.</p>";
} else {
  $("rec").innerHTML = RECS.map((r) => `<option>${r.name}</option>`).join("");
  $("rec").onchange = (e) => selectRecording(e.target.value);
  $("comp").onchange = () => { showTip(); suggestCycle(); };
  $("cond").onchange = suggestCycle;
  $("save").onclick = saveSelection;
  $("segs").onclick = (e) => { const s = e.target.dataset.seg; if (s !== undefined) setView(+s, +s + (state.t1 - state.t0)); };
  document.querySelectorAll("[data-win]").forEach((b) => (b.onclick = () => setWindow(b.dataset.win === "all" ? "all" : +b.dataset.win)));
  selectRecording(RECS[0].name);
}
