import json

import numpy as np
import pytest

from otc.protocol import HEADER
from otc.sampling import decode_tracks, find_phase
from otc.tracking import CameraScan, Sample, Track
from otc.validation import ROOT


def packet_track(*, phase=500, lead_in=False, colors=((255, 176, 0), (0, 102, 255))):
    word = json.loads((ROOT / "packages/contracts/generated/otc-codebook.json").read_text())["codewords"][31]
    bits = [int(bit) for bit in word]
    packet = [None, None, *HEADER, *[int(bit) for bit in f"{13:08b}"], *bits,
              *[1-bit for bit in bits], None, None]
    samples = []
    for pts in np.arange(0, phase + 11000, 1000/30):
        slot = int(np.floor((pts-phase)/200))
        if 0 <= slot < 55 and packet[slot] is not None:
            color = colors[packet[slot]]
        elif lead_in:
            color = (90, 120, 210)  # A status bar can remain chromatic through guards.
        else:
            continue
        samples.append(Sample(float(pts), 30, 30, 10, 16, color))
    return Track("phone", samples)


def observations(tracks):
    return decode_tracks(CameraScan(tracks, 100, 100, 400, None, 0),
                         {"participantIds": [31], "runTag": 13}, "camera")


def test_preamble_can_start_after_a_continuously_detected_status_screen():
    track = packet_track(phase=3500, lead_in=True)
    sampled = find_phase(track)
    assert sampled is not None
    assert abs(sampled.phase_ms-3500) < 40
    seen, _, _, _ = observations([track])
    assert [(o["deviceId"], o["status"]) for o in seen] == [(31, "accepted")]


def test_location_uses_the_verified_packet_instead_of_a_long_lead_in():
    track = packet_track(phase=15000, lead_in=True)
    for sample in track.samples:
        if sample.pts_ms < 15000:
            sample.x, sample.y = 70, 70
    seen, details, _, _ = observations([track])
    assert seen[0]["centerPx"] == {"x": 30, "y": 30}
    assert seen[0]["firstPtsMs"] >= 15350
    assert all(point[1:] == [30, 30] for point in details[0]["trajectory"])


@pytest.mark.parametrize("colors", [((255, 0, 0), (0, 255, 0)),
                                    ((0, 102, 255), (255, 176, 0))])
def test_other_colors_and_reversed_pilots_do_not_verify_a_phone(colors):
    assert find_phase(packet_track(colors=colors)) is None


def test_static_lights_and_alternating_clutter_are_not_published_as_device_tracks():
    phone = packet_track()
    static = Track("light", [Sample(s.pts_ms, 60, 60, 12, 12, (255, 176, 0))
                             for s in phone.samples])
    flicker = Track("flicker", [Sample(s.pts_ms, 80, 80, 12, 12,
                                       ((255, 176, 0), (0, 102, 255))[int(s.pts_ms/200) % 2])
                                for s in phone.samples])
    seen, details, _, messages = observations([phone, static, flicker])
    assert [o["trackId"] for o in seen] == ["phone"]
    assert [d["trackId"] for d in details] == ["phone"]
    assert any("2" in message and "without" in message and "preamble" in message
               for message in messages)


def test_preamble_verified_but_interrupted_phone_stays_visible_as_rejected():
    phone = packet_track()
    phone.samples = [s for s in phone.samples if s.pts_ms < 3500]
    seen, _, _, _ = observations([phone])
    assert len(seen) == 1
    assert seen[0]["status"] == "rejected" and seen[0]["deviceId"] is None
