// Report tables per lesson, checked against hand-computed values.
// Run: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import "../src/openbsl/viewer/lessons.js";

const { LESSONS, lessonFor } = globalThis;

// api over a literal table: store[condition][component][cycle] = {dt, bpm, pp, val}
function apiFrom(store, params = {}) {
  return {
    get: (c, comp, n, m) => store[c]?.[comp]?.[n]?.[m] ?? NaN,
    param: (id) => params[id] ?? "",
  };
}
const table = (tables, prefix) => tables.find((t) => t.title.startsWith(prefix));
const row = (t, label) => t.rows.find((r) => r[0] === label);
const matchOf = (lesson, text) => (lesson.match.find(([re]) => re.test(text)) || [])[1];

test("L05 Table 5.2 averages only the cycles that exist", () => {
  // Supine CH40 values 60, 62, (missing) -> mean (60 + 62) / 2 = 61.0
  const api = apiFrom({ Supine: { "Heart rate": { 1: { val: 60 }, 2: { val: 62 } } } });
  assert.deepEqual(row(table(LESSONS.L05.report(api), "Table 5.2"), "Supine"), ["Supine", "60.0", "62.0", "", "61.0"]);
});

test("L05 heart rate falls back to BPM when CH40 reads 0 (first cycles of a segment)", () => {
  const api = apiFrom({ Seated: { "Heart rate": { 1: { val: 0, bpm: 75 } } } });
  assert.equal(row(table(LESSONS.L05.report(api), "Table 5.2"), "Seated")[1], "75.0");
});

test("L05 Table 5.4 reports amplitude for waves only", () => {
  const api = apiFrom({ Supine: { "P wave": { 1: { dt: 90, pp: 0.1 } }, "P-R interval": { 1: { dt: 150, pp: 9 } } } });
  const t = table(LESSONS.L05.report(api), "Table 5.4");
  assert.equal(row(t, "P wave")[7], "0.100");  // A1
  assert.equal(row(t, "P-R interval")[3], "150"); // D1
  assert.equal(row(t, "P-R interval")[7], "");    // intervals have no amplitude
});

test("L07 pulse speed = total distance / R-to-pulse delay", () => {
  // 40 + 60 = 100 cm over 250 ms -> 400.0 cm/s
  const api = apiFrom({ "Arm relaxed": { "R-wave to pulse peak": { 1: { dt: 250 } } } },
                      { sternumShoulder: "40", shoulderFinger: "60" });
  const t = table(LESSONS.L07.report(api), "C. Pulse speed");
  assert.deepEqual(row(t, "Arm relaxed"), ["Arm relaxed", "0.250", "400.0"]);
  assert.deepEqual(row(t, "Arm up"), ["Arm up", "", ""]);
});

test("L07 conditions come from the BSL segment labels", () => {
  assert.equal(matchOf(LESSONS.L07, "Seated and relaxed"), "Arm relaxed");
  assert.equal(matchOf(LESSONS.L07, "Seated, left hand in water"), "Temp. change");
  assert.equal(matchOf(LESSONS.L07, "Seated, right hand above head"), "Arm up");
});

test("L17 Table 17.2 uses a ±5% no-change band", () => {
  // rest 100: 105 is exactly +5% -> no change; 106 -> increased; 94 -> decreased
  const mk = (ex) => apiFrom({ "At rest": { "R-R interval": { 1: { bpm: 100 } } },
                               "After exercise": { "R-R interval": { 1: { bpm: ex } } } });
  const change = (ex) => row(table(LESSONS.L17.report(mk(ex)), "Table 17.2"), "R-wave to next R-wave (BPM)")[1];
  assert.equal(change(105), "No change (±5%)");
  assert.equal(change(106), "Increased");
  assert.equal(change(94), "Decreased");
});

test("L17 exhale is not mistaken for inhale", () => {
  assert.equal(matchOf(LESSONS.L17, "Exhale"), "Exhalation");
  assert.equal(matchOf(LESSONS.L17, "Inhale"), "Inhalation");
  assert.equal(matchOf(LESSONS.L05, "start of exhale"), "Start of exhale");
});

test("unknown lessons fall back to one condition per segment", () => {
  const g = lessonFor({ lesson: "L99", segments: [{ name: "Rest" }, { name: "Rest" }, { name: "Stim (1)" }] });
  assert.deepEqual(g.conditions, ["Rest", "Stim (1)"]);
  assert.equal(matchOf(g, "Stim (1)"), "Stim (1)"); // regex metacharacters are escaped
});
