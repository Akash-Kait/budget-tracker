#!/usr/bin/env python3
"""Unit tests for the NSE quote sidecar's CONTROL FLOW + exit-code contract (no nselib/pandas needed).
Run: python3 scripts/test_nse_quote.py

The sidecar's exit codes are the Python half of must-break (c): a TOTAL failure must exit non-zero so
the TS provider throws and the route fails SAFE (keeps last prices), while a per-symbol miss must be a
silent omission (→ null quote → NOT_FOUND). nselib is stubbed via sys.modules so these run anywhere."""
import io
import json
import os
import sys
import types

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import nse_quote  # noqa: E402


class FakeFrame:
    """Stands in for the pandas frame nselib returns. The astype/where/notna chain is a no-op here
    (real NaN→None sanitization is exercised by the live-verify against real pandas); to_dict just
    returns the canned records, so these tests cover the sidecar's control flow + json.dumps guard."""

    def __init__(self, records):
        self._records = records

    def astype(self, _kind):
        return self

    def notna(self):
        return self

    def where(self, *_a, **_k):
        return self

    def to_dict(self, _orient):
        return self._records


class FakeStdin:
    def __init__(self, data: bytes):
        self.buffer = io.BytesIO(data)


def run(stdin_text, price_fn=None, nselib_present=True):
    """Drive nse_quote.main() with a stubbed nselib + captured stdio. Returns (exit_code, parsed_json)."""
    saved_stdin, saved_stdout = sys.stdin, sys.stdout
    saved_mod = sys.modules.get("nselib")
    saved_cap = sys.modules.get("nselib.capital_market")
    try:
        if nselib_present:
            cap = types.ModuleType("nselib.capital_market")
            cap.price_volume_data = price_fn or (lambda **_k: FakeFrame([]))
            nl = types.ModuleType("nselib")
            nl.capital_market = cap
            sys.modules["nselib"] = nl
            sys.modules["nselib.capital_market"] = cap
        else:
            # A None entry forces `from nselib import capital_market` to raise ImportError even if the
            # real package happens to be installed in this environment.
            sys.modules["nselib"] = None
            sys.modules.pop("nselib.capital_market", None)

        sys.stdin = FakeStdin(stdin_text.encode("utf-8"))
        sys.stdout = io.StringIO()
        code = 0
        try:
            nse_quote.main()
        except SystemExit as e:
            code = e.code if isinstance(e.code, int) else 0
        captured = sys.stdout.getvalue()
    finally:
        sys.stdin, sys.stdout = saved_stdin, saved_stdout
        if saved_mod is not None:
            sys.modules["nselib"] = saved_mod
        else:
            sys.modules.pop("nselib", None)
        if saved_cap is not None:
            sys.modules["nselib.capital_market"] = saved_cap
        else:
            sys.modules.pop("nselib.capital_market", None)
    return code, json.loads(captured) if captured.strip() else None


def test_bad_stdin_json_exits_3():
    code, out = run("{")  # malformed JSON
    assert code == 3 and out == {"error": "bad_input"}, (code, out)


def test_non_list_input_exits_3():
    code, out = run("5")  # valid JSON, but not a list
    assert code == 3 and out == {"error": "bad_input"}, (code, out)


def test_nselib_missing_exits_4():
    code, out = run('["SBIN"]', nselib_present=False)
    assert code == 4 and out == {"error": "nselib_missing"}, (code, out)


def test_empty_input_list_is_ok_not_fetch_error():
    # [] means "nothing to fetch" — must NOT trip the all-failed guard (that's only for a non-empty ask).
    code, out = run("[]")
    assert code == 0 and out == {}, (code, out)


def test_partial_success_omits_failed_symbol_exits_0():
    rows = [{"Date": "11-Jun-2026", "ClosePrice": "800.00"}]

    def pf(**k):
        if k["symbol"] == "SBIN":
            return FakeFrame(rows)
        raise RuntimeError("NSE blocked this one")  # ITC fails

    code, out = run('["SBIN", "ITC"]', price_fn=pf)
    assert code == 0, (code, out)
    assert out == {"SBIN": rows}, out  # ITC omitted, SBIN present — a per-symbol miss is silent


def test_all_symbols_fail_exits_3_fetch_error():
    def pf(**_k):
        raise RuntimeError("NSE unreachable")

    code, out = run('["SBIN", "ITC"]', price_fn=pf)
    assert code == 3 and out == {"error": "fetch_error"}, (code, out)


def test_empty_frame_is_a_miss_not_a_crash():
    code, out = run('["SBIN"]', price_fn=lambda **_k: FakeFrame([]))
    # SBIN returned no rows → omitted → out empty → with a non-empty ask, that's a loud fetch_error.
    assert code == 3 and out == {"error": "fetch_error"}, (code, out)


def test_nan_value_is_caught_by_serialize_guard_not_emitted_as_invalid_json():
    # Safety net: if a NaN slips past sanitization, allow_nan=False makes json.dumps raise → we exit 3
    # with serialize_error, NEVER print a bare `NaN` token that Node's JSON.parse would reject.
    rows = [{"Date": "11-Jun-2026", "ClosePrice": float("nan")}]
    code, out = run('["SBIN"]', price_fn=lambda **_k: FakeFrame(rows))
    assert code == 3 and out == {"error": "serialize_error"}, (code, out)


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for t in tests:
        t()
        print(f"ok - {t.__name__}")
    print(f"\n{len(tests)} passed")
