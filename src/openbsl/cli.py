"""openbsl command line.

    openbsl view  FILE...        pack recordings into a viewer folder and open it
    openbsl export FILE...       write CSVs (signals, markers, beats, per-segment HR)
    openbsl demo                 build the viewer with synthetic recordings
"""

import argparse
import sys
import webbrowser
from pathlib import Path

from .reader import load

DEFAULT_VIEWER_DIR = "openbsl-viewer"
DEFAULT_EXPORT_DIR = "exports"


def _load_all(paths):
    recordings = []
    for path in paths:
        try:
            recordings.append(load(path))
        except ValueError as exc:
            print(f"error: {exc}", file=sys.stderr)
    return recordings


def _open(index, no_open):
    print(f"viewer: {index}")
    if not no_open:
        webbrowser.open(index.resolve().as_uri())


def cmd_view(args):
    from .pack import build_viewer

    recordings = _load_all(args.files)
    if not recordings:
        return 1
    for rec in recordings:
        chans = ", ".join(f"{c.name} ({c.units}, {c.fs:g} Hz)" for c in rec.channels)
        print(f"packed {rec.name} [{rec.lesson or 'unknown lesson'}]: {chans}")
    _open(build_viewer(recordings, args.out), args.no_open)
    return 0


def cmd_demo(args):
    from .pack import build_viewer
    from .synthetic import demo_recordings

    _open(build_viewer(demo_recordings(), args.out), args.no_open)
    return 0


def cmd_export(args):
    from .export import export

    recordings = _load_all(args.files)
    for rec in recordings:
        summary = export(rec, args.out)
        print(f"\n== {rec.name} -> {Path(args.out) / rec.name}")
        print("(no ECG channel; wrote signals and markers only)" if summary is None
              else summary.round(3).to_string(index=False))
    return 0 if recordings else 1


def main(argv=None):
    parser = argparse.ArgumentParser(prog="openbsl", description="Open Biopac Student Lab recordings without BSL.")
    sub = parser.add_subparsers(dest="cmd", required=True)

    view = sub.add_parser("view", help="open recordings in the annotation viewer")
    view.add_argument("files", nargs="+", type=Path)
    view.add_argument("-o", "--out", type=Path, default=Path(DEFAULT_VIEWER_DIR))
    view.add_argument("--no-open", action="store_true", help="build without launching a browser")
    view.set_defaults(func=cmd_view)

    demo = sub.add_parser("demo", help="open the viewer with synthetic L05/L07/L17 recordings")
    demo.add_argument("-o", "--out", type=Path, default=Path(DEFAULT_VIEWER_DIR))
    demo.add_argument("--no-open", action="store_true")
    demo.set_defaults(func=cmd_demo)

    exp = sub.add_parser("export", help="export recordings to CSV")
    exp.add_argument("files", nargs="+", type=Path)
    exp.add_argument("-o", "--out", type=Path, default=Path(DEFAULT_EXPORT_DIR))
    exp.set_defaults(func=cmd_export)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
