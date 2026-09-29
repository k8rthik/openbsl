"""Synthetic BSL-style recordings with known ground truth.

Used for the public demo (so no one's real ECG is published) and for tests, where the
true beat times are known exactly. Each beat is a sum of Gaussians (P, Q, R, S, T), in
the spirit of McSharry et al. (2003), with the T wave pushed out as RR lengthens.
"""

import numpy as np

from .reader import Channel, Marker, Recording

FS = 1000.0
# (offset from R in s, amplitude mV, width s) — a plausible Lead II beat at ~70 BPM
P_WAVE = (-0.17, 0.12, 0.022)
Q_WAVE = (-0.028, -0.10, 0.008)
R_WAVE = (0.0, 1.00, 0.009)
S_WAVE = (0.030, -0.28, 0.009)
T_WAVE = (0.27, 0.30, 0.045)
NOISE_MV = 0.012
WANDER_MV, WANDER_HZ = 0.05, 0.25


def _beat_times(duration, hr_fn, t0=0.3):
    times, t = [], t0
    while t < duration:
        times.append(t)
        t += 60.0 / hr_fn(t)
    return np.array(times)


def _gauss(t, center, amp, width):
    return amp * np.exp(-0.5 * ((t - center) / width) ** 2)


def ecg_trace(duration, beats, rng):
    t = np.arange(int(duration * FS)) / FS
    y = WANDER_MV * np.sin(2 * np.pi * WANDER_HZ * t) + rng.normal(0, NOISE_MV, t.size)
    rr = np.diff(beats, append=beats[-1] + (beats[-1] - beats[-2] if len(beats) > 1 else 0.85))
    for r, interval in zip(beats, rr):
        qt_scale = np.sqrt(interval / 0.85)  # Bazett-style: T moves with sqrt(RR)
        lo, hi = np.searchsorted(t, [r - 0.35, r + 0.6])
        seg = t[lo:hi]
        for off, amp, width in (P_WAVE, Q_WAVE, R_WAVE, S_WAVE):
            y[lo:hi] += _gauss(seg, r + off, amp, width)
        y[lo:hi] += _gauss(seg, r + T_WAVE[0] * qt_scale, T_WAVE[1], T_WAVE[2] * qt_scale)
    return y


def rate_channel(n, beats):
    """BSL's CH40: steps to 60/RR at each R peak, 0 until two beats have been seen."""
    hr = np.zeros(n)
    for prev, cur in zip(beats[:-1], beats[1:]):
        hr[int(cur * FS):] = 60.0 / (cur - prev)
    return hr


def pulse_trace(n, beats, delay, amp, rng):
    t = np.arange(n) / FS
    y = rng.normal(0, 0.004, n)
    for r in beats:  # fast systolic upstroke + dicrotic bump
        y += _gauss(t, r + delay, amp, 0.07) + _gauss(t, r + delay + 0.3, amp * 0.35, 0.06)
    return y


def heart_sound_trace(n, beats, rng):
    t = np.arange(n) / FS
    y = rng.normal(0, 0.01, n)
    for r in beats:
        for onset, amp, dur, freq in ((0.05, 0.6, 0.10, 45.0), (0.33, 0.4, 0.07, 60.0)):  # S1, S2
            env = _gauss(t, r + onset + dur / 2, amp, dur / 4)
            y += env * np.sin(2 * np.pi * freq * (t - r))
    return y


def _splice(parts):
    """Concatenate (label, duration, beats, extra_markers) parts the way BSL appends segments."""
    offset, beats, markers = 0.0, [], []
    for label, duration, part_beats, extra in parts:
        markers.append(Marker(offset, "apnd", label))
        markers.extend(Marker(offset + m.t, m.type, m.text) for m in extra)
        beats.extend(offset + part_beats)
        offset += duration
    return offset, np.array(beats), tuple(markers)


def _breathing_markers(start, stop, period):
    out, t = [], start
    while t + period <= stop:
        out += [Marker(t, "defl", "start of inhale"), Marker(t + period / 2, "defl", "start of exhale")]
        t += period
    return out


def demo_l05(seed=0):
    rng = np.random.default_rng(seed)
    period = 10.0  # 6 breaths/min; HR rises on inspiration (respiratory sinus arrhythmia)
    parts = [
        ("Supine", 20.0, _beat_times(20.0, lambda t: 64.0), []),
        ("Seated", 20.0, _beat_times(20.0, lambda t: 72.0), []),
        ("Deep breathing", 30.0, _beat_times(30.0, lambda t: 70 + 9 * np.sin(2 * np.pi * t / period)),
         _breathing_markers(0.0, 30.0, period)),
        ("After exercise", 40.0, _beat_times(40.0, lambda t: 88 + 34 * np.exp(-t / 15)), []),
    ]
    duration, beats, markers = _splice(parts)
    ecg = ecg_trace(duration, beats, rng)
    return Recording("Demo-L05", "L05", (Channel("ECG", "mV", FS, ecg),
                                         Channel("Heart Rate", "BPM", FS, rate_channel(ecg.size, beats))), markers)


def demo_l07(seed=1):
    rng = np.random.default_rng(seed)
    specs = [("Seated and relaxed", 15.0, 68.0, 1.0), ("Seated, left hand in water", 30.0, 74.0, 0.55),
             ("Seated, right hand above head", 30.0, 70.0, 0.4)]
    ecgs, pulses, beat_list, markers, offset = [], [], [], [], 0.0
    for label, dur, hr, amp in specs:
        beats = _beat_times(dur, lambda t, hr=hr: hr)
        n = int(dur * FS)
        ecgs.append(ecg_trace(dur, beats, rng))
        pulses.append(pulse_trace(n, beats, 0.24, amp, rng))
        markers.append(Marker(offset, "apnd", label))
        beat_list.extend(offset + beats)
        offset += dur
    return Recording("Demo-L07", "L07", (Channel("ECG", "mV", FS, np.concatenate(ecgs)),
                                         Channel("Pulse", "mV", FS, np.concatenate(pulses))), tuple(markers))


def demo_l17(seed=2):
    rng = np.random.default_rng(seed)
    rest_hr = lambda t: 66 + (8 * np.sin(2 * np.pi * (t - 20) / 10) if 20 <= t < 30 else 0)
    parts = [("Seated, at rest", 32.0, _beat_times(32.0, rest_hr),
              [Marker(20.0, "defl", "Inhale"), Marker(25.0, "defl", "Exhale")]),
             ("After exercise", 20.0, _beat_times(20.0, lambda t: 105.0), [])]
    duration, beats, markers = _splice(parts)
    n = int(duration * FS)
    return Recording("Demo-L17", "L17", (Channel("Stethoscope", "mV", FS, heart_sound_trace(n, beats, rng)),
                                         Channel("ECG", "mV", FS, ecg_trace(duration, beats, rng))), markers)


def demo_recordings():
    return [demo_l05(), demo_l07(), demo_l17()]
