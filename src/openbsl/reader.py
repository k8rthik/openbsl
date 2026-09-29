"""Load Biopac Student Lab / AcqKnowledge files into a small, library-neutral model.

Everything downstream (CSV export, the viewer payload, the synthetic demo) works on
`Recording`, so it never touches bioread objects directly.
"""

import re
from dataclasses import dataclass
from pathlib import Path

import numpy as np

SEGMENT_MARKER = "apnd"  # BSL writes the start of each recording segment as an "append" marker
RATE_MARKER_PREFIX = "New Rate"  # BSL's per-beat heart-rate markers; noise for our purposes
LESSON_RE = re.compile(r"L(\d{2})(?!\d)", re.IGNORECASE)


@dataclass(frozen=True)
class Channel:
    name: str
    units: str
    fs: float
    data: np.ndarray

    @property
    def duration(self):
        return len(self.data) / self.fs


@dataclass(frozen=True)
class Marker:
    t: float
    type: str
    text: str


@dataclass(frozen=True)
class Segment:
    name: str
    start: float
    end: float


@dataclass(frozen=True)
class Recording:
    name: str
    lesson: str | None
    channels: tuple[Channel, ...]
    markers: tuple[Marker, ...]

    @property
    def duration(self):
        return max(ch.duration for ch in self.channels)

    @property
    def segments(self):
        return segment_bounds(self.markers, self.duration)

    def channel(self, pattern):
        """First channel whose name matches `pattern` (case-insensitive regex), or None."""
        rx = re.compile(pattern, re.IGNORECASE)
        return next((ch for ch in self.channels if rx.search(ch.name)), None)


SERIAL_SUFFIX_RE = re.compile(r",\s*MP\d+\w*\s*$")


def clean_label(text):
    """'Seated, left hand in water, MP36E0000000000' -> 'Seated, left hand in water'.

    BSL appends the hardware serial to segment labels; only that suffix is removed,
    since the labels themselves can contain commas.
    """
    return SERIAL_SUFFIX_RE.sub("", text).strip()


def lesson_of(name):
    match = LESSON_RE.search(name)
    return f"L{match.group(1)}" if match else None


def segment_bounds(markers, total_s):
    starts = sorted((m for m in markers if m.type == SEGMENT_MARKER), key=lambda m: m.t)
    ends = [m.t for m in starts[1:]] + [total_s]
    return tuple(Segment(m.text, m.t, end) for m, end in zip(starts, ends))


def load(path):
    """Read a BSL/AcqKnowledge file. Raises ValueError with a readable message on failure."""
    import bioread  # deferred so tests and the synthetic demo don't need it

    path = Path(path)
    if not path.is_file():
        raise ValueError(f"{path}: file not found")
    try:
        datafile = bioread.read_file(str(path))
    except Exception as exc:  # bioread raises a variety of low-level errors
        raise ValueError(f"{path}: not a readable Biopac file ({exc})") from exc

    channels = tuple(
        Channel(ch.name, ch.units, float(ch.samples_per_second), np.asarray(ch.data, dtype=float))
        for ch in datafile.channels
    )
    fs = float(datafile.samples_per_second)
    markers = tuple(
        Marker(m.sample_index / fs, m.type_code, clean_label(m.text))
        for m in datafile.event_markers
        if not m.text.startswith(RATE_MARKER_PREFIX)
    )
    return Recording(path.name, lesson_of(path.name), channels, markers)
