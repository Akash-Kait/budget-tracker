#!/usr/bin/env python3
"""CAS (Consolidated Account Statement) parser sidecar.

Invoked by app/api/wealth/import-cas via a Node subprocess. Reads the PDF from STDIN
(password on the first line, raw PDF bytes after the newline) so the PDF never reaches
disk via Node and the password never appears in argv/env. Emits a trimmed JSON of the
MUTUAL-FUND holdings on STDOUT; exits non-zero with a structured {"error": code} for the
caller to map to an HTTP status.

Privacy: this prints ONLY the fields the app needs (no PAN, no transactions, no investor
info). If casparser requires a file path (older versions), the fallback temp file is
deleted in a `finally` so a parse exception can never leave a PAN-bearing PDF on disk.

Parser: codereverser/casparser (PyPI, MIT). The default pure-Python parser ONLY — the
mupdf/PyMuPDF extra (GPL/AGPL) must NOT be installed/used.

Exit codes:  0 ok · 2 bad/missing password · 3 parse error / not a CAS · 4 casparser missing
"""
import io
import json
import os
import sys
import tempfile


def fail(code: int, error: str, detail: str = "") -> None:
    # Structured, PII-free signal for the Node caller. `detail` is an exception CLASS NAME only
    # (never the message/content), safe to surface for diagnosis.
    payload = {"error": error}
    if detail:
        payload["detail"] = detail
    print(json.dumps(payload))
    sys.exit(code)


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
        import casparser
    except ImportError:
        fail(4, "casparser_missing")

    try:
        from casparser.exceptions import IncorrectPasswordError
    except Exception:  # pragma: no cover - older/newer layouts
        IncorrectPasswordError = None  # type: ignore

    def parse(source):
        return casparser.read_cas_pdf(source, password)

    try:
        try:
            # Primary: in-memory, no disk.
            data = parse(io.BytesIO(pdf_bytes))
        except TypeError:
            # Fallback: some casparser versions require a path. Write a 0600 temp file and
            # ALWAYS unlink it in finally, even if the parse raises mid-way.
            fd, tmp = tempfile.mkstemp(suffix=".pdf")
            try:
                os.write(fd, pdf_bytes)
                os.close(fd)
                data = parse(tmp)
            finally:
                try:
                    os.remove(tmp)
                except OSError:
                    pass
    except Exception as exc:  # noqa: BLE001 - normalise to structured exits
        name = type(exc).__name__
        if IncorrectPasswordError is not None and isinstance(exc, IncorrectPasswordError):
            fail(2, "bad_password", detail=name)
        if "password" in str(exc).lower():
            fail(2, "bad_password", detail=name)
        sys.stderr.write(f"parse failed: {name}\n")
        fail(3, "parse_error", detail=name)

    try:
        result = map_cas(data)
    except Exception as exc:  # noqa: BLE001 - map_cas shape mismatch shouldn't 500 opaquely
        # e.g. casparser returned an object, not a dict — surface the class so we can fix the mapping.
        fail(3, "map_error", detail=type(exc).__name__)
    print(json.dumps(result))
    sys.exit(0)


def _num(v):
    """Coerce to float or None — casparser may hand back str/Decimal/None."""
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _iso_date(v):
    """Normalize a date to 'YYYY-MM-DD' (date.isoformat when possible) so the JS side never has to
    guess a format. Falls back to str()."""
    if not v:
        return None
    iso = getattr(v, "isoformat", None)
    return iso() if callable(iso) else str(v)


def _as_dict(data):
    """casparser returns a plain dict on older versions but a pydantic/dataclass object on 0.7+.
    Normalize to the nested dict shape map_cas reads, so `.get(...)` never AttributeErrors on a
    perfectly valid parse."""
    if isinstance(data, dict):
        return data
    for attr in ("model_dump", "dict"):  # pydantic v2 / v1
        fn = getattr(data, attr, None)
        if callable(fn):
            try:
                return fn()
            except Exception:  # noqa: BLE001
                pass
    try:
        import dataclasses
        if dataclasses.is_dataclass(data):
            return dataclasses.asdict(data)
    except Exception:  # noqa: BLE001
        pass
    return data  # last resort — map_cas's .get will fail and surface map_error


def map_cas(data: dict) -> dict:
    """Pure casparser-dict → trimmed app JSON. Extracted so it's unit-testable without casparser.

    - Mutual funds only; emits the MF fields the app needs (no PAN/transactions/investor info).
    - Skips exited / zero-balance schemes (close is None or <= 0) — importing them would clutter the
      portfolio and a 0 could overwrite a real holding's units.
    - Derives NAV from value/units when the statement gives a value but no NAV (avoids a phantom ₹0).
    - Reads cost (invested amount) from the several places casparser has placed it across versions.
    - Accepts casparser's dict OR its CASData object (pydantic/dataclass on 0.7+).
    """
    data = _as_dict(data)
    schemes = []
    for folio in data.get("folios", []) or []:
        folio_no = folio.get("folio")
        for s in folio.get("schemes", []) or []:
            units = _num(s.get("close"))
            if units is None or units <= 0:
                continue  # not a live holding
            val = s.get("valuation") or {}
            nav = _num(val.get("nav"))
            value = _num(val.get("value"))
            if (nav is None or nav <= 0) and value and units:
                nav = value / units  # statement gave value but not NAV → derive it
            # cost/invested has lived under valuation.cost, scheme.cost, or scheme.valuation across
            # casparser versions; check each rather than trusting one.
            cost = _num(val.get("cost"))
            if cost is None:
                cost = _num(s.get("cost"))
            schemes.append(
                {
                    "amfi": s.get("amfi"),
                    "isin": s.get("isin"),
                    "rta": s.get("rta_code") or s.get("rta"),
                    "folio": str(folio_no) if folio_no is not None else None,
                    "name": s.get("scheme"),
                    "units": units,
                    "nav": nav,
                    "navDate": _iso_date(val.get("date")),
                    "value": value,
                    "cost": cost,
                }
            )

    period = data.get("statement_period") or {}
    return {"statementDate": _iso_date(period.get("to")), "schemes": schemes}


if __name__ == "__main__":
    main()
