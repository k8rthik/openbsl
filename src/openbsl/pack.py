"""Serialize recordings into the viewer's data.js payload."""

import json
import shutil
from importlib import resources
from pathlib import Path

import numpy as np

WAVE_DECIMALS = 5  # BSL's ~15 uV resolution survives 5 decimals of mV
RATE_UNITS = {"bpm"}  # calculation channels that only change once per cycle


def channel_payload(ch):
    base = {"name": ch.name, "units": ch.units, "fs": ch.fs}
    if ch.units.strip().lower() in RATE_UNITS:
        # Rate channels are step functions; storing only the change points keeps data.js small
        change = np.flatnonzero(np.diff(ch.data) != 0) + 1
        idx = np.concatenate(([0], change)).astype(int)
        return {**base, "kind": "step", "n": len(ch.data), "idx": idx.tolist(),
                "val": np.round(ch.data[idx], 3).tolist()}
    return {**base, "kind": "wave", "data": np.round(ch.data, WAVE_DECIMALS).tolist()}


def recording_payload(rec):
    return {
        "name": rec.name,
        "lesson": rec.lesson,
        "duration": rec.duration,
        "channels": [channel_payload(ch) for ch in rec.channels],
        "markers": [{"t": m.t, "type": m.type, "text": m.text} for m in rec.markers],
        "segments": [{"name": s.name, "start": s.start, "end": s.end} for s in rec.segments],
    }


def data_js(recordings):
    payload = [recording_payload(r) for r in recordings]
    return "window.RECORDINGS = " + json.dumps(payload, separators=(",", ":")) + ";\n"


def build_viewer(recordings, out_dir):
    """Copy the bundled viewer into `out_dir` and write its data.js. Returns index.html's path."""
    if not recordings:
        raise ValueError("no recordings to pack")
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    viewer = resources.files("openbsl") / "viewer"
    for name in ("index.html", "app.js", "lessons.js"):
        with resources.as_file(viewer / name) as src:
            shutil.copyfile(src, out_dir / name)
    (out_dir / "data.js").write_text(data_js(recordings))
    return out_dir / "index.html"
