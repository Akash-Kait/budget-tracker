#!/usr/bin/env python3
"""Unit tests for the eCAS parser's pure classification + normalization (no pdfplumber needed).
Run: python3 scripts/test_ecas_parse.py

The ISIN gate is where a green suite most easily hides a bug, so check digits are computed here
INDEPENDENTLY of the implementation (so a broken impl can't make its own tests pass)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ecas_parse import (  # noqa: E402
    classify_isin, isin_checksum_ok, build_parsed, _iso_statement_date,
    find_statement_date, find_equity_total, parse_holding_row,
)


def test_iso_statement_date():
    assert _iso_statement_date("01-Aug-2018") == "2018-08-01T00:00:00.000Z"
    assert _iso_statement_date("09-jun-2026") == "2026-06-09T00:00:00.000Z"
    assert _iso_statement_date("30-04-2026") == "2026-04-30T00:00:00.000Z"  # DD-MM-YYYY (eCAS header)
    assert _iso_statement_date(None) is None
    assert _iso_statement_date("31-Foo-2018") is None
    assert _iso_statement_date("30-13-2026") is None  # month out of range


def test_find_statement_date_prefers_as_on_over_stray_date():
    # Real case: a stray allotment date (01-Aug-2018) inside a security name, plus the holding
    # statement header "AS ON 30-04-2026". Must resolve to the AS-ON date, not the stray one.
    text = (
        "SOME COMPANY LTD AFTER SUB-DIVISION 01-Aug-2018 5 100.00 500.00\n"
        "HOLDING STATEMENT AS ON 30-04-2026\n"
        "Portfolio Value Rs 3,06,961.51 as on 30-04-2026"
    )
    assert find_statement_date(text) == "30-04-2026"
    assert _iso_statement_date(find_statement_date(text)) == "2026-04-30T00:00:00.000Z"
    # no anchored date → None (route then rejects, never guesses a stray)
    assert find_statement_date("ALLOTTED 01-Aug-2018 ... no statement label here") is None


def test_find_equity_total():
    assert find_equity_total("Equity ₹1,26,421.50\nMutual Funds ₹50,000.00") == 126421.50
    # must NOT match a holding name "... EQUITY SHARES ... 1342.15"
    assert find_equity_total("ADANI ENERGY SOLUTIONS LIMITED # EQUITY SHARES 5 1342.15 6710.75") is None


def test_name_whitespace_collapsed():
    rows = [{"boId": "", "isin": INE, "name": "ADANI ENERGY SOLUTIONS\nLIMITED # EQUITY SHARES",
             "units": "5", "price": "1342.15", "value": "6710.75"}]
    h = build_parsed(rows, "01-Aug-2018")["accounts"][0]["holdings"][0]
    assert h["name"] == "ADANI ENERGY SOLUTIONS LIMITED # EQUITY SHARES"  # newline collapsed


def mk_isin(body11: str) -> str:
    """Append the correct mod-10 ISIN check digit to an 11-char body → a valid 12-char ISIN.
    Independent re-implementation (not the module's)."""
    digits = "".join(str(ord(c) - 55) if c.isalpha() else c for c in body11)
    s = 0
    for i, ch in enumerate(reversed(digits)):  # body chars land at final indices 1.. → double even i
        d = int(ch)
        if i % 2 == 0:
            d *= 2
            if d > 9:
                d -= 9
        s += d
    return body11 + str((10 - (s % 10)) % 10)


INE = mk_isin("INE002A0101")  # valid equity
INF = mk_isin("INF179K0160")  # valid mutual fund
GOVT = mk_isin("IN0020230AB")  # valid ISIN, char[2]='0' → not equity/MF


def test_checksum_validates_real_shape():
    assert isin_checksum_ok(INE) and isin_checksum_ok(INF) and isin_checksum_ok(GOVT)
    # wrong check digit → invalid
    bad = INE[:-1] + str((int(INE[-1]) + 1) % 10)
    assert not isin_checksum_ok(bad)
    # last char not a digit → invalid shape
    assert not isin_checksum_ok("INE00000000A")


def test_classify_three_way():
    assert classify_isin(INE) == "equity"
    assert classify_isin(INF) == "mf"
    # valid ISIN but neither equity nor MF → unrecognized (not imported, but surfaced)
    assert classify_isin(GOVT) == "unrecognized"
    # anchor-matching but NOT a plausible ISIN → unrecognized (bad checksum / bad shape)
    assert classify_isin("INE00000000A") == "unrecognized"
    bad_csum = INE[:-1] + str((int(INE[-1]) + 1) % 10)
    assert classify_isin(bad_csum) == "unrecognized"


def test_build_parsed_groups_equity_skips_mf_surfaces_unrecognized():
    rows = [
        {"boId": "BO-A", "isin": INE, "name": "Acme Ltd", "units": "10", "price": "100.5", "value": "1005"},
        {"boId": "BO-A", "isin": INF, "name": "Some MF", "units": "5", "price": "20", "value": "100"},  # skipped
        {"boId": "BO-A", "isin": GOVT, "name": "Govt Bond", "units": "1", "price": "99", "value": "99"},  # unrecognized
        {"boId": "BO-B", "isin": "INE00000000A", "name": "Junk", "units": "1", "price": "1", "value": "1"},  # unrecognized
    ]
    out = build_parsed(rows, "09-Jun-2026")
    assert out["statementDate"] == "2026-06-09T00:00:00.000Z"  # DD-Mon-YYYY → full ISO for Prisma
    # only the one equity row, under BO-A; numbers coerced
    assert [a["boId"] for a in out["accounts"]] == ["BO-A"]
    holds = out["accounts"][0]["holdings"]
    assert len(holds) == 1 and holds[0]["isin"] == INE
    assert holds[0]["units"] == 10.0 and holds[0]["price"] == 100.5 and holds[0]["value"] == 1005.0
    # both non-equity, non-MF rows surfaced (never silently dropped); MF NOT in unrecognized
    surfaced = {u["isin"] for u in out["unrecognized"]}
    assert surfaced == {GOVT, "INE00000000A"}
    assert INF not in surfaced


def test_build_parsed_multi_bo_and_nil_holding():
    rows = [
        {"boId": "BO-A", "isin": INE, "name": "Acme", "units": "10", "price": "100", "value": "1000"},
        {"boId": "BO-B", "isin": INE, "name": "Acme", "units": "7", "price": "100", "value": "700"},  # same ISIN, other account
    ]
    out = build_parsed(rows, "09-Jun-2026")
    bos = {a["boId"] for a in out["accounts"]}
    assert bos == {"BO-A", "BO-B"}  # kept per-account, not merged
    # a BO with only an MF row → no equity → account omitted (its absence is a reconcile concern)
    out2 = build_parsed([{"boId": "BO-C", "isin": INF, "name": "MF", "units": "1", "price": "1", "value": "1"}], None)
    assert out2["accounts"] == []


def test_parse_holding_row_full_and_collapsed():
    # Full 9-column row: ISIN, Security, CurrentBal, Frozen, Pledge, PledgeSetup, FreeBal, Price, Value
    full = parse_holding_row([INE, "Acme Ltd", "100", "0", "0", "0", "100", "250.50", "25050.00"])
    assert full == {"isin": INE, "name": "Acme Ltd", "units": "100", "price": "250.50", "value": "25050.00"}
    # Collapsed row (blank columns merged away) — the case that silently dropped BAJAJ AUTO:
    collapsed = parse_holding_row([INE, "BAJAJ AUTO LIMITED", "5", "1342.15", "6710.75"])
    assert collapsed == {"isin": INE, "name": "BAJAJ AUTO LIMITED", "units": "5", "price": "1342.15", "value": "6710.75"}
    # Non-ISIN first cell / too few cells → not a holding row
    assert parse_holding_row(["Security Name", "blah"]) is None
    assert parse_holding_row(["TOTAL", "", "126421.50"]) is None


def test_collapses_pending_and_holding_rows_to_the_real_holding():
    # The exact two-rows-per-holding shape from a real eCAS: a pending/settlement row (0 units, 0
    # value, "PAYOUT-CR…SETT" text) plus the actual holding row. Must keep the holding, not the zero.
    pending = parse_holding_row(
        ["INE917I01010", "BAJAJ AUTO LIMITED -\nEQUITY SHARES",
         "PAYOUT-CR CM\nM70015 TM/CP\n90187 SETT\n1211232026079", "30-04-2026",
         "0.000", "5.000", "--", "5.000", "0"]
    )
    holding = parse_holding_row(
        ["INE917I01010", "BAJAJ AUTO LIMITED - EQUITY\nSHARES", "5.000", "--", "--", "--",
         "5.000", "9997.750", "49,988.75"]
    )
    for r in (pending, holding):
        r["boId"] = "12088800"
    out = build_parsed([pending, holding], "30-04-2026", 49988.75)
    holds = out["accounts"][0]["holdings"]
    assert len(holds) == 1  # collapsed to one
    assert holds[0]["units"] == 5.0 and holds[0]["price"] == 9997.75 and holds[0]["value"] == 49988.75
    # …and order-independent: holding row first, pending second → same result
    out2 = build_parsed([holding, pending], "30-04-2026", None)
    assert out2["accounts"][0]["holdings"][0]["value"] == 49988.75


def test_build_parsed_carries_equity_stated_total():
    out = build_parsed(
        [{"boId": "BO-A", "isin": INE, "name": "Acme", "units": "10", "price": "100", "value": "1000"}],
        "30-04-2026",
        126421.50,
    )
    assert out["statementDate"] == "2026-04-30T00:00:00.000Z"
    assert out["equityStatedTotal"] == 126421.50


def test_num_coercion_and_blanks():
    rows = [{"boId": "", "isin": INE, "name": "Acme", "units": "1,234.5", "price": "-", "value": "N.A."}]
    h = build_parsed(rows, None)["accounts"][0]["holdings"][0]
    assert h["units"] == 1234.5 and h["price"] is None and h["value"] is None


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for t in tests:
        t()
        print(f"ok - {t.__name__}")
    print(f"\n{len(tests)} passed")
