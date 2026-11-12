#!/usr/bin/env python3
"""Seed data generator for the Cash Application Agent (Handoff 1, "Data generator").

Python 3 stdlib only. Fully deterministic (seed 42 for the two spec months,
seed 4242 for the held-out November month).

    python3 data/generate.py                    # uses Cortile if present
    python3 data/generate.py --cortile PATH     # explicit Cortile SQLite
    python3 data/generate.py --cortile none     # force synthetic names

Outputs (data/seed/, git-ignored because it carries Cortile-derived data):
    tenants.json, charges.json (2026-09 + 2026-10), bank_2026_09.csv,
    bank_2026_10.csv, tenant_notes.json, company_lookup.json
    holdout/charges_2026_11.json, holdout/bank_2026_11.csv,
    holdout/tenant_notes_2026_11.json   (score once at the end, never tune on it)

All amounts are synthetic. Cortile supplies ids, names, units, floor areas,
lease dates and tickets; rent, service charge and payment terms are layered on top.
"""
import argparse
import csv
import json
import os
import random
import re
import sqlite3
import sys
from datetime import date, datetime, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_DB = os.path.join(HERE, "private", "cortile-hackathon.sqlite")
DEFAULT_OUT = os.path.join(HERE, "seed")

N_TENANTS = 108
SEED = 42
HOLDOUT_SEED = 4242

# --------------------------------------------------------------------------
# Helpers that mirror Handoff 2 (lib/engine) exactly
# --------------------------------------------------------------------------
NAME_SUFFIXES = ("LIMITED", "LTD", "PLC", "LLP", "UK")


def norm(s):
    return re.sub(r"[^A-Z0-9]", "", (s or "").upper())


def norm_name(s):
    n = norm(s)
    changed = True
    while changed:
        changed = False
        for suf in NAME_SUFFIXES:
            if n.endswith(suf) and len(n) > len(suf):
                n = n[: -len(suf)]
                changed = True
                break
    return n


def name_match(payer, tenant):
    a, b = norm_name(payer), norm_name(tenant)
    if not a or not b:
        return False
    if a == b:
        return True
    short, long_ = sorted((a, b), key=len)
    return long_.startswith(short) and len(short) >= 8


def prefix_related(a, b):
    """Stricter than name_match: any prefix relation at all, any length."""
    x, y = norm_name(a), norm_name(b)
    return bool(x and y and (x.startswith(y) or y.startswith(x)))


def gbp(p):
    return "%d.%02d" % divmod(p, 100)


def money(p):
    return round(p / 100.0, 2)


# --------------------------------------------------------------------------
# Tenant sources
# --------------------------------------------------------------------------
CORE_CITIES = {"Manchester", "Leeds", "Birmingham", "Bristol", "Cambridge", "Brighton", "Reading", "Salford"}
NEW_SUFFIXES = ["Developments", "Commercial", "Retail", "Ventures"]
SYN_FIRST = ["Allied", "Anchor", "Apex", "Beacon", "Central", "Clearview", "Crest", "Granite", "Harbour",
             "Keystone", "Liberty", "Metro", "Pennant", "Pioneer", "Premier", "Shield", "Sterling",
             "Summit", "Swift", "Vertex", "Oakmere", "Halden", "Northgate", "Fairway", "Larkspur", "Redwell"]
SYN_SUFFIX = ["Estates", "Investments", "Lettings", "Property Holdings"] + NEW_SUFFIXES
SYN_PLACES = [("Cedar House", "Southbank Square", "Manchester"), ("Block A", "Station Reach", "Cambridge"),
              ("Merlin Court", "Lark Gardens", "Birmingham"), ("Gorse House", "Orchard Village", "London"),
              ("Teal Court", "Orchard Village", "London"), ("Quay House", "Riverside Wharf", "Leeds"),
              ("Mill Building", "Canal Basin", "Bristol"), ("Spire House", "Old Market", "Newcastle upon Tyne")]
COMMUNAL_CATS = ["lift_breakdown", "communal_lighting", "cleaning", "leak", "door_entry",
                 "heating_and_hot_water", "security_and_locks", "drainage", "roof_and_gutters"]


def load_cortile(db_path, rng):
    con = sqlite3.connect("file:%s?mode=ro" % db_path, uri=True)
    rows = con.execute(
        """select u.id, u.unit_number, u.floor_area_sqm, u.building_id, b.name, d.name, b.city,
                  l.id, l.leaseholder_name, l.lease_start_date, l.term_years
           from units u join leases l on l.unit_id = u.id
           join buildings b on b.id = u.building_id
           join developments d on d.id = b.development_id
           where u.type = 'commercial' and u.tenure = 'commercial_lease'
           order by u.id, l.id""").fetchall()
    seen_units, units = set(), []
    for r in rows:
        if r[0] not in seen_units:
            seen_units.add(r[0])
            units.append(r)
    rng.shuffle(units)

    picked, used_names, rest = [], set(), []
    for r in units:
        if r[8] and r[8] not in used_names and len(picked) < N_TENANTS:
            used_names.add(r[8])
            picked.append((r, r[8], "cortile"))
        else:
            rest.append(r)
    # Cortile has only 78 distinct commercial leaseholder names. Fill the rest with
    # distinct synthetic names in the same style, on real Cortile units and lease ids.
    pool = sorted({"%s %s Ltd" % (w, s) for w in sorted({n.split()[0] for n in used_names})
                   for s in NEW_SUFFIXES + ["Estates"]} - used_names)
    rng.shuffle(pool)
    for r in rest:
        if len(picked) >= N_TENANTS:
            break
        while pool:
            cand = pool.pop()
            if not any(prefix_related(cand, n) for n in used_names):
                used_names.add(cand)
                picked.append((r, cand, "synthetic_name"))
                break
    if len(picked) < N_TENANTS:
        raise SystemExit("Not enough Cortile commercial units to build %d tenants" % N_TENANTS)

    tenants = []
    for r, name, src in picked:
        uid, unit_no, area, bld_id, bname, dname, city, lid, cortile_name, start, term = r
        tenants.append(dict(name=name, name_source=src, cortile_leaseholder=cortile_name,
                            unit="%s, %s (%s), %s" % (unit_no, bname, dname, city),
                            lease_id=lid, area=area, city=city, building_id=bld_id, building=bname,
                            lease_start=start, term=term))
    return con, tenants


def synthetic_tenants(rng):
    names = ["%s %s Ltd" % (w, s) for w in SYN_FIRST for s in SYN_SUFFIX]
    rng.shuffle(names)
    tenants, used = [], []
    for nm in names:
        if len(tenants) >= N_TENANTS:
            break
        if any(prefix_related(nm, u) for u in used):
            continue
        used.append(nm)
        bname, dname, city = rng.choice(SYN_PLACES)
        i = len(tenants) + 1
        start = date(rng.randint(2005, 2024), rng.randint(1, 12), rng.randint(1, 28))
        tenants.append(dict(name=nm, name_source="synthetic", cortile_leaseholder=None,
                            unit="Unit %d, %s (%s), %s" % (rng.randint(1, 12), bname, dname, city),
                            lease_id="SYN-L-%04d" % i, area=round(rng.uniform(80, 300), 1), city=city,
                            building_id=None, building=bname, lease_start=start.isoformat(),
                            term=rng.choice([10, 15, 20, 25])))
    return tenants


# --------------------------------------------------------------------------
# Amounts, payer names, group names
# --------------------------------------------------------------------------
def rate_for(city):
    if city == "London":
        return 380
    if city in CORE_CITIES:
        return 240
    return 175


def assign_amounts(tenants, rng):
    used = set()
    for t in tenants:
        annual = round(t["area"] * rate_for(t["city"]) * rng.uniform(0.92, 1.08) / 50.0) * 50
        rent = min(max(round(annual * 100 / 12.0), 120000), 980000)
        step = 1 if rent < 980000 else -1
        while rent in used:
            rent += step
        used.add(rent)
        sc = round(rent * rng.uniform(0.085, 0.145))
        while sc in used or sc == 25000 or not (0.08 * rent <= sc <= 0.15 * rent):
            sc += 1 if sc < 0.15 * rent else -1
        used.add(sc)
        t["rent_p"], t["sc_p"] = rent, sc


def bank_payer_name(t, tenants, rng):
    base = re.sub(r"\s+(Ltd|Limited|PLC|LLP)\.?$", "", t["name"], flags=re.I).upper()
    options = [" LTD", " LIMITED", " LTD", "", " LTD."]
    rng.shuffle(options)
    for suf in options + [""]:
        s = (base + suf)[:18].rstrip()
        hits = [o for o in tenants if name_match(s, o["name"])]
        if len(hits) == 1 and hits[0] is t:
            return s
    raise SystemExit("No unambiguous bank payer name for %s" % t["name"])


def group_name_options(t, tenants):
    w = t["name"].split()[0].upper()
    opts = ["%s GROUP PLC" % w, "%s GROUP HLDGS" % w, "%s HOLDINGS PLC" % w, "%s GRP PLC" % w]
    return [o for o in opts if len(o) <= 18 and not any(prefix_related(o, x["name"]) for x in tenants)]


# --------------------------------------------------------------------------
# Month generator
# --------------------------------------------------------------------------
MONTHS = {9: ("SEPT", "September"), 10: ("OCT", "October"), 11: ("NOV", "November")}
UNKNOWN_PAYERS = ["MR J R ASHWORTH", "D K MENSAH", "MRS P OYELARAN", "S NOVAKOVIC", "A G FERREIRA",
                  "MR T HALLORAN", "R B CHAUDHRY", "MS L KOWALCZYK", "K J MBEKI", "MR O LINDQVIST"]


def inv_ref(yymm, tnum, kind):
    return "INV-%s-%03d-%s" % (yymm, tnum, kind)


def clean_reference(ref, mon, kind, rng):
    word = "RENT" if kind == "R" else rng.choice(["SERV CHG", "SC", "SERVICE CHARGE"])
    variants = ["%s %s %s" % (ref, mon, word), ref.lower().replace("-", ""), ref.replace("-", ""),
                ref.replace("-", " "), "%s %s" % (word, ref), "PAYMENT %s" % ref, "%s %s" % (ref, mon), ref]
    return rng.choice(variants)


def fmt_long(d):
    return "%d %s" % (d.day, d.strftime("%B %Y"))


def find_ticket(con, building_id, start, end, rng, exclude=()):
    if con is None or building_id is None:
        return None
    rows = con.execute(
        """select id, category, title, reported_at from tickets
           where building_id = ? and reported_at >= ? and reported_at < ?
           order by id""", (building_id, start.isoformat(), end.isoformat())).fetchall()
    rows = [r for r in rows if r[0] not in exclude]
    for cats in (COMMUNAL_CATS[:3], COMMUNAL_CATS):
        pref = [r for r in rows if r[1] in cats]
        if pref:
            return rng.choice(pref)
    return None


GENERIC_REASONS = ["says the communal cleaning contract was not delivered for most of the month",
                   "says the lift was out of service for over a week",
                   "says the corridor lighting was out for most of the month"]


def gen_month(year, month, tenants, rng, con, group_names, payer_names, dup_exclude, forbidden_amounts):
    yymm = "%02d%02d" % (year % 100, month)
    period = "%d-%02d" % (year, month)
    due = date(year, month, 1)
    mon, mon_long = MONTHS[month]
    tid = lambda i: "T%03d" % i
    T = {tid(i + 1): t for i, t in enumerate(tenants)}

    charges = []
    for i in range(1, N_TENANTS + 1):
        t = T[tid(i)]
        for kind, ctype, amt in (("R", "rent", t["rent_p"]), ("S", "service_charge", t["sc_p"])):
            ref = inv_ref(yymm, i, kind)
            charges.append(dict(id=ref, tenant_id=tid(i), type=ctype, period=period, amount_due=money(amt),
                                amount_paid=0, due_date=due.isoformat(), invoice_ref=ref))

    lines, notes = [], []

    def rand_date(lo=-3, hi=12):
        return due + timedelta(days=rng.randint(lo, hi))

    def add(d, amt, payer, ref, case, allocs, unalloc, tenant=None):
        lines.append(dict(date=d, amount_p=amt, payer_name=payer, reference=ref, case_type=case,
                          allocs=allocs, unalloc_p=unalloc, tenant=tenant))
        return lines[-1]

    dup_candidates = [i for i in range(1, 86) if i not in dup_exclude and i != 12]
    dup_tenants = sorted(rng.sample(dup_candidates, 2)) if dup_exclude else [10, 20]

    # T001-T085 clean, T086-T089 parent payer: rent and SC as two exact lines
    rent_lines = {}
    for i in range(1, 90):
        t, n = T[tid(i)], tid(i)
        rref, sref = inv_ref(yymm, i, "R"), inv_ref(yymm, i, "S")
        d_r = rand_date(-3, 7) if i in dup_tenants else rand_date()
        d_s = d_r if rng.random() < 0.7 else rand_date()
        if i <= 85:
            payer, case = payer_names[n], "clean"
            r_ref, s_ref = clean_reference(rref, mon, "R", rng), clean_reference(sref, mon, "S", rng)
        else:
            payer, case = group_names[n], "parent_payer"
            r_ref = rng.choice(["RENT %s", "%s RENT", "RENT %s PAYMENT"]) % mon
            s_ref = rng.choice(["SERVICE CHG %s", "%s SC", "SERV CHARGE %s"]) % mon
        rent_lines[i] = add(d_r, t["rent_p"], payer, r_ref, case, [(rref, t["rent_p"])], 0, n)
        add(d_s, t["sc_p"], payer, s_ref, case, [(sref, t["sc_p"])], 0, n)

    # T090-T094 combined
    for i in range(90, 95):
        t, n = T[tid(i)], tid(i)
        ref = rng.choice(["%s RENT AND SC", "RENT+SERVICE CHG", "%s PAYMENT", "MONTHLY PAYMENT",
                          "RENT SC %s"]).replace("%s", mon)
        add(rand_date(), t["rent_p"] + t["sc_p"], payer_names[n], ref, "combined",
            [(inv_ref(yymm, i, "R"), t["rent_p"]), (inv_ref(yymm, i, "S"), t["sc_p"])], 0, n)

    # T095-T099 short-pay with a dispute note
    for i in range(95, 100):
        t, n = T[tid(i)], tid(i)
        x = round(t["sc_p"] * rng.uniform(0.18, 0.6))
        x = max(500, min(x, t["sc_p"] - 100))
        pay_d = rand_date(0, 12)
        email_d = pay_d - timedelta(days=rng.randint(1, 9))
        prev_month_start = (due - timedelta(days=1)).replace(day=1)
        tk = find_ticket(con, t["building_id"], prev_month_start, email_d, rng, t.get("tickets", ()))
        if tk:
            rep = datetime.strptime(tk[3][:10], "%Y-%m-%d").date()
            reason = ("Tenant cites \"%s\" at %s (Cortile ticket %s, %s, reported %s) and is withholding "
                      "that part of the charge until it is credited." % (tk[2], t["building"], tk[0], tk[1], fmt_long(rep)))
            t.setdefault("tickets", []).append(tk[0])
        else:
            reason = "Tenant %s and is withholding that part of the charge." % rng.choice(GENERIC_REASONS)
        note = "Disputing £%s of %s service charge, email of %s. %s" % (gbp(x), mon_long, fmt_long(email_d), reason)
        notes.append(dict(tenant_id=n, date=email_d.isoformat(), note=note))
        ref = rng.choice(["%s RENT LESS DISPUTE", "RENT+SC %s PART", "SEE EMAIL RE SC", "%s RENT SC NET"]).replace("%s", mon)
        add(pay_d, t["rent_p"] + t["sc_p"] - x, payer_names[n], ref, "short_pay",
            [(inv_ref(yymm, i, "R"), t["rent_p"]), (inv_ref(yymm, i, "S"), t["sc_p"] - x)], 0, n)

    # T100-T102 bad references
    t, n = T["T100"], "T100"
    add(rand_date(), t["rent_p"], payer_names[n], "", "bad_reference", [(inv_ref(yymm, 100, "R"), t["rent_p"])], 0, n)
    add(rand_date(), t["sc_p"], payer_names[n], "", "bad_reference", [(inv_ref(yymm, 100, "S"), t["sc_p"])], 0, n)
    t, n = T["T101"], "T101"
    aug = "26%02d" % 8  # August 2026 invoices do not exist in this data set
    add(rand_date(), t["rent_p"], payer_names[n], "%s %s" % (inv_ref(aug, 101, "R"), mon), "bad_reference",
        [(inv_ref(yymm, 101, "R"), t["rent_p"])], 0, n)
    add(rand_date(), t["sc_p"], payer_names[n], inv_ref(aug, 101, "S"), "bad_reference",
        [(inv_ref(yymm, 101, "S"), t["sc_p"])], 0, n)
    t, n = T["T102"], "T102"
    add(rand_date(), t["rent_p"], payer_names[n], "%s %s RENT" % (inv_ref(yymm, 12, "R"), mon), "bad_reference",
        [(inv_ref(yymm, 102, "R"), t["rent_p"])], 0, n)

    # T103-T105 overpayment: rent + 250.00, correct reference
    for i in range(103, 106):
        t, n = T[tid(i)], tid(i)
        add(rand_date(), t["rent_p"] + 25000, payer_names[n], "%s %s RENT" % (inv_ref(yymm, i, "R"), mon),
            "overpayment", [(inv_ref(yymm, i, "R"), t["rent_p"])], 25000, n)

    # Duplicates: exact copies of two rent lines, a few days later
    for i in dup_tenants:
        o = rent_lines[i]
        d = min(o["date"] + timedelta(days=rng.randint(2, 5)), due + timedelta(days=12))
        add(d, o["amount_p"], o["payer_name"], o["reference"], "duplicate", [], o["amount_p"], tid(i))

    # Unidentifiable: unknown payer, no reference, amount equal to no charge and no pair
    for payer in rng.sample(UNKNOWN_PAYERS, 2):
        while True:
            amt = rng.randint(150000, 720000)
            if amt not in forbidden_amounts and all(amt != l["amount_p"] for l in lines):
                break
        add(rand_date(), amt, payer, "", "unidentifiable", [], amt, None)

    # Sort by date, deterministic tiebreak, assign ids
    rng.shuffle(lines)
    lines.sort(key=lambda l: l["date"])
    for k, l in enumerate(lines, 1):
        l["id"] = "B%s-%03d" % (yymm, k)
        l["statement_month"] = period
    return charges, lines, notes, dup_tenants


# --------------------------------------------------------------------------
# Output
# --------------------------------------------------------------------------
BANK_COLS = ["id", "statement_month", "date", "amount", "payer_name", "reference", "case_type",
             "true_allocations", "true_unallocated"]


def write_json(path, obj):
    with open(path, "w") as f:
        json.dump(obj, f, indent=2, ensure_ascii=False)
        f.write("\n")


def write_bank(path, lines):
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(BANK_COLS)
        for l in lines:
            allocs = json.dumps([{"charge_id": c, "amount": money(a)} for c, a in l["allocs"]], separators=(",", ":"))
            w.writerow([l["id"], l["statement_month"], l["date"].isoformat(), gbp(l["amount_p"]), l["payer_name"],
                        l["reference"], l["case_type"], allocs, gbp(l["unalloc_p"])])


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cortile", default=DEFAULT_DB, help="Cortile SQLite path ('none' = synthetic names)")
    ap.add_argument("--out", default=DEFAULT_OUT)
    args = ap.parse_args()

    rng = random.Random(SEED)
    con = None
    if args.cortile != "none" and os.path.exists(args.cortile):
        con, tenants = load_cortile(args.cortile, rng)
        mode = "cortile (%s)" % args.cortile
    else:
        tenants = synthetic_tenants(rng)
        mode = "SYNTHETIC: Cortile DB not found at %s, using made-up company names" % args.cortile
        print("WARNING: " + mode, file=sys.stderr)

    rng.shuffle(tenants)
    # T086-T089 need a parent-group payer name that fits 18 chars, does not prefix-match
    # any tenant name, and has a distinct first word from the other three.
    slots = list(range(85, 89))
    for s in slots:
        firsts = {tenants[k]["name"].split()[0] for k in slots if k != s}
        if group_name_options(tenants[s], tenants) and tenants[s]["name"].split()[0] not in firsts:
            continue
        for k in range(84, -1, -1):
            c = tenants[k]
            if group_name_options(c, tenants) and c["name"].split()[0] not in firsts:
                tenants[s], tenants[k] = tenants[k], tenants[s]
                break
    # T095-T099 (short-pay) should sit in buildings with a communal Cortile ticket in
    # August 2026, so the September dispute note can cite a real ticket.
    if con is not None:
        def has_ticket(t):
            q = "select count(*) from tickets where building_id=? and reported_at>=? and reported_at<? and category in (%s)" % (
                ",".join("?" * len(COMMUNAL_CATS)))
            return con.execute(q, [t["building_id"], "2026-08-01", "2026-08-29"] + COMMUNAL_CATS).fetchone()[0] > 0
        for s in range(94, 99):
            if has_ticket(tenants[s]):
                continue
            for k in range(84, -1, -1):
                if has_ticket(tenants[k]):
                    tenants[s], tenants[k] = tenants[k], tenants[s]
                    break
    assign_amounts(tenants, rng)

    ids = ["T%03d" % (i + 1) for i in range(N_TENANTS)]
    payer_names = {ids[i]: bank_payer_name(t, tenants, rng) for i, t in enumerate(tenants)}
    group_names = {ids[s]: rng.choice(group_name_options(tenants[s], tenants)) for s in slots}

    amounts = sorted({t["rent_p"] for t in tenants} | {t["sc_p"] for t in tenants})
    forbidden = set(amounts)
    for i, a in enumerate(amounts):
        for b in amounts[i:]:
            forbidden.add(a + b)

    tenants_out = []
    for i, t in enumerate(tenants):
        if t["name_source"] == "synthetic":
            cit = ("Synthetic lease %s (%s, from %s, %d years): rent monthly in advance, due 1st; "
                   "service charge monthly in advance." % (t["lease_id"], t["name"], t["lease_start"], t["term"]))
        else:
            cit = ("Cortile lease %s (%s, from %s, %d years): rent monthly in advance, due 1st; "
                   "service charge monthly in advance. Synthetic terms layered on Cortile ids."
                   % (t["lease_id"], t["name"], t["lease_start"], t["term"]))
        tenants_out.append(dict(id=ids[i], name=t["name"], unit=t["unit"], lease_id=t["lease_id"], lease_citation=cit))

    os.makedirs(os.path.join(args.out, "holdout"), exist_ok=True)
    all_charges, all_notes, summary, used_dups = [], [], [], set()
    for (y, m) in ((2026, 9), (2026, 10)):
        ch, lines, notes, dups = gen_month(y, m, tenants, rng, con, group_names, payer_names, used_dups, forbidden)
        used_dups.update(dups)
        all_charges += ch
        all_notes += notes
        write_bank(os.path.join(args.out, "bank_%d_%02d.csv" % (y, m)), lines)
        summary.append(("bank_%d_%02d.csv" % (y, m), len(lines), "dups " + ",".join("T%03d" % d for d in dups)))

    company_lookup = [dict(payer_name=group_names[k], group_members=[tenants_out[int(k[1:]) - 1]["name"]],
                           source="company lookup (stub)") for k in sorted(group_names)]
    write_json(os.path.join(args.out, "tenants.json"), tenants_out)
    write_json(os.path.join(args.out, "charges.json"), all_charges)
    write_json(os.path.join(args.out, "tenant_notes.json"), all_notes)
    write_json(os.path.join(args.out, "company_lookup.json"), company_lookup)

    # Held-out month: own RNG so the two spec months are unaffected.
    hrng = random.Random(HOLDOUT_SEED)
    ch, lines, notes, dups = gen_month(2026, 11, tenants, hrng, con, group_names, payer_names, used_dups, forbidden)
    hdir = os.path.join(args.out, "holdout")
    write_json(os.path.join(hdir, "charges_2026_11.json"), ch)
    write_json(os.path.join(hdir, "tenant_notes_2026_11.json"), notes)
    write_bank(os.path.join(hdir, "bank_2026_11.csv"), lines)

    print("mode: %s" % mode)
    print("tenants.json        %4d  (%d Cortile names, %d synthetic names)" % (
        len(tenants_out), sum(t["name_source"] == "cortile" for t in tenants),
        sum(t["name_source"] != "cortile" for t in tenants)))
    print("charges.json        %4d" % len(all_charges))
    for name, n, extra in summary:
        print("%-19s %4d  (%s)" % (name, n, extra))
    print("tenant_notes.json   %4d" % len(all_notes))
    print("company_lookup.json %4d" % len(company_lookup))
    print("holdout/            charges %d, bank lines %d, notes %d (dups %s, seed %d)" % (
        len(ch), len(lines), len(notes), ",".join("T%03d" % d for d in dups), HOLDOUT_SEED))


if __name__ == "__main__":
    main()
