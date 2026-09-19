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

    def create(case="clean", count=12, fps=30):
        key = (case, count, fps)
        if key not in cached:
            path = tmp_path_factory.mktemp(f"{case}-{count}-{fps}")
            manifest, truth = module.generate_capture(path, case=case, count=count, fps=fps)
            cached[key] = (path, manifest, truth)
        return cached[key]

    return create
