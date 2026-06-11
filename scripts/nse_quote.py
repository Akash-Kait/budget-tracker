#!/usr/bin/env python3
"""NSE end-of-day quote sidecar — STOCKS. Invoked by lib/market/nse.ts via a Node subprocess.

A THIN bridge: reads a JSON list of NSE symbols on STDIN, calls nselib's EOD price/volume path per
symbol (period='1M' — sidesteps any from/to date-window bug), and emits the raw frame rows as JSON
records on STDOUT:  { "SYMBOL": [ {row}, … ], … }  (a symbol that errors or returns nothing is OMITTED,
surfaced as a per-symbol miss to the caller). ALL price/date interpretation — ClosePrice (never
PrevClose), the max-Date latest row, and the date parse — lives in lib/market/nse.ts so it's unit-
tested without the network; this script does NOT pick a price.

No PII (stock symbols only). Stderr swallowed by the caller. Exit codes: 0 ok · 4 nselib missing ·
3 fetch error (every symbol failed / NSE unreachable).
"""
import json
import sys


def fail(code: int, error: str) -> None:
    print(json.dumps({"error": error}))
    sys.exit(code)


def main() -> None:
    raw = sys.stdin.buffer.read().decode("utf-8", "replace").strip()
    try:
        symbols = json.loads(raw) if raw else []
    except json.JSONDecodeError:
        fail(3, "bad_input")
    if not isinstance(symbols, list):
        fail(3, "bad_input")

    try:
        from nselib import capital_market  # noqa: F401 — presence check
    except ImportError:
        fail(4, "nselib_missing")

    out = {}
    for symbol in symbols:
        sym = str(symbol).strip()
        if not sym:
            continue
        try:
            frame = capital_market.price_volume_data(symbol=sym, period="1M")
            # NaN/NaT → None so the payload is valid JSON. Pandas frames carry NaN for missing cells;
            # json.dumps would otherwise emit a bare `NaN` token (invalid JSON → Node's JSON.parse
            # rejects it → the whole batch fails). The object-cast keeps ints/strings intact.
            frame = frame.astype(object).where(frame.notna(), None)
            records = frame.to_dict("records")  # raw rows; nse.ts picks ClosePrice @ max(Date)
            if records:
                out[sym] = records
        except Exception:  # noqa: BLE001 — per-symbol failure is a miss, not a crash; keep going
            continue

    # Every symbol failed (and we asked for at least one) → NSE unreachable/blocked → loud fetch error
    # so the provider throws and the route fails safe (keeps last prices), rather than a silent empty.
    if symbols and not out:
        fail(3, "fetch_error")

    try:
        # allow_nan=False: any residual non-finite is a LOUD failure, never an invalid-JSON token.
        # default=str: stringify dtypes json can't serialize natively (numpy ints, pandas Timestamp);
        # nse.ts coerces strings back (toNumber / parseNseDate), so this stays a thin, honest bridge.
        payload = json.dumps(out, allow_nan=False, default=str)
    except (ValueError, TypeError):
        fail(3, "serialize_error")

    print(payload)
    sys.exit(0)


if __name__ == "__main__":
    main()
