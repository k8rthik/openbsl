// Per-lesson configuration: conditions, what to label, and how the Data Report tables are filled.
//
// Component fields:
//   ch   regex picking the channel whose P-P / Value matters (for amplitude components)
//   tip  how to place the I-beam selection (from the BSL Analysis Procedure)
// Report tables are built from api.get(condition, component, cycle, metric)
//   metric: "dt" (ms), "bpm", "pp" (P-P on component.ch), "val" (Value at selection end on component.ch)
(function () {
  const ECG = /ecg/i;
  const HR = /heart rate|bpm/i;
  const PULSE = /pulse|pleth/i;
  const STETH = /steth|sound|mic/i;
  const CYCLES = [1, 2, 3];

  const f = (v, d) => (Number.isFinite(v) ? v.toFixed(d) : "");
  const mean = (xs) => {
    const v = xs.filter(Number.isFinite);
    return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN;
  };
  const cyclesRow = (label, vals, d) => [label, ...vals.map((v) => f(v, d)), f(mean(vals), d)];

  // ---------------- Lesson 5: ECG I ----------------
  const L05_NORMS = {
    "P wave": [".07 - .18", "< .20"], "QRS complex": [".06 - .12", ".10 - 1.5"], "T wave": [".10 - .25", "< .5"],
    "P-R interval": [".12 - .20", ""], "Q-T interval": [".32 - .36", ""], "R-R interval": [".80", ""],
    "P-R segment": [".02 - .10", ""], "S-T segment": ["< .20", ""], "T-P segment": ["0 - .40", ""],
  };
  const L05_WAVES = ["P wave", "QRS complex", "T wave"];
  const L05 = {
    title: "L05 ECG I",
    conditions: ["Supine", "Seated", "Start of inhale", "Start of exhale", "After exercise"],
    match: [[/exhale/i, "Start of exhale"], [/inhale|deep breath/i, "Start of inhale"],
            [/exercise/i, "After exercise"], [/seated/i, "Seated"], [/supine/i, "Supine"]],
    components: [
      { name: "Heart rate", ch: HR, tip: "Click/select inside an R-R interval; CH40 Value is read where the drag ends. Skip the first 2 cycles." },
      { name: "Ventricular systole", tip: "R peak → 1/3 of the way down the descending T wave." },
      { name: "Ventricular diastole", tip: "1/3 down the descending T wave → next R peak." },
      { name: "P wave", ch: ECG, tip: "Baseline to baseline around the P wave." },
      { name: "QRS complex", ch: ECG, tip: "Start of Q → end of S." },
      { name: "T wave", ch: ECG, tip: "Baseline to baseline around the T wave." },
      { name: "P-R interval", tip: "Start of P → start of QRS." },
      { name: "Q-T interval", tip: "Start of QRS → end of T." },
      { name: "R-R interval", tip: "R peak → next R peak." },
      { name: "P-R segment", tip: "End of P → start of QRS." },
      { name: "S-T segment", tip: "End of S → start of T." },
      { name: "T-P segment", tip: "End of T → start of next P." },
    ],
    report(api) {
      const hr = (c, n) => { const v = api.get(c, "Heart rate", n, "val"); return v > 0 ? v : api.get(c, "Heart rate", n, "bpm"); };
      const sd = (c, comp) => mean(CYCLES.map((n) => api.get(c, comp, n, "dt")));
      const comps = Object.keys(L05_NORMS);
      return [
        { title: "Table 5.2 Heart rate (BPM)", head: ["Condition", "1", "2", "3", "Mean"],
          rows: this.conditions.map((c) => cyclesRow(c, CYCLES.map((n) => hr(c, n)), 1)) },
        { title: "Table 5.3 Ventricular systole / diastole (ms, mean of labelled cycles)", head: ["Condition", "Systole", "Diastole"],
          rows: ["Supine", "After exercise"].map((c) => [c, f(sd(c, "Ventricular systole"), 0), f(sd(c, "Ventricular diastole"), 0)]) },
        { title: "Table 5.4 Supine, 3 cycles (duration ms | amplitude mV)",
          head: ["Component", "Norm s", "Norm mV", "D1", "D2", "D3", "D mean", "A1", "A2", "A3", "A mean"],
          rows: comps.map((comp) => {
            const d = CYCLES.map((n) => api.get("Supine", comp, n, "dt"));
            const a = CYCLES.map((n) => (L05_WAVES.includes(comp) ? api.get("Supine", comp, n, "pp") : NaN));
            return [comp, ...L05_NORMS[comp], ...d.map((x) => f(x, 0)), f(mean(d), 0), ...a.map((x) => f(x, 3)), f(mean(a), 3)];
          }) },
        { title: "Table 5.5 After exercise, cycle 1", head: ["Component", "Norm s", "Norm mV", "Duration ms", "Amplitude mV"],
          rows: comps.map((comp) => [comp, ...L05_NORMS[comp], f(api.get("After exercise", comp, 1, "dt"), 0),
                                     L05_WAVES.includes(comp) ? f(api.get("After exercise", comp, 1, "pp"), 3) : ""]) },
      ];
    },
  };

  // ---------------- Lesson 7: ECG & Pulse ----------------
  const L07 = {
    title: "L07 ECG & Pulse",
    conditions: ["Arm relaxed", "Temp. change", "Arm up"],
    match: [[/above|arm up|raised/i, "Arm up"], [/water|temp|cold|warm|hot/i, "Temp. change"],
            [/relax|rest|seated/i, "Arm relaxed"]],
    params: [
      { id: "sternumShoulder", label: "Sternum → shoulder (cm)" },
      { id: "shoulderFinger", label: "Shoulder → fingertip (cm)" },
    ],
    components: [
      { name: "R-R interval", tip: "ECG: R peak → next R peak (gives Delta T and Heart Rate BPM)." },
      { name: "Pulse interval", tip: "Pulse: peak → next pulse peak (gives Delta T and Pulse Rate BPM)." },
      { name: "QRS amplitude", ch: ECG, tip: "Select across one QRS complex; uses ECG P-P. Use cycles right after the marker." },
      { name: "Pulse amplitude", ch: PULSE, tip: "Select across one pulse peak (trough → peak); uses Pulse P-P." },
      { name: "R-wave to pulse peak", tip: "ECG R peak → the next pulse peak." },
    ],
    report(api) {
      const rows = this.conditions.flatMap((c) => [
        cyclesRow(`${c} · R-R interval ΔT (ms)`, CYCLES.map((n) => api.get(c, "R-R interval", n, "dt")), 0),
        cyclesRow(`${c} · Heart rate (BPM)`, CYCLES.map((n) => api.get(c, "R-R interval", n, "bpm")), 1),
        cyclesRow(`${c} · Pulse interval ΔT (ms)`, CYCLES.map((n) => api.get(c, "Pulse interval", n, "dt")), 0),
        cyclesRow(`${c} · Pulse rate (BPM)`, CYCLES.map((n) => api.get(c, "Pulse interval", n, "bpm")), 1),
      ]);
      const amp = (c, comp) => mean(CYCLES.map((n) => api.get(c, comp, n, "pp")));
      const dist = (+api.param("sternumShoulder") || 0) + (+api.param("shoulderFinger") || 0);
      const delay = (c) => mean(CYCLES.map((n) => api.get(c, "R-wave to pulse peak", n, "dt"))) / 1000;
      return [
        { title: "Table 7.1 ECG vs pulse (3 cycles)", head: ["Condition · Measurement", "1", "2", "3", "Mean"], rows },
        { title: "Table 7.2 Relative volume changes (mV, mean of labelled cycles)", head: ["Measurement", ...this.conditions],
          rows: [["QRS amplitude (CH1 P-P)", ...this.conditions.map((c) => f(amp(c, "QRS amplitude"), 3))],
                 ["Pulse amplitude (CH40 P-P)", ...this.conditions.map((c) => f(amp(c, "Pulse amplitude"), 3))]] },
        { title: `C. Pulse speed (total distance ${dist || "?"} cm)`, head: ["Condition", "R-wave → pulse peak (s)", "Speed (cm/s)"],
          rows: ["Arm relaxed", "Arm up"].map((c) => [c, f(delay(c), 3), dist ? f(dist / delay(c), 1) : ""]) },
      ];
    },
  };

  // ---------------- Lesson 17: Heart Sounds ----------------
  const L17_ROWS = [
    ["R-wave to next R-wave (BPM)", "R-R interval", "bpm", 1],
    ["R-wave to 1st sound (ms)", "R-wave to 1st sound", "dt", 0],
    ["R-wave to 2nd sound (ms)", "R-wave to 2nd sound", "dt", 0],
    ["1st to 2nd sound (ms)", "1st to 2nd sound", "dt", 0],
    ["2nd sound to next 1st sound (ms)", "2nd to next 1st sound", "dt", 0],
    ["1st heart sound (P-P)", "1st heart sound", "pp", 4],
    ["2nd heart sound (P-P)", "2nd heart sound", "pp", 4],
  ];
  const L17 = {
    title: "L17 Heart Sounds",
    conditions: ["At rest", "Inhalation", "Exhalation", "After exercise"],
    match: [[/exhal/i, "Exhalation"], [/inhal/i, "Inhalation"], [/exercise/i, "After exercise"], [/rest|seated/i, "At rest"]],
    components: [
      { name: "R-R interval", tip: "ECG: R peak → next R peak (BPM)." },
      { name: "R-wave to 1st sound", tip: "R peak → START of the 1st heart sound (stethoscope)." },
      { name: "R-wave to 2nd sound", tip: "R peak → START of the 2nd heart sound." },
      { name: "1st to 2nd sound", tip: "Start of 1st sound → start of 2nd sound." },
      { name: "2nd to next 1st sound", tip: "Start of 2nd sound → start of the next cycle's 1st sound (stethoscope only)." },
      { name: "1st heart sound", ch: STETH, tip: "Select across the whole 1st sound; uses Stethoscope P-P." },
      { name: "2nd heart sound", ch: STETH, tip: "Select across the whole 2nd sound; uses Stethoscope P-P." },
    ],
    report(api) {
      const val = (c, comp, metric) => mean(CYCLES.map((n) => api.get(c, comp, n, metric)));
      const t171 = { title: "Table 17.1 Heart sounds (mean of labelled cycles)", head: ["Measurement", ...this.conditions],
        rows: L17_ROWS.map(([label, comp, metric, d]) => [label, ...this.conditions.map((c) => f(val(c, comp, metric), d))]) };
      const dir = (rest, ex) => (!Number.isFinite(rest) || !Number.isFinite(ex) ? "" : ex > rest * 1.05 ? "Increased" : ex < rest * 0.95 ? "Decreased" : "No change (±5%)");
      const t172 = { title: "Table 17.2 After exercise vs at rest", head: ["Measured value", "Change"],
        rows: L17_ROWS.map(([label, comp, metric]) => [label, dir(val("At rest", comp, metric), val("After exercise", comp, metric))]) };
      return [t171, t172];
    },
  };

  // ---------------- Fallback for any other lesson ----------------
  function generic(rec) {
    const conditions = rec.segments.map((s) => s.name).filter((v, i, a) => a.indexOf(v) === i);
    return {
      title: "Generic",
      conditions: conditions.length ? conditions : ["Recording"],
      match: conditions.map((c) => [new RegExp(c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), c]),
      components: [{ name: "Selection", tip: "Any selection; all measurements are exported." }],
      report(api) {
        return [{ title: "Selections (mean of labelled cycles)", head: ["Condition", "ΔT ms", "BPM"],
          rows: this.conditions.map((c) => [c, f(mean(CYCLES.map((n) => api.get(c, "Selection", n, "dt"))), 0),
                                              f(mean(CYCLES.map((n) => api.get(c, "Selection", n, "bpm"))), 1)]) }];
      },
    };
  }

  const LESSONS = { L05, L07, L17 };
  globalThis.lessonFor = (rec) => LESSONS[rec.lesson] || generic(rec);
  globalThis.LESSONS = LESSONS;
})();
