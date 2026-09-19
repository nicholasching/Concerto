from fractions import Fraction
from pathlib import Path
from types import SimpleNamespace

import av
import numpy as np
import pytest

from otc.video import read_frames


def fake_container(monkeypatch, timestamps):
    class Container:
        streams = SimpleNamespace(video=[SimpleNamespace(codec_context=SimpleNamespace())])

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def decode(self, stream):
            for pts in timestamps:
                frame = av.VideoFrame.from_ndarray(np.zeros((8, 16, 3), np.uint8), format="rgb24")
                frame.pts, frame.time_base = pts, Fraction(1, 1000)
                yield frame

    monkeypatch.setattr(av, "open", lambda path: Container())


def test_reader_normalizes_pts_and_applies_clockwise_rotation(monkeypatch):
    fake_container(monkeypatch, [-100, -55, -20, 30])
    frames = list(read_frames(Path("unused.mp4"), 90))
    assert [pts for pts, _ in frames] == [0, 45, 80, 130]
    assert all(image.shape == (16, 8, 3) for _, image in frames)


@pytest.mark.parametrize("timestamps,error", [
    ([None], "lacks a presentation timestamp"),
    ([0, 0], "strictly increase"),
    ([100, 50], "strictly increase"),
    ([], "No usable"),
    ([0, 60001], "at most 60 seconds"),
])
def test_invalid_timing_fails_without_using_nominal_fps(monkeypatch, timestamps, error):
    fake_container(monkeypatch, timestamps)
    with pytest.raises(ValueError, match=error):
        list(read_frames(Path("unused.mp4")))
