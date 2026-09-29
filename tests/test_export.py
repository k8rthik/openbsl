import numpy as np
import pandas as pd
import pytest

from openbsl.export import beats_frame, detect_r_peaks, export, segments_frame
from openbsl.reader import Segment
from openbsl.synthetic import FS, demo_l05, demo_l07, ecg_trace, rate_channel

TOLERANCE_S = 0.005  # R-peak timing error allowed against ground truth


def _true_beats(bpm, duration):
    return np.arange(0.4, duration - 0.6, 60.0 / bpm)


@pytest.mark.parametrize("bpm", [48, 75, 140])
def test_detects_every_synthetic_beat(bpm):
    truth = _true_beats(bpm, 30.0)
    ecg = ecg_trace(30.0, truth, np.random.default_rng(0))
    found = detect_r_peaks(ecg, FS) / FS
    assert len(found) == len(truth)
    assert np.max(np.abs(found - truth)) < TOLERANCE_S


def test_detects_inverted_lead():
    truth = _true_beats(70, 20.0)
    found = detect_r_peaks(-ecg_trace(20.0, truth, np.random.default_rng(1)), FS) / FS
    assert len(found) == len(truth)


def test_too_short_signal_is_rejected():
    with pytest.raises(ValueError):
        detect_r_peaks(np.zeros(1000), FS)


def test_segment_summary_drops_the_beat_spanning_each_splice():
    # Segment A: beats 0,1,2 -> RRs (nan),1,1 -> after dropping first: HR 60, 60
    # Segment B: beats 10.5,11,11.5 -> first RR (8.5 s) crosses the splice and is dropped;
    #            remaining RRs 0.5,0.5 -> HR 120
    segs = (Segment("A", 0.0, 10.0), Segment("B", 10.0, 20.0))
    beats = beats_frame(np.array([0, 1000, 2000, 10500, 11000, 11500]), 1000.0, segs)
    summary = segments_frame(beats, segs).set_index("segment")
    assert summary.loc["A", "n_beats"] == 2 and summary.loc["A", "mean_hr_bpm"] == pytest.approx(60.0)
    assert summary.loc["B", "n_beats"] == 2 and summary.loc["B", "mean_hr_bpm"] == pytest.approx(120.0)


def test_rate_channel_matches_bsl_ch40_semantics():
    # beats at 1.0, 2.0, 2.5 s: 0 until the 2nd beat, then 60/1.0 = 60, then 60/0.5 = 120
    hr = rate_channel(3000, np.array([1.0, 2.0, 2.5]))
    assert hr[1999] == 0 and hr[2000] == 60 and hr[2499] == 60 and hr[2500] == 120


def test_demo_l05_segment_rates_are_recovered(tmp_path):
    summary = export(demo_l05(), tmp_path).set_index("segment")
    # constant-rate segments were generated at 64 and 72 BPM
    assert summary.loc["Supine", "mean_hr_bpm"] == pytest.approx(64.0, abs=0.5)
    assert summary.loc["Seated", "mean_hr_bpm"] == pytest.approx(72.0, abs=0.5)
    # exercise recovery starts at 88 + 34 = 122 BPM and decays toward 88
    assert summary.loc["After exercise", "max_hr_bpm"] > 110
    for name in ("signals.csv", "markers.csv", "beats.csv", "segments.csv"):
        assert (tmp_path / "Demo-L05" / name).exists()
    markers = pd.read_csv(tmp_path / "Demo-L05" / "markers.csv")
    assert (markers["text"] == "start of inhale").sum() == 3


def test_export_without_ecg_writes_only_raw_csvs(tmp_path):
    rec = demo_l07()
    no_ecg = type(rec)(rec.name, rec.lesson, rec.channels[1:], rec.markers)
    assert export(no_ecg, tmp_path) is None
    assert sorted(p.name for p in (tmp_path / rec.name).iterdir()) == ["markers.csv", "signals.csv"]
