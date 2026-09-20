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


def observations(tracks, *, zero="#FFB000"):
    return decode_tracks(CameraScan(tracks, 100, 100, 400, None, 0),
                         {"participantIds": [31], "runTag": 13,
                          "palette": {"zero": zero, "one": "#0066FF", "neutral": "#111111"}}, "camera")


@pytest.mark.parametrize("red,blue", [((255, 0, 0), (0, 102, 255)),
                                      ((150, 12, 10), (0, 65, 160)),
                                      ((255, 190, 185), (20, 130, 240))])
def test_red_blue_manifest_decodes_pure_dim_and_washed_recorded_pilots(red, blue):
    track = packet_track(colors=(red, blue), phase=3500, lead_in=True)
    seen, _, _, _ = observations([track], zero="#FF0000")
    assert [(o["deviceId"], o["status"]) for o in seen] == [(31, "accepted")]
    assert seen[0]["correctedBits"] == seen[0]["erasedBits"] == 0


@pytest.mark.parametrize("colors", [((255, 255, 255), (0, 102, 255)),
                                    ((0, 255, 0), (0, 102, 255)),
                                    ((0, 102, 255), (255, 0, 0))])
def test_red_blue_does_not_promote_white_green_or_reversed_pilots(colors):
    assert observations([packet_track(colors=colors)], zero="#FF0000")[0] == []


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


def test_valid_identity_survives_size_changes_and_unverified_in_screen_fragments():
    phone = packet_track()
    phone.reasons = {"abrupt screen size change", "ambiguous screen association or merge"}
    phone.collisions = [(4500, "exposure-band", False)]
    seen, _, _, _ = observations([phone])
    assert (seen[0]["deviceId"], seen[0]["status"]) == (31, "accepted")
    assert "abrupt screen size change" in seen[0]["reasons"]


def test_independent_screen_collision_rejects_even_an_otherwise_valid_identity():
    phone = packet_track()
    phone.collisions = [(4500, "other-screen", True)]
    seen, _, _, _ = observations([phone])
    assert seen[0]["status"] == "ambiguous"
    assert "independent screen tracks collided during packet" in seen[0]["reasons"]
    phone.collisions = [(12000, "other-screen", True)]
    assert observations([phone])[0][0]["status"] == "accepted"  # After packet, no taint.


def test_a_verified_competing_packet_blocks_even_nested_footprints():
    phone, other = packet_track(), packet_track()
    other.track_id = "nested-phone"
    phone.collisions = [(4500, other.track_id, False)]
    seen, _, _, _ = observations([phone, other])
    assert seen[0]["status"] == "ambiguous"
