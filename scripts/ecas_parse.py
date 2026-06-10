#!/usr/bin/env python3
"""CDSL/NSDL eCAS (depository Consolidated Account Statement) parser sidecar — STOCKS.

Separate from the mutual-fund casparser path (scripts/cas_parse.py). Invoked by
app/api/wealth/import-ecas via a Node subprocess.

Reads the PDF from STDIN (password on the first line, raw PDF bytes after) so the PDF never
reaches disk via Node and the password never appears in argv/env. Emits a normalized
`EcasParsed` JSON (see lib/ecas/types.ts) on STDOUT — equity holdings per BO ID, a list of
unrecognized ISINs, the statement date, and the stated Equity asset-class total (for a
completeness check). Mutual-fund (INF*) rows are skipped (tracked via the CAMS/KFintech path).

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
BO_ID = re.compile(r"(?:BO ID|Demat Account|DP ID|Client ID)[:\s]*([A-Z0-9]{8,16})", re.I)

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
        rows, stmt, equity_total = extract_rows(io.BytesIO(pdf_bytes), password)
    except Exception as exc:  # noqa: BLE001 - normalise to structured exits
        name = type(exc).__name__
        if "password" in str(exc).lower() or "encrypt" in str(exc).lower():
            fail(2, "bad_password", detail=name)
        sys.stderr.write(f"parse failed: {name}\n")
        fail(3, "parse_error", detail=name)

    print(json.dumps(build_parsed(rows, stmt, equity_total)))
    sys.exit(0)


if __name__ == "__main__":
    main()
