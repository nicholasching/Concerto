import importlib.util

import pytest

from otc.validation import ROOT


@pytest.fixture(scope="session")
def capture(tmp_path_factory):
    spec = importlib.util.spec_from_file_location("optical_fixture_generator",
                                               ROOT / "tools/otc-fixtures/generate.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    cached = {}

    def create(case="clean", count=12, fps=30, *, width=640, height=360):
        key = (case, count, fps, width, height)
        if key not in cached:
            path = tmp_path_factory.mktemp(f"{case}-{count}-{fps}-{width}x{height}")
            manifest, truth = module.generate_capture(path, case=case, count=count, fps=fps,
                                                      width=width, height=height)
            cached[key] = (path, manifest, truth)
        return cached[key]

    return create
