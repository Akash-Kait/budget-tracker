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
    _clean_isin, parse_mf_row, build_mf_parsed, find_mf_statement_date,
    is_folio_table, is_demat_holding_table, collect_mf_rows, find_demat_mf_total,
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


# ---------------------------------------------------------------------------------------------------
# MF folio section (mode="mf"). The MF ISINs below are real (from the live statement); the named
# must-break is the soft-hyphen-wrapped ISIN — a miss yields a bogus ISIN that fails the AMFI lookup,
# which on a MIGRATION becomes a false unmatched-blocking row against a perfectly healthy fund.
# ---------------------------------------------------------------------------------------------------

def test_clean_isin_strips_soft_hyphen_wrap():
    # Mirae Asset row from the real dump: ISIN wrapped with a SOFT HYPHEN (U+00AD) + newline mid-string.
    assert _clean_isin("INF769K01D\xad\nM9") == "INF769K01DM9"
    assert _clean_isin(" inf760k01el8 ") == "INF760K01EL8"  # trim + uppercase
    assert _clean_isin("INF769K01D​M9") == "INF769K01DM9"  # zero-width space stripped too


def test_parse_mf_row_full_nine_columns():
    row = [
        "Canara Robeco ELSS\nTax Saver Reg Growth",
        "INF760K01EL8", "17744270415/0", "1,394.197", "194.97",
        "2,20,000.00", "2,71,826.59", "51,826.59", "23.56",
    ]
    h = parse_mf_row(row)
    assert h["isin"] == "INF760K01EL8"
    assert h["name"] == "Canara Robeco ELSS Tax Saver Reg Growth"  # cell-wrap newline collapsed
    assert h["folio"] == "17744270415/0"  # stays a string (has a '/')
    assert h["units"] == 1394.197
    assert h["nav"] == 194.97
    assert h["amountInvested"] == 220000.0  # col 5 → cost basis
    assert h["valuation"] == 271826.59      # col 6 → stored value
    assert len(h) == 7  # P/L cols 7-8 dropped (recomputed downstream, never stored from the doc)


def test_parse_mf_row_repairs_wrapped_isin_in_situ():
    row = ["Mirae Asset ELSS", "INF769K01D\xad\nM9", "F2", "100", "27.65", "2,20,000.00", "2,76,510.35", "", ""]
    assert parse_mf_row(row)["isin"] == "INF769K01DM9"


def test_grand_total_is_anchor_not_a_holding():
    row = ["Grand Total", "", "", "", "", "8,50,000.00", "10,26,056.02", "", ""]
    assert parse_mf_row(row) == ("grandtotal", 850000.0, 1026056.02)


def test_grand_total_valuation_is_col6_even_if_pl_totals_bleed_in():
    # If pdfplumber emits the trailing P/L total / P/L% cells (not empty), valuation must still be the
    # SECOND numeric (col 6), not the last — nums[-1] would grab the P/L total and corrupt coverage.
    row = ["Grand Total", "", "", "", "", "8,50,000.00", "10,26,056.02", "1,76,056.02", "20.71"]
    assert parse_mf_row(row) == ("grandtotal", 850000.0, 1026056.02)


def test_scheme_named_grand_total_with_isin_is_a_holding_not_the_anchor():
    # A (hypothetical) scheme whose name starts "Grand Total" but which HAS an ISIN is a holding —
    # the ISIN check runs first, so it is never swallowed as the reconciliation anchor.
    row = ["Grand Total Return Fund", "INF966L01986", "F9", "1", "1", "100.00", "120.00", "", ""]
    h = parse_mf_row(row)
    assert isinstance(h, dict) and h["isin"] == "INF966L01986" and h["valuation"] == 120.0


def test_mf_parser_ignores_non_mf_and_header_rows():
    assert parse_mf_row([INE, "Some Co", "10", "100", "1000"]) is None  # equity row (INE in col 0)
    assert parse_mf_row(["Scheme Name", "ISIN", "Folio No."]) is None   # header row


def test_build_mf_parsed_five_schemes_tie_to_grand_total():
    # The five real schemes + their real invested/valuation; the sums MUST reproduce the Grand Total.
    rows = [
        parse_mf_row(["Canara Robeco ELSS", "INF760K01EL8", "F1", "1", "1", "2,20,000.00", "2,71,826.59", "", ""]),
        parse_mf_row(["ICICI Pru Technology", "INF109K01Z48", "F2", "1", "1", "10,000.00", "10,221.15", "", ""]),
        parse_mf_row(["Mirae Asset ELSS", "INF769K01D\xad\nM9", "F3", "1", "1", "2,20,000.00", "2,76,510.35", "", ""]),
        parse_mf_row(["quant ELSS", "INF966L01986", "F4", "1", "1", "2,20,000.00", "2,81,701.39", "", ""]),
        parse_mf_row(["quant Small Cap", "INF966L01689", "F5", "1", "1", "1,80,000.00", "1,85,796.54", "", ""]),
    ]
    out = build_mf_parsed(rows, [], "30-04-2026", grand=(850000.0, 1026056.02))
    assert out["statementDate"] == "2026-04-30T00:00:00.000Z"
    assert len(out["holdings"]) == 5
    assert all(h["section"] == "folio" for h in out["holdings"])
    assert any(h["isin"] == "INF769K01DM9" for h in out["holdings"])  # wrapped ISIN present, clean
    assert round(sum(h["valuation"] for h in out["holdings"]), 2) == out["grandTotalValuation"] == 1026056.02
    assert round(sum(h["amountInvested"] for h in out["holdings"]), 2) == out["grandTotalInvested"] == 850000.0


def test_build_mf_parsed_dedups_identical_folio_isin():
    r = parse_mf_row(["A Fund", "INF760K01EL8", "F1", "1", "1", "100.00", "120.00", "", ""])
    out = build_mf_parsed([r, dict(r)], [], "30-04-2026")
    assert len(out["holdings"]) == 1  # identical folio|ISIN deduped


def test_find_mf_statement_date_prefers_section_header():
    text = "HOLDING STATEMENT AS ON 31-03-2026\n...\nMUTUAL FUND UNITS HELD AS ON 30-04-2026\n..."
    assert find_mf_statement_date(text) == "30-04-2026"  # MF section AS-ON wins over the equity one


# --- Real fixtures from the live statement (the 3 table TYPES that all contain INF ISINs) ----------
# The SAME MF ISINs appear in three places; only the folio table is the cost-basis source. Faithful
# (trimmed) copies of the real pdfplumber output, including garbled bilingual headers + soft-hyphen.

_TXN_TABLE = [  # page 6 table 1 — MF purchase TRANSACTIONS (Op.Bal / Cr / Debit / Cl.Bal). NOT a holding.
    ['IIS SSII NNN\nI I', 'SSeeccuurriittyy', 'TTrraannssaaccttiioonn', 'DDaattee', 'OOpp.. BBaall', 'CCrreeddiitt', 'DDeebbiitt', 'CCll.. BBaall', 'Stamp'],
    ['INF205KA1213', 'INVESCO AM (I) PVT\nLTD#...FOCUSED FUND', 'BSECH-CR IN001150', '07-04-2026', '1199.488', '192.003', '--', '1391.491', '0'],
    ['INF247L01AE7', 'MOTILAL OSWAL...NIFTY 50', 'BSECH-CR IN001150', '07-04-2026', '1911.666', '301.383', '--', '2213.049', '0'],
    ['INF200K01RP8', 'SBI...GOLD FUND', 'BSECH-CR IN001150', '07-04-2026', '886.152', '110.114', '--', '996.266', '0'],
    ['INF789FC12T1', 'UTI...NIFTY NEXT 50', 'BSECH-CR IN001150', '07-04-2026', '1653.376', '257.632', '--', '1911.008', '0'],
]
# page 6-7 demat HOLDING statement — MF units held in demat, NO cost basis (value = units × market price).
# The 4 INF rows are the real demat-held MFs; sum of values = ₹1,80,540.01 (the discrete summary bucket).
_DEMAT_TABLE = [
    ['ISIN\nISIN', 'Security\n��तभू�त', 'Current\nवत�मBाaनl शेष', 'Frozen\n�ोजेन', 'Pledge', 'Pledge\nSetup', 'Free Bal\nमु�त शेष', 'Market\nPrice', '₹V a lu e ( ` )'],
    ['INE154A01025', 'ITC LIMITED - EQUITY SHARES', '3.000', '--', '--', '--', '3.000', '314.950', '944.85'],
    ['INF205KA1213', 'INVESCO AM (I) PVT\nLTD#INVESCO INDIA FOCUSED FUND-DIRECT-\nGROWTH', '1391.491', '--', '--', '--', '1391.491', '28.370', '39,476.60'],
    ['INF247L01AE7', 'MOTILAL OSWAL...NIFTY 50\nINDEX FUND-DIRECT-GROWTH', '2213.049', '--', '--', '--', '2213.049', '20.958', '46,381.08'],
    ['INF200K01RP8', 'SBI...GOLD FUND DIRECT PL GROWTH', '996.266', '--', '--', '--', '996.266', '44.925', '44,757.25'],
    ['INF789FC12T1', 'UTI...NIFTY NEXT 50 INDEX FUND-DIRECT-\nGROWTH', '1911.008', '--', '--', '--', '1911.008', '26.125', '49,925.08'],
]
_FOLIO_TABLE = [  # page 9 table 2 — THE folio MF section: cost basis (Cumulative Invested) + Valuation.
    ['3M0U-0T4U-A20L 2F6U NतDक UकNे...', None, None, None, None, None, None, None, None],
    ['Scheme Name\n�क�म का नाम', 'ISIN\nISIN', 'Folio No.\nफो�लयो नं', 'Closing\n(Units)', 'N A V ( `₹)', 'Cumulative\nAmount\nInvested (in\nINR)', 'V a lu a tio n (₹` )', 'Unrealised\nProfit/Loss', 'Unreali\xad\nsed P/L(%)'],
    ['ETDG - Canara\nRobeco ELSS Tax\nSaver Fund - Direct\nGrowth', 'INF760K01EL8', '17744270415/0', '1394.197', '194.97', '2,20,000.00', '2,71,826.59', '51,826.59', '23.56'],
    ['8019 - ICICI\nPrudential\nTechnology Fund -\nDirect Plan - Growth', 'INF109K01Z48', '16905781/77', '53.804', '189.97', '10,000.00', '10,221.15', '221.15', '2.21'],
    ['TSD1 - Mirae Asset\nELSS Tax Saver Fund', 'INF769K01D\xad\nM9', '77759916232/0', '5042.037', '54.841', '2,20,000.00', '2,76,510.35', '56,510.35', '25.69'],
    ['TPDG - quant ELSS\nTax Saver Fund -\nDirect Plan', 'INF966L01986', '51015406972/0', '655.493', '429.755', '2,20,000.00', '2,81,701.39', '61,701.39', '28.05'],
    ['IBDG - quant Small\nCap Fund - Direct\nPlan Growth', 'INF966L01689', '51015406972/0', '662.419', '280.4819', '1,80,000.00', '1,85,796.54', '5,796.54', '3.22'],
    ['Grand Total', '', '', '', '', '8,50,000.00', '10,26,056.02', '', ''],
]
_SUMMARY_TEXT = (  # the clean page-2/5 asset-allocation lines
    "Equity 1,26,421.50 9.48\n"
    "Mutual Fund Folios 10,26,056.02 76.97\n"
    "Mutual Funds Held in Demat Form 1,80,540.01 13.54\n"
)


def test_table_type_detectors():
    assert is_folio_table(_FOLIO_TABLE) is True
    assert is_folio_table(_TXN_TABLE) is False
    assert is_folio_table(_DEMAT_TABLE) is False
    assert is_demat_holding_table(_DEMAT_TABLE) is True   # Current + Market/Value headers
    assert is_demat_holding_table(_TXN_TABLE) is False     # transaction (Op./Cl. Bal, Stamp) — excluded
    assert is_demat_holding_table(_FOLIO_TABLE) is False   # folio (Folio/Cumulative) — excluded


def test_find_demat_mf_total_uses_the_discrete_line():
    assert find_demat_mf_total(_SUMMARY_TEXT) == 180540.01  # not 13.54, not the folio 10,26,056.02
    assert find_demat_mf_total("Equity 1,26,421.50 9.48") is None


def test_find_demat_mf_total_does_not_cross_lines():
    # If a reordered layout puts the amount on a DIFFERENT line from the label, return None (→ route
    # blocks) rather than grabbing a stray number from elsewhere.
    split = "Mutual Funds Held in Demat Form\n13.54\n1,80,540.01\n"
    assert find_demat_mf_total(split) is None


def test_build_mf_parsed_keeps_distinct_empty_scope_rows():
    # Two demat rows, same ISIN, UNKNOWN boId ('') — must NOT collapse (that would silently undercount);
    # both survive so the reconcile's key-uniqueness guard can surface the clash.
    r = {"isin": "INF205KA1213", "name": "X", "boId": "", "units": 1, "nav": 1, "amountInvested": None, "valuation": 100}
    out = build_mf_parsed([], [dict(r), dict(r)], "30-04-2026", None, 200)
    assert len([h for h in out["holdings"] if h["section"] == "demat"]) == 2


def test_collect_mf_rows_two_sections_txn_excluded():
    # Folio rows from the folio table; demat MF rows from the demat holding table; the TRANSACTION
    # table is excluded entirely (its INF rows once double-counted +₹5,650/+₹861).
    folio, demat, grand = collect_mf_rows([_TXN_TABLE, _DEMAT_TABLE, _FOLIO_TABLE])
    assert grand == (850000.0, 1026056.02)
    assert {r["isin"] for r in folio} == {"INF760K01EL8", "INF109K01Z48", "INF769K01DM9", "INF966L01986", "INF966L01689"}
    assert {r["isin"] for r in demat} == {"INF205KA1213", "INF247L01AE7", "INF200K01RP8", "INF789FC12T1"}
    assert all(r["amountInvested"] is None for r in demat)  # demat = value-only, no cost basis
    # INE equity rows are NOT MF; transaction-table values never leak into demat valuations.
    assert round(sum(r["valuation"] for r in demat), 2) == 180540.01


def test_build_mf_parsed_two_sections_tie_to_both_buckets():
    folio, demat, grand = collect_mf_rows([_TXN_TABLE, _DEMAT_TABLE, _FOLIO_TABLE])
    out = build_mf_parsed(folio, demat, "30-04-2026", grand, find_demat_mf_total(_SUMMARY_TEXT))
    assert len(out["holdings"]) == 9  # 5 folio + 4 demat
    fol = [h for h in out["holdings"] if h["section"] == "folio"]
    dem = [h for h in out["holdings"] if h["section"] == "demat"]
    assert len(fol) == 5 and len(dem) == 4
    assert round(sum(h["valuation"] for h in fol), 2) == out["grandTotalValuation"] == 1026056.02
    assert round(sum(h["valuation"] for h in dem), 2) == out["dematStatedTotal"] == 180540.01
    assert all(h["amountInvested"] is None for h in dem)  # demat: value-only, no cost basis
    assert any(h["isin"] == "INF769K01DM9" for h in fol)  # soft-hyphen folio ISIN repaired


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for t in tests:
        t()
        print(f"ok - {t.__name__}")
    print(f"\n{len(tests)} passed")
