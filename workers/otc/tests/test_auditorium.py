import importlib.util

import cv2
import numpy as np

from otc.validation import ROOT


def fixture_module():
    spec = importlib.util.spec_from_file_location(
        "auditorium_fixture", ROOT / "tools/otc-fixtures/auditorium.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_swept_bowl_has_1500_seats_curved_rows_rising_tiers_and_two_aisles():
    module = fixture_module()
    phones, rows = module.seating()
    assert len(phones) == len({p["deviceId"] for p in phones}) == 1500
    assert {0, 1024, 2047} <= {p["deviceId"] for p in phones}
    assert len(rows) == 30 and sum(row["seats"] for row in rows) == 1500
    assert rows[-1]["seats"] > 3 * rows[0]["seats"]
    assert all(a["floorHeightM"] < b["floorHeightM"] for a, b in zip(rows, rows[1:]))
    for row in rows:
        seats = [p for p in phones if p["row"] == row["row"]]
        assert {p["column"] for p in seats} == {"left", "center", "right"}
        positions = np.array([p["worldMeters"] for p in seats])
        assert np.allclose(np.linalg.norm(positions[:, [0, 2]], axis=1), row["radiusM"])
        # Seats on the same curved row do not have a constant stage distance z.
        assert np.ptp(positions[:, 2]) > 1
        gaps = np.diff([p["thetaRadians"] for p in seats])*row["radiusM"]
        assert np.count_nonzero(gaps > 1) == 2
        assert np.allclose(gaps[gaps < 1], module.SEAT_PITCH_M)
        assert np.allclose(gaps[gaps > 1], module.SEAT_PITCH_M+module.AISLE_EXTRA_M)


def test_overview_keeps_every_phone_visible_with_depth_scaled_footprints():
    module = fixture_module()
    phones, rows = module.seating()
    background, rendered, _ = module.prepare_view(phones, rows, "overview", 3840, 2160)
    assert background.shape == (2160, 3840, 3)
    assert len(rendered) == 1500
    assert all(p["cameraScreens"][0]["visible"] for p in phones)
    # A label raster detects complete screen occlusion, not merely frustum coverage.
    labels = np.zeros(background.shape[:2], dtype=np.int32)
    for device_id, polygon in reversed(rendered):
        cv2.fillConvexPoly(labels, polygon, device_id+1)
    assert set(np.unique(labels)) - {0} == {p["deviceId"]+1 for p in phones}
    sizes = [(p["row"], p["cameraScreens"][0]["widthPx"] *
              p["cameraScreens"][0]["heightPx"]) for p in phones]
    assert np.median([area for row, area in sizes if row == 0]) > 5 * np.median(
        [area for row, area in sizes if row == 29])
