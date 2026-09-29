import json

import numpy as np
import pytest

from openbsl.pack import build_viewer, channel_payload
from openbsl.reader import Channel, Marker, Recording, clean_label, lesson_of, load, segment_bounds


@pytest.mark.parametrize("raw, expected", [
    ("Supine, MP36E0000000000", "Supine"),
    # L07 labels contain commas of their own; only the serial suffix may go
    ("Seated, left hand in water, MP36E0000000000", "Seated, left hand in water"),
    ("start of inhale", "start of inhale"),
    ("  Exhale ", "Exhale"),
])
def test_clean_label_strips_only_the_serial(raw, expected):
    assert clean_label(raw) == expected


@pytest.mark.parametrize("name, expected", [
    ("Keerthik-L05", "L05"), ("Pat-l17.acq", "L17"), ("Sam-L07", "L07"),
    ("notes.acq", None), ("run-L123", None),
])
def test_lesson_of(name, expected):
    assert lesson_of(name) == expected


def test_segment_bounds_ignores_event_markers_and_closes_last_segment():
    markers = (Marker(20.0, "apnd", "Seated"), Marker(0.0, "apnd", "Supine"),
               Marker(25.0, "defl", "start of inhale"))
    segs = segment_bounds(markers, total_s=40.0)
    # unsorted input; the defl marker is not a segment; last segment ends at total_s
    assert [(s.name, s.start, s.end) for s in segs] == [("Supine", 0.0, 20.0), ("Seated", 20.0, 40.0)]


def test_rate_channel_is_stored_as_change_points():
    ch = Channel("Heart Rate", "BPM", 1000.0, np.array([0, 0, 60, 60, 75.0]))
    out = channel_payload(ch)
    assert (out["kind"], out["n"], out["idx"], out["val"]) == ("step", 5, [0, 2, 4], [0.0, 60.0, 75.0])


def test_wave_channel_keeps_every_sample_rounded():
    out = channel_payload(Channel("ECG", "mV", 1000.0, np.array([0.1234567, -0.5])))
    assert (out["kind"], out["data"]) == ("wave", [0.12346, -0.5])


def test_build_viewer_writes_loadable_payload(tmp_path):
    rec = Recording("X-L05", "L05", (Channel("ECG", "mV", 100.0, np.zeros(300)),),
                    (Marker(0.0, "apnd", "Supine"),))
    index = build_viewer([rec], tmp_path)
    assert index.name == "index.html" and (tmp_path / "app.js").exists() and (tmp_path / "lessons.js").exists()
    js = (tmp_path / "data.js").read_text()
    payload = json.loads(js.removeprefix("window.RECORDINGS = ").rstrip().rstrip(";"))
    assert payload[0]["duration"] == 3.0
    assert payload[0]["segments"] == [{"name": "Supine", "start": 0.0, "end": 3.0}]


def test_build_viewer_rejects_empty(tmp_path):
    with pytest.raises(ValueError):
        build_viewer([], tmp_path)


def test_load_reports_missing_and_garbage_files(tmp_path):
    with pytest.raises(ValueError, match="not found"):
        load(tmp_path / "nope-L05")
    junk = tmp_path / "junk-L05"
    junk.write_bytes(b"definitely not biopac")
    with pytest.raises(ValueError, match="not a readable Biopac file"):
        load(junk)
