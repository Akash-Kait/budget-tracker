#!/usr/bin/env python3
"""Unit tests for the pure casparser-dict → app-JSON mapping (map_cas).

Runnable with zero dependencies (no pytest needed):  python3 scripts/test_cas_parse.py
Exercises the parse-trust edge cases that the JS fixture can't reach: cost-key variations,
exited/zero-balance schemes, NAV derivation, non-AMFI schemes, and date normalization.
"""
import datetime
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cas_parse import map_cas  # noqa: E402


def folio(no, *schemes):
    return {"folio": no, "schemes": list(schemes)}


def scheme(**kw):
    base = {"scheme": "Some Fund", "amfi": "100001", "isin": "INF1", "close": 10,
            "valuation": {"date": "2025-05-30", "nav": 50.0, "value": 500.0}}
    base.update(kw)
    return base


def test_basic_mapping():
    out = map_cas({"statement_period": {"to": "2025-05-31"},
                   "folios": [folio("F1", scheme())]})
    assert out["statementDate"] == "2025-05-31"
    assert len(out["schemes"]) == 1
    s = out["schemes"][0]
    assert s["amfi"] == "100001" and s["folio"] == "F1" and s["units"] == 10 and s["nav"] == 50.0


def test_skips_exited_and_zero_and_null_units():
    out = map_cas({"folios": [folio("F1",
        scheme(close=0),       # exited / fully redeemed
        scheme(close=None),    # no balance
        scheme(close=12))]})   # live
    assert len(out["schemes"]) == 1 and out["schemes"][0]["units"] == 12


def test_derives_nav_from_value_when_missing():
    out = map_cas({"folios": [folio("F1",
        scheme(close=4, valuation={"date": "2025-05-30", "nav": None, "value": 200.0}))]})
    assert out["schemes"][0]["nav"] == 50.0  # 200 / 4


def test_cost_from_valuation_then_scheme():
    a = map_cas({"folios": [folio("F1", scheme(valuation={"date": "2025-05-30", "nav": 50.0, "value": 500.0, "cost": 400.0}))]})
    assert a["schemes"][0]["cost"] == 400.0
    b = map_cas({"folios": [folio("F1", scheme(cost=350.0))]})  # cost at scheme level
    assert b["schemes"][0]["cost"] == 350.0
    c = map_cas({"folios": [folio("F1", scheme())]})  # no cost anywhere
    assert c["schemes"][0]["cost"] is None


def test_non_amfi_scheme_keeps_isin():
    out = map_cas({"folios": [folio("F1", scheme(amfi=None, isin="INF999"))]})
    assert out["schemes"][0]["amfi"] is None and out["schemes"][0]["isin"] == "INF999"


def test_coerces_string_numbers_and_iso_dates():
    out = map_cas({"statement_period": {"to": datetime.date(2025, 5, 31)},
                   "folios": [folio("F1", scheme(close="10", valuation={"date": datetime.date(2025, 5, 30), "nav": "50.0", "value": "500.0"}))]})
    assert out["statementDate"] == "2025-05-31"
    s = out["schemes"][0]
    assert s["units"] == 10.0 and s["nav"] == 50.0 and s["navDate"] == "2025-05-30"


def test_empty_and_missing_folios():
    assert map_cas({})["schemes"] == []
    assert map_cas({"folios": None})["schemes"] == []


def test_accepts_casparser_object_not_just_dict():
    # casparser 0.7+ returns a CASData object (pydantic) — map_cas must coerce via model_dump,
    # not assume a dict. Simulate that object shape.
    class FakeCasData:
        def __init__(self, payload):
            self._payload = payload

        def model_dump(self):
            return self._payload

    payload = {"statement_period": {"to": "2025-05-31"}, "folios": [folio("F1", scheme())]}
    out = map_cas(FakeCasData(payload))
    assert out["statementDate"] == "2025-05-31"
    assert len(out["schemes"]) == 1 and out["schemes"][0]["amfi"] == "100001"


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for t in tests:
        t()
        print(f"ok - {t.__name__}")
    print(f"\n{len(tests)} passed")
