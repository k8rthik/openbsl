"""Plain-CSV export and beat-to-beat heart rate from the raw ECG."""

from pathlib import Path

import numpy as np
import pandas as pd
from scipy.signal import butter, filtfilt, find_peaks

ECG_PATTERN = r"ecg"
QRS_BAND_HZ = (5.0, 30.0)  # where QRS energy lives; rejects baseline wander and T waves
MIN_RR_S = 0.30  # refractory period, caps detection at 200 BPM
PEAK_HEIGHT_FRAC = 0.35  # threshold as a fraction of the 99th-percentile filtered amplitude


def signals_frame(rec):
    """All channels on the time base of the first one (BSL channels share a rate in practice)."""
    fs = rec.channels[0].fs
    n = min(len(ch.data) for ch in rec.channels)
    columns = {"time_s": np.arange(n) / fs}
    columns.update({f"{ch.name} ({ch.units})": ch.data[:n] for ch in rec.channels})
    return pd.DataFrame(columns)


def markers_frame(rec):
    return pd.DataFrame([{"time_s": m.t, "type": m.type, "text": m.text} for m in rec.markers],
                        columns=["time_s", "type", "text"])


def detect_r_peaks(ecg, fs):
    """R-peak sample indices. Polarity-agnostic so an inverted lead still works."""
    if len(ecg) < 3 * fs:
        raise ValueError("need at least 3 s of ECG to detect beats")
    b, a = butter(2, [f / (fs / 2) for f in QRS_BAND_HZ], btype="band")
    filtered = filtfilt(b, a, ecg)
    if np.percentile(-filtered, 99) > np.percentile(filtered, 99):
        filtered = -filtered
    height = PEAK_HEIGHT_FRAC * np.percentile(filtered, 99)
    peaks, _ = find_peaks(filtered, height=height, distance=int(MIN_RR_S * fs))
    return peaks


def beats_frame(peaks, fs, segments):
    times = peaks / fs
    rr = np.diff(times, prepend=np.nan)
    labels = [next((s.name for s in segments if s.start <= t < s.end), "") for t in times]
    return pd.DataFrame({"time_s": times, "segment": labels, "rr_s": rr, "hr_bpm": 60.0 / rr})


def segments_frame(beats, segments):
    rows = []
    for s in segments:
        # Drop each segment's first beat: BSL splices segments, so its RR spans the pause
        rr = beats[(beats["time_s"] >= s.start) & (beats["time_s"] < s.end)].iloc[1:]["rr_s"].dropna()
        hr = 60.0 / rr
        rows.append({"segment": s.name, "start_s": s.start, "end_s": s.end, "n_beats": len(rr),
                     "mean_rr_s": rr.mean(), "sd_rr_s": rr.std(),
                     "mean_hr_bpm": hr.mean(), "min_hr_bpm": hr.min(), "max_hr_bpm": hr.max()})
    return pd.DataFrame(rows)


def export(rec, out_dir):
    """Write CSVs for one recording. Returns the per-segment summary (None if there's no ECG)."""
    out = Path(out_dir) / rec.name
    out.mkdir(parents=True, exist_ok=True)
    signals_frame(rec).to_csv(out / "signals.csv", index=False)
    markers_frame(rec).to_csv(out / "markers.csv", index=False)

    ecg = rec.channel(ECG_PATTERN)
    if ecg is None:
        return None
    beats = beats_frame(detect_r_peaks(ecg.data, ecg.fs), ecg.fs, rec.segments)
    summary = segments_frame(beats, rec.segments)
    beats.to_csv(out / "beats.csv", index=False)
    summary.to_csv(out / "segments.csv", index=False)
    return summary
