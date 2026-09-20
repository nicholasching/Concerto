import importlib.util
import json

import pytest

from otc.validation import ROOT


@pytest.fixture(scope="session")
def capture(tmp_path_factory):
    spec = importlib.util.spec_from_file_location("optical_fixture_generator",
                                               ROOT / "tools/otc-fixtures/generate.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    cached = {}

    def create(case="clean", count=12, fps=30, *, width=640, height=360, red_blue=False):
        key = (case, count, fps, width, height, red_blue)
        if key not in cached:
            path = tmp_path_factory.mktemp(f"{case}-{count}-{fps}-{width}x{height}")
            manifest_path = None
            if red_blue:
                template = json.loads((ROOT / "fixtures/otc/clean-30/manifest.json").read_text())
                template["palette"] = {"zero": "#FF0000", "one": "#0066FF", "neutral": "#111111"}
                template["paletteVersion"] = "red-blue-v1"
                template["participantIds"] = list(range(count))
                manifest_path = path / "red-blue-input.json"
                manifest_path.write_text(json.dumps(template))
            manifest, truth = module.generate_capture(path, case=case, count=count, fps=fps,
                                                      width=width, height=height,
                                                      manifest_path=manifest_path)
            cached[key] = (path, manifest, truth)
        return cached[key]

    return create
