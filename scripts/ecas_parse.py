#!/usr/bin/env python3
"""CDSL/NSDL eCAS (depository Consolidated Account Statement) parser sidecar.

Invoked by the wealth import routes via a Node subprocess. Two modes (argv[1]):
  • "stocks" (default) — the equity HOLDING STATEMENT; emits `EcasParsed` (lib/ecas/types.ts):
    equity holdings per BO ID, unrecognized ISINs, the statement date, and the stated Equity
    total. Mutual-fund (INF*) rows here are SKIPPED (the demat copy has no cost basis).
  • "mf" — the FOLIO section ("MUTUAL FUND UNITS HELD AS ON …"); emits `MfParsed`
    (lib/ecas/mf-types.ts): per-folio MF holdings WITH cost basis (Cumulative Amount Invested) and
    Valuation, plus the Grand Total invested/valuation for a coverage check. This is the MF source
    (replaces the CAMS/KFintech path).

Reads the PDF from STDIN (password on the first line, raw PDF bytes after) so the PDF never
reaches disk via Node and the password never appears in argv/env.

Privacy: emits only the fields the app needs (no PAN, no transactions). The PDF is parsed
in-memory via a BytesIO file object — it never touches disk.

Parser: pdfplumber (PyPI, MIT). Exit codes: 0 ok · 2 bad/missing password · 3 parse error · 4 pdfplumber missing.
"""
import io
import json
import re
import sys

# ROW LOCATOR ONLY — finds candidate holding rows. classify_isin() is the real gate.
ISIN_LOCATOR = re.compile(r"^IN[A-Z0-9]{10}$")
ISIN_SHAPE = re.compile(r"^[A-Z]{2}[A-Z0-9]{9}[0-9]$")
MF_ISIN = re.compile(r"^INF[A-Z0-9]{9}$")  # mutual-fund ISINs (the folio section)
BO_ID = re.compile(r"(?:BO ID|Demat Account|DP ID|Client ID)[:\s]*([A-Z0-9]{8,16})", re.I)

# MF folio-section "AS ON" date — anchored to the section header
# ("MUTUAL FUND UNITS HELD AS ON 30-04-2026") so the MF date wins over any other "AS ON" on the page.
MF_AS_ON = re.compile(
    r"MUTUAL\s+FUND\s+UNITS\s+HELD\s+AS\s+ON\s*:?\s*"
    r"(\d{1,2}[-/](?:\d{1,2}|[A-Za-z]{3})[-/]\d{4})",
    re.I,
)
# DISCRETE summary line for the demat-held-MF bucket ("Mutual Funds Held in Demat Form  ₹1,80,540.01").
# This is the coverage ANCHOR for demat MFs — NEVER derived by subtraction (which would misattribute any
# other security class into MF). PROVISIONAL pattern — finalize against the real (bilingual) label.
DEMAT_MF_TOTAL = re.compile(
    # `[^\n]` (not `[^\d]`) so the gap can't cross into a DIFFERENT line's number — a split/reordered
    # layout then yields no match (→ None → route blocks) rather than grabbing the wrong figure.
    r"mutual\s*funds?\s*held\s*in\s*demat\s*form[^\n]{0,40}?([\d,]+\.\d{2})", re.I
)

# Statement date: anchored to an "AS ON"/"statement date" label, NOT the first stray date on the
# page (an allotment/sub-division date inside a security name). Accepts DD-MM-YYYY (the eCAS header
# format, e.g. "HOLDING STATEMENT AS ON 30-04-2026") and DD-Mon-YYYY.
AS_ON = re.compile(
    r"(?:as\s+on|as\s+at|statement\s+date|holdings?\s+as\s+on)\s*:?\s*"
    r"(\d{1,2}[-/](?:\d{1,2}|[A-Za-z]{3})[-/]\d{4})",
    re.I,
)
# Stated Equity asset-class total (completeness check). Matches "Equity ₹1,26,421.50" but NOT a
# holding name "... EQUITY SHARES ...".
EQUITY_TOTAL = re.compile(r"\bEquit(?:y|ies)\b(?!\s+shares)[^\n\d]{0,30}?(\d[\d,]*\.\d{2})", re.I)

_MONTHS = {m: i + 1 for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
)}


def fail(code: int, error: str, detail: str = "") -> None:
    payload = {"error": error}
    if detail:
        payload["detail"] = detail
    print(json.dumps(payload))
    sys.exit(code)


def isin_checksum_ok(isin: str) -> bool:
    """Validate an ISIN's mod-10 (Luhn) check digit — catches an anchor-matching string that isn't a
    real security."""
    if not ISIN_SHAPE.match(isin):
        return False
    digits = "".join(str(ord(c) - 55) if c.isalpha() else c for c in isin)
    total = 0
    for i, ch in enumerate(reversed(digits)):
        d = int(ch)
        if i % 2 == 1:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return total % 10 == 0


def classify_isin(isin: str) -> str:
    """Three-way gate: 'equity' | 'mf' | 'unrecognized'. Plausibility (shape + checksum) first."""
    if not isin_checksum_ok(isin):
        return "unrecognized"
    c = isin[2]
    if c == "E":
        return "equity"
    if c == "F":
        return "mf"
    return "unrecognized"


def _num(v):
    if v is None:
        return None
    s = str(v).strip().replace(",", "")
    if s == "" or s in {"-", "N.A.", "NA"}:
        return None
    try:
        return float(s)
    except (TypeError, ValueError):
        return None


def _iso_statement_date(s):
    """Convert the eCAS statement date (DD-MM-YYYY numeric month, or DD-Mon-YYYY) to full ISO-8601
    (UTC) — Prisma's DateTime needs ISO. Parsed EXPLICITLY (never a locale date parser). Returns None
    for anything else, so the route rejects an undateable import rather than mislabel a price."""
    if not s:
        return None
    s = s.strip()
    m = re.match(r"^(\d{1,2})[-/]([A-Za-z]{3})[-/](\d{4})$", s)
    if m:
        day, mon, year = int(m.group(1)), _MONTHS.get(m.group(2).title()), int(m.group(3))
    else:
        m = re.match(r"^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$", s)  # DD-MM-YYYY (Indian)
        if not m:
            return None
        day, mon, year = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if not mon or mon < 1 or mon > 12 or day < 1 or day > 31:
        return None
    return f"{year:04d}-{mon:02d}-{day:02d}T00:00:00.000Z"


def find_statement_date(text):
    """The holding-statement 'AS ON <date>' date — NOT the first stray DD-Mon-YYYY on the page.
    Returns the raw matched date string or None."""
    m = AS_ON.search(text)
    return m.group(1) if m else None


def find_equity_total(text):
    """The stated Equity asset-class total (₹) for the completeness check, or None."""
    m = EQUITY_TOTAL.search(text)
    return _num(m.group(1)) if m else None


def find_mf_statement_date(text):
    """The MF folio section's 'AS ON <date>' — prefer the section header, fall back to the generic
    AS ON anchor. Returns the raw matched date string or None (never a stray date)."""
    m = MF_AS_ON.search(text)
    if m:
        return m.group(1)
    return find_statement_date(text)


def find_demat_mf_total(text):
    """The DISCRETE asset-allocation total for demat-held MFs ("Mutual Funds Held in Demat Form
    1,80,540.01") — the coverage anchor for the demat MF sub-class. Returns the ₹ amount or None.
    NEVER derived by subtraction (that would misattribute any other security class into MF)."""
    m = DEMAT_MF_TOTAL.search(text)
    return _num(m.group(1)) if m else None


def _clean_isin(s):
    """Normalise an ISIN cell. CRITICAL: a long MF ISIN can wrap inside a pdfplumber cell with a SOFT
    HYPHEN + newline (e.g. 'INF769K01D\\xad\\nM9' for INF769K01DM9). Strip U+00AD and ALL whitespace
    and rejoin before using it as a key — a missed strip yields a bogus ISIN that won't resolve in the
    AMFI feed, which on a MIGRATION becomes a false unmatched-blocking row against a healthy fund."""
    return re.sub(r"[\s\u00ad\u200b]", "", (s or "")).upper()


def parse_mf_row(cells):
    """PURE: one folio-section table row → an MF holding dict, a ('grandtotal', invested, valuation)
    tuple, or None. Exported for tests.

    Folio table columns (verbatim from the real page-9 dump, 9 cols):
      0 Scheme Name · 1 ISIN · 2 Folio No. · 3 Closing Bal (Units) · 4 NAV ·
      5 Cumulative Amount Invested · 6 Valuation · 7 Unrealised P/L · 8 Unrealised P/L %
    The ISIN anchors the row (scanned, not assumed at a fixed index, so a dropped/merged blank column
    can't silently shift the numerics); the name is to its left, the rest to its right. cols 7-8 are
    DROPPED — P/L is recomputed downstream from valuation − invested (never stored from the doc)."""
    cells = [(c or "") for c in cells]
    if not cells:
        return None
    # Locate the ISIN cell first — a holding row has one, the Grand Total row does not. Checking the
    # ISIN before the "grand total" label makes the two mutually exclusive: a scheme whose NAME starts
    # "Grand Total …" is never mistaken for the total, and the total is never read as a holding.
    idx = isin = None
    for i, c in enumerate(cells):
        cand = _clean_isin(c)
        if MF_ISIN.match(cand):
            idx, isin = i, cand
            break
    if idx is None:
        # No ISIN → maybe the Grand Total reconciliation anchor. Its layout mirrors a holding row, so
        # invested is the FIRST numeric (col 5) and valuation the SECOND (col 6). Take nums[1], NOT
        # nums[-1]: if pdfplumber bleeds a P/L total (col 7/8) into the row, nums[-1] would be the P/L.
        col0 = re.sub(r"\s+", " ", cells[0]).strip().lower()
        if col0.startswith("grand total"):
            nums = [n for n in (_num(c) for c in cells) if n is not None]
            if len(nums) >= 2:
                return ("grandtotal", nums[0], nums[1])
        return None
    name = re.sub(r"\s+", " ", " ".join(cells[:idx])).strip()  # collapse cell-wrap newlines
    rest = cells[idx + 1:]  # folio, units, nav, invested, valuation, [p/l, p/l%]
    return {
        "isin": isin,
        "name": name,
        "folio": rest[0].strip() if len(rest) > 0 else "",
        "units": _num(rest[1]) if len(rest) > 1 else None,
        "nav": _num(rest[2]) if len(rest) > 2 else None,
        "amountInvested": _num(rest[3]) if len(rest) > 3 else None,
        "valuation": _num(rest[4]) if len(rest) > 4 else None,
    }


def build_mf_parsed(folio_rows, demat_rows, statement_date, grand=None, demat_total=None):
    """PURE: folio + demat-held MF rows → the normalized MfParsed shape (lib/ecas/mf-types.ts). Exported
    for tests. Each holding is tagged with its `section` ('folio' carries cost basis + a folio key;
    'demat' is value-only + a boId key). Dedups an identical (section, key, ISIN) row defensively.
    Carries BOTH coverage anchors — the folio Grand Total AND the discrete demat-MF stated total — so
    the route can reconcile EACH MF sub-class (neither can silently vanish). Cross-section overlap
    (an ISIN in both) is left to the pure reconcile (folio-wins dedup + surfaced)."""
    holdings = []
    seen = set()

    def add(rows, section):
        for r in rows:
            isin = (r.get("isin") or "").strip().upper()
            if not MF_ISIN.match(isin):
                continue
            folio = (r.get("folio") or "").strip()
            bo = (r.get("boId") or "").strip()
            scope = folio if section == "folio" else bo
            key = (section, scope, isin)
            # Dedup an identical (section, scope, ISIN) row defensively — but ONLY when the scope is
            # known. With an empty scope two genuinely-distinct holdings would collapse (silent
            # undercount); leave both and let the reconcile's key-uniqueness guard surface the clash.
            if scope and key in seen:
                continue
            if scope:
                seen.add(key)
            holdings.append({
                "isin": isin,
                "name": r.get("name") or "",
                "section": section,
                "folio": folio,
                "boId": bo,
                "units": r.get("units"),
                "nav": r.get("nav"),
                "amountInvested": r.get("amountInvested"),  # None for demat (no cost basis)
                "valuation": r.get("valuation"),
            })

    add(folio_rows, "folio")
    add(demat_rows, "demat")
    return {
        "statementDate": _iso_statement_date(statement_date),
        "grandTotalInvested": grand[0] if grand else None,
        "grandTotalValuation": grand[1] if grand else None,
        "dematStatedTotal": demat_total,
        "holdings": holdings,
    }


def is_folio_table(table):
    """True only for the FOLIO-section MF table, identified by its header columns: a 'Folio' column
    AND a 'Cumulative Amount Invested' column. CRITICAL: the same MF ISINs (INF*) also appear in the
    demat EQUITY holding statement (no cost basis) and in the TRANSACTION statement (Op.Bal/Cr/Debit) —
    neither is the cost-basis source, and reading them as folio rows double-counts and injects bogus
    invested/valuation. The folio table is the ONLY one carrying Folio + Cumulative/Invested headers."""
    for row in table:
        joined = " ".join((c or "") for c in row).lower()
        if "folio" in joined and ("invested" in joined or "cumulative" in joined):
            return True
    return False


def is_demat_holding_table(table):
    """True for the demat HOLDING-statement table — where MF units held in demat appear as INF rows with
    a market Value but NO cost basis. Header carries Current/Free Bal + Market Price/Value, and does NOT
    carry the folio markers (Folio/Cumulative) or the TRANSACTION-statement markers (Stamp; and it lacks
    Current/Free Bal entirely — it has Op./Cl. Bal). So the transaction table (whose INF rows once
    double-counted) is excluded here, as is the folio table (caught earlier)."""
    for row in table:
        j = " ".join((c or "") for c in row).lower()
        # The eCAS doubles header letters ("TTrraannssaaccttiioonn", "OOpp.. BBaall"). Collapse doubled
        # runs so transaction markers are detected POSITIVELY (not merely by absence of "current"),
        # closing the door on a transaction variant that happens to carry a "Current"/"Value" column.
        jj = re.sub(r"(.)\1", r"\1", j)
        if (
            ("current" in j or "free bal" in j)
            and ("market" in j or "value" in j)
            and "folio" not in j
            and "cumulative" not in j
            and "stamp" not in jj
            and "transaction" not in jj
            and "op. bal" not in jj
            and "cl. bal" not in jj
        ):
            return True
    return False


def collect_mf_rows(tables, bo_id=""):
    """PURE (exported for tests): from a page's tables, collect MF holdings from the TWO MF-bearing
    tables — the FOLIO table (cost basis; via parse_mf_row) AND the demat HOLDING table (INF rows,
    value-only; via parse_holding_row, keeping only INF). The TRANSACTION table is excluded by both
    detectors. Returns (folio_rows, demat_rows, grand)."""
    folio_rows = []
    demat_rows = []
    grand = None
    for table in tables:
        if is_folio_table(table):
            for row in table:
                parsed = parse_mf_row(row)
                if parsed is None:
                    continue
                if isinstance(parsed, tuple):  # grand total row (last one wins)
                    grand = (parsed[1], parsed[2])
                else:
                    folio_rows.append(parsed)
        elif is_demat_holding_table(table):
            for row in table:
                h = parse_holding_row(row)
                if h is None:
                    continue
                isin = _clean_isin(h["isin"])
                if not MF_ISIN.match(isin):  # only INF (MF) rows; demat equities (INE) are the stock path
                    continue
                demat_rows.append({
                    "isin": isin,
                    "name": h["name"],
                    "boId": bo_id,
                    "units": _num(h["units"]),
                    "nav": _num(h["price"]),
                    "amountInvested": None,  # the demat holding statement has no cost-basis column
                    "valuation": _num(h["value"]),
                })
    return folio_rows, demat_rows, grand


def extract_mf_rows(source, password=""):
    """Extract MF holdings from BOTH eCAS sections via pdfplumber. Returns
    (folio_rows, demat_rows, statement_date, grand, demat_total)."""
    import pdfplumber  # lazy — keeps the pure helpers importable without pdfplumber installed

    folio_rows = []
    demat_rows = []
    statement_date = None
    grand = None
    demat_total = None
    with pdfplumber.open(source, password=password or "") as pdf:
        current_bo = ""
        for page in pdf.pages:
            text = page.extract_text() or ""
            m = BO_ID.search(text)
            if m:
                current_bo = m.group(1)
            if statement_date is None:
                statement_date = find_mf_statement_date(text)
            if demat_total is None:
                demat_total = find_demat_mf_total(text)
            f, dm, g = collect_mf_rows(page.extract_tables() or [], current_bo)
            folio_rows.extend(f)
            demat_rows.extend(dm)
            if g is not None:
                grand = g
    return folio_rows, demat_rows, statement_date, grand, demat_total


def is_transaction_table(table):
    """The MF/equity TRANSACTION statement table (Op.Bal/Cr/Debit/Cl.Bal/Stamp). Its ISIN rows are
    transactions, NOT holdings — excluded from import but COUNTED as skipped (never silently dropped).
    De-doubles the garbled header so the markers are detected positively."""
    for row in table:
        jj = re.sub(r"(.)\1", r"\1", " ".join((c or "") for c in row).lower())
        if "stamp" in jj or "transaction" in jj or "op. bal" in jj or "cl. bal" in jj:
            return True
    return False


def collect_unified(tables, bo_id="", counts=None):
    """PURE (exported for tests): partition ONE page's tables for the unified import. EVERY ISIN-bearing
    holding-shaped row lands in exactly one class so none is silently excluded (the generalized
    'owned by nobody' guard):
      • folio table  → folio MF      • holding table → equity (INE) | demat MF (INF) | unrecognized
      • transaction table → skipped  • any other ISIN-bearing row → unrecognized (surfaced)
    Returns (raw_holding_rows, folio_rows, demat_rows, grand); `counts` (a dict) is accumulated in place
    with the per-class raw tallies used by the balance guard."""
    if counts is None:
        counts = {"parsedRows": 0, "equity": 0, "folioMf": 0, "dematMf": 0, "unrecognized": 0, "skipped": 0}
    raw_holding_rows = []
    folio_rows = []
    demat_rows = []
    grand = None

    def seen(cls):
        counts["parsedRows"] += 1
        counts[cls] += 1

    for table in tables:
        if is_folio_table(table):
            for row in table:
                p = parse_mf_row(row)
                if p is None:
                    continue
                if isinstance(p, tuple):  # grand total — an anchor, not a holding
                    grand = (p[1], p[2])
                    continue
                seen("folioMf")
                folio_rows.append(p)
        elif is_transaction_table(table):
            # Checked BEFORE the holding detector: transaction rows must never out-rank holdings, even
            # if a transaction header also happened to carry Current/Value columns.
            for row in table:
                if parse_holding_row(row) is not None:
                    seen("skipped")  # a transaction row, explicitly skipped (not a holding)
        elif is_demat_holding_table(table):
            for row in table:
                h = parse_holding_row(row)
                if h is None:
                    continue
                h["boId"] = bo_id
                raw_holding_rows.append(h)  # build_parsed re-partitions: keeps INE, skips INF, surfaces unrec
                kind = classify_isin(_clean_isin(h["isin"]))
                if kind == "equity":
                    seen("equity")
                elif kind == "mf":
                    seen("dematMf")
                    demat_rows.append({
                        "isin": _clean_isin(h["isin"]),
                        "name": h["name"],
                        "boId": bo_id,
                        "units": _num(h["units"]),
                        "nav": _num(h["price"]),
                        "amountInvested": None,
                        "valuation": _num(h["value"]),
                    })
                else:
                    seen("unrecognized")
        else:
            for row in table:  # unexpected table: an ISIN-bearing row must be surfaced, not lost
                h = parse_holding_row(row)
                if h is None:
                    continue
                seen("unrecognized")
                h["boId"] = bo_id
                raw_holding_rows.append(h)
    return raw_holding_rows, folio_rows, demat_rows, grand


def extract_unified(source, password=""):
    """ONE pdfplumber pass producing all three row sets for the unified import (via collect_unified).
    Returns (raw_holding_rows, folio_rows, demat_rows, grand, equity_stmt, mf_stmt, equity_total,
    demat_total, row_accounting). Equity and MF carry their OWN 'AS ON' dates (a consolidated eCAS uses
    one date, but each class is dated from its own anchor so a divergence can't mis-stamp a class)."""
    import pdfplumber  # lazy — keeps the pure helpers importable without pdfplumber installed

    raw_holding_rows = []
    folio_rows = []
    demat_rows = []
    grand = None
    equity_stmt = mf_stmt = equity_total = demat_total = None
    counts = {"parsedRows": 0, "equity": 0, "folioMf": 0, "dematMf": 0, "unrecognized": 0, "skipped": 0}
    with pdfplumber.open(source, password=password or "") as pdf:
        bo = ""
        for page in pdf.pages:
            text = page.extract_text() or ""
            m = BO_ID.search(text)
            if m:
                bo = m.group(1)
            if equity_stmt is None:
                equity_stmt = find_statement_date(text)  # equity holding-statement "AS ON"
            if mf_stmt is None:
                mf_stmt = find_mf_statement_date(text)  # MF folio "AS ON" (own anchor; falls back internally)
            if equity_total is None:
                equity_total = find_equity_total(text)
            if demat_total is None:
                demat_total = find_demat_mf_total(text)
            rhr, fr, dr, g = collect_unified(page.extract_tables() or [], bo, counts)
            raw_holding_rows.extend(rhr)
            folio_rows.extend(fr)
            demat_rows.extend(dr)
            if g is not None:
                grand = g
    # Each class falls back to the other's date only if its own anchor was absent (never invent one).
    return raw_holding_rows, folio_rows, demat_rows, grand, equity_stmt or mf_stmt, mf_stmt or equity_stmt, equity_total, demat_total, counts


def build_unified(raw_holding_rows, folio_rows, demat_rows, grand, equity_stmt, mf_stmt, equity_total, demat_total, row_accounting):
    """PURE: assemble the unified parse output — the existing EcasParsed (equity) + MfParsed (folio +
    demat) shapes the two engines already consume, plus the row-accounting tally. Each class is stamped
    with its OWN statement date. Exported for tests."""
    return {
        "equity": build_parsed(raw_holding_rows, equity_stmt, equity_total),
        "mf": build_mf_parsed(folio_rows, demat_rows, mf_stmt, grand, demat_total),
        "rowAccounting": row_accounting,
    }


def parse_holding_row(cells):
    """PURE: one extracted table row → {isin,name,units,price,value} (strings) or None.

    Robust to a VARIABLE column count: pdfplumber drops/merges blank columns, so the rigid 9-column
    layout (ISIN, Security, Current Bal, Frozen, Pledge, PledgeSetup, Free Bal, Market Price, Value)
    can collapse (e.g. to ISIN, Security, Current Bal, Market Price, Value). The ISIN anchors the row,
    NAME comes from the left, and PRICE/VALUE from the RIGHT (last two cells) — so a collapsed row
    parses as well as the full one, instead of being silently dropped. (This dropped BAJAJ AUTO.)
    """
    cells = [(c or "").strip() for c in cells]
    if len(cells) < 4:  # need at least ISIN, name, price, value
        return None
    isin = cells[0].replace(" ", "").upper()
    if not ISIN_LOCATOR.match(isin):
        return None
    value = cells[-1]
    price = cells[-2]
    # Current balance (units): the first numeric cell after the name (between index 2 and price).
    units = None
    for c in cells[2:-2]:
        if re.match(r"^-?[\d,]+(?:\.\d+)?$", c.replace(" ", "")):
            units = c
            break
    return {"isin": isin, "name": cells[1], "units": units, "price": price, "value": value}


def _holding_value(h):
    """Market value used to pick the best of several rows for one holding."""
    if h["value"] is not None:
        return h["value"]
    return (h["units"] or 0) * (h["price"] or 0)


def build_parsed(raw_rows, statement_date, equity_total=None):
    """PURE: classify locator-matched rows into the normalized EcasParsed shape. Exported for tests.
    Skips INF (MF, double-count) and surfaces unrecognized ISINs.

    A single equity holding can appear as MULTIPLE table rows — a pending/settlement-detail row
    (0 units, 0 value, "PAYOUT-CR…SETT" text) PLUS the actual holding row — both with the same
    `boId|isin`. Keep the BEST row per (boId, isin): the one with the largest market value (the real
    holding, not the zero/transaction artifact). This is what dropped BAJAJ AUTO / ICICI LOMBARD."""
    best = {}  # (boId, isin) -> holding (the highest-value row seen for this key)
    seen_unrec = set()
    unrecognized = []
    for r in raw_rows:
        isin = (r.get("isin") or "").strip().upper()
        if not ISIN_LOCATOR.match(isin):
            continue
        name = re.sub(r"\s+", " ", (r.get("name") or "")).strip()  # collapse PDF cell-wrap newlines
        kind = classify_isin(isin)
        if kind == "mf":
            continue
        if kind == "unrecognized":
            if isin not in seen_unrec:
                seen_unrec.add(isin)
                unrecognized.append({"isin": isin, "name": name})
            continue
        bo = (r.get("boId") or "").strip()
        h = {
            "isin": isin,
            "name": name,
            "units": _num(r.get("units")),
            "price": _num(r.get("price")),
            "value": _num(r.get("value")),
        }
        key = (bo, isin)
        cur = best.get(key)
        if cur is None or _holding_value(h) > _holding_value(cur):
            best[key] = h

    accounts = {}
    for (bo, _isin), h in best.items():
        accounts.setdefault(bo, {"boId": bo, "holdings": []})["holdings"].append(h)
    return {
        "statementDate": _iso_statement_date(statement_date),
        "equityStatedTotal": equity_total,
        "accounts": list(accounts.values()),
        "unrecognized": unrecognized,
    }


def extract_rows(source, password=""):
    """Extract holding rows from the eCAS PDF via pdfplumber. The password MUST be passed — a
    CDSL/NSDL eCAS is encrypted. Returns (raw_rows, statement_date, equity_total)."""
    import pdfplumber  # lazy — keeps the pure helpers importable without pdfplumber installed

    raw_rows = []
    statement_date = None
    equity_total = None
    with pdfplumber.open(source, password=password or "") as pdf:
        current_bo = ""
        for page in pdf.pages:
            text = page.extract_text() or ""
            m = BO_ID.search(text)
            if m:
                current_bo = m.group(1)
            if statement_date is None:
                statement_date = find_statement_date(text)  # anchored; no stray-date fallback
            if equity_total is None:
                equity_total = find_equity_total(text)
            for table in page.extract_tables() or []:
                for row in table:
                    h = parse_holding_row(row)
                    if h:
                        h["boId"] = current_bo
                        raw_rows.append(h)
    return raw_rows, statement_date, equity_total


def main() -> None:
    # mode = "stocks" (default, equity holding statement) | "mf" (folio MF section). Read from argv —
    # NOT stdin (stdin carries the password + PDF only; the password never appears in argv/env).
    mode = sys.argv[1] if len(sys.argv) > 1 else "stocks"

    raw = sys.stdin.buffer.read()
    nl = raw.find(b"\n")
    if nl < 0:
        fail(3, "empty_input")
    password = raw[:nl].decode("utf-8", "replace")
    pdf_bytes = raw[nl + 1:]
    if not pdf_bytes:
        fail(3, "empty_pdf")

    try:
        import pdfplumber  # noqa: F401 — presence check
    except ImportError:
        fail(4, "pdfplumber_missing")

    try:
        if mode == "unified":
            unified = extract_unified(io.BytesIO(pdf_bytes), password)
        elif mode == "mf":
            folio_rows, demat_rows, stmt, grand, demat_total = extract_mf_rows(io.BytesIO(pdf_bytes), password)
        else:
            rows, stmt, equity_total = extract_rows(io.BytesIO(pdf_bytes), password)
    except Exception as exc:  # noqa: BLE001 - normalise to structured exits
        name = type(exc).__name__
        if "password" in str(exc).lower() or "encrypt" in str(exc).lower():
            fail(2, "bad_password", detail=name)
        sys.stderr.write(f"parse failed: {name}\n")
        fail(3, "parse_error", detail=name)

    if mode == "unified":
        raw_holding_rows, folio_rows, demat_rows, grand, equity_stmt, mf_stmt, equity_total, demat_total, row_accounting = unified
        print(json.dumps(build_unified(raw_holding_rows, folio_rows, demat_rows, grand, equity_stmt, mf_stmt, equity_total, demat_total, row_accounting)))
    elif mode == "mf":
        print(json.dumps(build_mf_parsed(folio_rows, demat_rows, stmt, grand, demat_total)))
    else:
        print(json.dumps(build_parsed(rows, stmt, equity_total)))
    sys.exit(0)


if __name__ == "__main__":
    main()
