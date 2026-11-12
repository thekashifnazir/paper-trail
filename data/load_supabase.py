#!/usr/bin/env python3
"""Load data/seed/* into the team's Supabase project over the REST API.

Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env (never commit it).
Run supabase/schema.sql in the SQL editor first.

  python3 data/load_supabase.py              # tenants, charges, notes, company lookup
  python3 data/load_supabase.py --with-bank  # also both bank statements (with ground truth)
  python3 data/load_supabase.py --dir data/sample  # load the public, Cortile-free sample instead

Re-running is safe: rows are upserted on their primary key. tenant_notes has a
serial id, so it is cleared and reloaded.
"""
import csv, json, os, sys, urllib.request, urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SEED = ROOT / "data" / "seed"
if "--dir" in sys.argv:
    SEED = (ROOT / sys.argv[sys.argv.index("--dir") + 1]).resolve()


def load_env():
    env = {}
    p = ROOT / ".env"
    if p.exists():
        for line in p.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    env.update({k: v for k, v in os.environ.items() if k.startswith("SUPABASE_")})
    return env


ENV = load_env()
URL = ENV.get("SUPABASE_URL", "").rstrip("/")
KEY = ENV.get("SUPABASE_SERVICE_ROLE_KEY", "")
if not URL or not KEY:
    sys.exit("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env first.")


def request(method, path, body=None, prefer=None):
    headers = {"apikey": KEY, "Content-Type": "application/json"}
    if KEY.startswith("eyJ"):  # legacy JWT keys also go in Authorization
        headers["Authorization"] = f"Bearer {KEY}"
    if prefer:
        headers["Prefer"] = prefer
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(f"{URL}/rest/v1/{path}", data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status
    except urllib.error.HTTPError as e:
        sys.exit(f"{method} {path} failed: HTTP {e.code} {e.read().decode()[:300]}")


def upsert(table, rows, chunk=200):
    for i in range(0, len(rows), chunk):
        request("POST", table, rows[i:i + chunk], prefer="resolution=merge-duplicates,return=minimal")
    print(f"  {table}: {len(rows)} rows")


def read_bank(path):
    rows = []
    with open(path, newline="") as f:
        for r in csv.DictReader(f):
            rows.append({
                "id": r["id"], "statement_month": r["statement_month"], "date": r["date"],
                "amount": float(r["amount"]), "payer_name": r["payer_name"], "reference": r["reference"],
                "case_type": r["case_type"], "true_allocations": json.loads(r["true_allocations"]),
                "true_unallocated": float(r["true_unallocated"]),
            })
    return rows


def main():
    print(f"Loading {SEED.relative_to(ROOT)} into {URL}")
    upsert("tenants", json.loads((SEED / "tenants.json").read_text()))
    upsert("charges", json.loads((SEED / "charges.json").read_text()))
    upsert("company_lookup", json.loads((SEED / "company_lookup.json").read_text()))
    request("DELETE", "tenant_notes?id=gte.0", prefer="return=minimal")
    upsert("tenant_notes", json.loads((SEED / "tenant_notes.json").read_text()))
    if "--with-bank" in sys.argv:
        for name in ("bank_2026_09.csv", "bank_2026_10.csv"):
            upsert("bank_lines", read_bank(SEED / name))
    print("Done.")


if __name__ == "__main__":
    main()
