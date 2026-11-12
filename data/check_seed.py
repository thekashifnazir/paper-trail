#!/usr/bin/env python3
"""Validate data/seed/ against Handoff 1 (data generator) and Handoff 2 (engine helpers).

    python3 data/check_seed.py [--seed-dir data/seed]

Exits 1 if any check fails. Also simulates engine passes 1a/1b/1c to show
which lines the deterministic rules would settle.
"""
import argparse
import csv
import json
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import date, timedelta
from itertools import combinations

HERE = os.path.dirname(os.path.abspath(__file__))
EXPECTED = {"clean": 170, "parent_payer": 8, "combined": 5, "short_pay": 5, "bad_reference": 5,
            "overpayment": 3, "duplicate": 2, "unidentifiable": 2}
TENANT_FIELDS = ["id", "name", "unit", "lease_id", "lease_citation"]
CHARGE_FIELDS = ["id", "tenant_id", "type", "period", "amount_due", "amount_paid", "due_date", "invoice_ref"]
MONTH_NAMES = {"09": "September", "10": "October", "11": "November"}


def norm(s):
    return re.sub(r"[^A-Z0-9]", "", (s or "").upper())


def norm_name(s):
    n, changed = norm(s), True
    while changed:
        changed = False
        for suf in ("LIMITED", "LTD", "PLC", "LLP", "UK"):
            if n.endswith(suf) and len(n) > len(suf):
                n, changed = n[: -len(suf)], True
                break
    return n


def name_match(a, b):
    x, y = norm_name(a), norm_name(b)
    if not x or not y:
        return False
    if x == y:
        return True
    s, l = sorted((x, y), key=len)
    return l.startswith(s) and len(s) >= 8


def p(x):
    return int(round(float(x) * 100))


class Report:
    def __init__(self):
        self.rows, self.failed = [], 0

    def check(self, scope, name, ok, detail=""):
        self.rows.append((scope, name, "PASS" if ok else "FAIL", detail))
        if not ok:
            self.failed += 1

    def show(self):
        w = max(len(r[1]) for r in self.rows)
        for scope, name, st, detail in self.rows:
            print("%-8s %-*s %s  %s" % (scope, w, name, st, detail))


def load_bank(path):
    with open(path, newline="") as f:
        rows = list(csv.DictReader(f))
    for r in rows:
        r["amount_p"] = p(r["amount"])
        r["allocs"] = [(a["charge_id"], p(a["amount"])) for a in json.loads(r["true_allocations"])]
        r["unalloc_p"] = p(r["true_unallocated"])
    return rows


def simulate_rules(lines, charges, tenants):
    """Engine passes 1a, 1b, 1c from Handoff 2, on this month's charges only."""
    out = {c["id"]: p(c["amount_due"]) for c in charges}
    by_ref = {norm(c["invoice_ref"]): c for c in charges}
    by_tenant = defaultdict(list)
    for c in charges:
        by_tenant[c["tenant_id"]].append(c)
    result, left = {}, []
    for l in lines:  # 1a
        hits = [c for k, c in by_ref.items() if k in norm(l["reference"])]
        if len(hits) == 1 and l["amount_p"] == out[hits[0]["id"]]:
            out[hits[0]["id"]] = 0
            result[l["id"]] = ("1a", [hits[0]["id"]])
        else:
            left.append(l)
    left2 = []
    for l in left:  # 1b
        hits = [c for k, c in by_ref.items() if k in norm(l["reference"])]
        if len(hits) == 1 and l["amount_p"] == p(hits[0]["amount_due"]) and out[hits[0]["id"]] == 0:
            result[l["id"]] = ("1b", [])
        else:
            left2.append(l)
    for l in left2:  # 1c
        ts = [t for t in tenants if name_match(l["payer_name"], t["name"])]
        if len(ts) != 1:
            continue
        open_ = [c for c in by_tenant[ts[0]["id"]] if out[c["id"]] > 0]
        fits = [s for n in range(1, len(open_) + 1) for s in combinations(open_, n)
                if sum(out[c["id"]] for c in s) == l["amount_p"]]
        if len(fits) == 1:
            for c in fits[0]:
                out[c["id"]] = 0
            result[l["id"]] = ("1c", [c["id"] for c in fits[0]])
    return result


def check_month(rep, scope, lines, charges, tenants, notes, lookup, all_amounts, all_charges):
    period = charges[0]["period"]
    yymm = period[2:4] + period[5:7]
    due = date.fromisoformat(charges[0]["due_date"])
    cmap = {c["id"]: c for c in charges}
    tmap = {t["id"]: t for t in tenants}
    ref_to_tenant = {c["id"]: c["tenant_id"] for c in charges}

    rep.check(scope, "exactly 200 lines", len(lines) == 200, str(len(lines)))
    counts = Counter(l["case_type"] for l in lines)
    rep.check(scope, "case_type counts", counts == Counter(EXPECTED),
              " ".join("%s=%d" % (k, counts[k]) for k in EXPECTED))
    rep.check(scope, "line ids unique, B%s-NNN" % yymm,
              len({l["id"] for l in lines}) == 200 and all(re.fullmatch(r"B%s-\d{3}" % yymm, l["id"]) for l in lines))
    rep.check(scope, "statement_month = %s" % period, all(l["statement_month"] == period for l in lines))
    bad_dates = [l["id"] for l in lines if not (due - timedelta(3) <= date.fromisoformat(l["date"]) <= due + timedelta(12))]
    rep.check(scope, "dates within due-3..due+12", not bad_dates, ",".join(bad_dates[:5]))

    unknown = [a for l in lines for a, _ in l["allocs"] if a not in cmap]
    rep.check(scope, "allocations hit existing charges", not unknown, ",".join(unknown[:5]))
    per_charge = Counter()
    over = []
    for l in lines:
        for a, amt in l["allocs"]:
            per_charge[a] += amt
            if a in cmap and amt > p(cmap[a]["amount_due"]):
                over.append(l["id"])
    over += [a for a, s in per_charge.items() if a in cmap and s > p(cmap[a]["amount_due"])]
    rep.check(scope, "no allocation > amount_due", not over, ",".join(over[:5]))
    unbal = [l["id"] for l in lines if sum(a for _, a in l["allocs"]) + l["unalloc_p"] != l["amount_p"]]
    rep.check(scope, "allocs + unallocated = amount", not unbal, ",".join(unbal[:5]))

    def tenant_of(l):
        ts = {ref_to_tenant[a] for a, _ in l["allocs"] if a in ref_to_tenant}
        return ts.pop() if len(ts) == 1 else None

    # Tenant-name payers match exactly their own tenant
    bad = []
    for l in lines:
        if l["case_type"] in ("clean", "combined", "short_pay", "bad_reference", "overpayment"):
            hits = [t["id"] for t in tenants if name_match(l["payer_name"], t["name"])]
            if hits != [tenant_of(l)] or len(l["payer_name"]) > 18:
                bad.append(l["id"])
    rep.check(scope, "payer nameMatches own tenant only", not bad, ",".join(bad[:5]))

    # Clean references carry exactly one invoice ref, the right one
    refs = {norm(c["invoice_ref"]): c["id"] for c in all_charges}
    bad = [l["id"] for l in lines if l["case_type"] == "clean" and
           [v for k, v in refs.items() if k in norm(l["reference"])] != [l["allocs"][0][0]]]
    rep.check(scope, "clean refs contain own invoice ref", not bad, ",".join(bad[:5]))
    bad = [l["id"] for l in lines if l["case_type"] in ("parent_payer", "combined", "short_pay", "unidentifiable")
           and any(k in norm(l["reference"]) for k in refs)]
    rep.check(scope, "vague refs carry no invoice ref", not bad, ",".join(bad[:5]))

    # Case-specific ground truth
    by_t = defaultdict(list)
    for l in lines:
        by_t[tenant_of(l)].append(l)
    t102 = by_t.get("T102", [])
    rep.check(scope, "T102 quotes T012 rent, paid to T102 rent",
              len(t102) == 1 and "INV%s012R" % yymm in norm(t102[0]["reference"])
              and t102[0]["allocs"] == [("INV-%s-102-R" % yymm, p(cmap["INV-%s-102-R" % yymm]["amount_due"]))])
    t100 = by_t.get("T100", [])
    t101 = by_t.get("T101", [])
    rep.check(scope, "T100 no ref, T101 non-existent refs",
              len(t100) == 2 and all(l["reference"] == "" for l in t100) and len(t101) == 2
              and all(re.search(r"INV\d{4}101[RS]", norm(l["reference"])) and
                      not any(k in norm(l["reference"]) for k in refs) for l in t101))
    ov = [l for l in lines if l["case_type"] == "overpayment"]
    rep.check(scope, "overpay: rent in full + 250.00 unalloc",
              all(l["unalloc_p"] == 25000 and len(l["allocs"]) == 1 and l["allocs"][0][0].endswith("-R")
                  and l["allocs"][0][1] == p(cmap[l["allocs"][0][0]]["amount_due"]) for l in ov)
              and sorted(tenant_of(l) for l in ov) == ["T103", "T104", "T105"])
    cb = [l for l in lines if l["case_type"] == "combined"]
    rep.check(scope, "combined: both charges in full",
              all(len(l["allocs"]) == 2 and all(a == p(cmap[c]["amount_due"]) for c, a in l["allocs"]) for l in cb))

    # Short-pay: rent in full, remainder to SC, matching note
    bad = []
    mname = MONTH_NAMES[period[5:7]]
    for l in lines:
        if l["case_type"] != "short_pay":
            continue
        tid = tenant_of(l)
        r, s = "INV-%s-%s-R" % (yymm, tid[1:]), "INV-%s-%s-S" % (yymm, tid[1:])
        x = p(cmap[r]["amount_due"]) + p(cmap[s]["amount_due"]) - l["amount_p"]
        want = "Disputing £%d.%02d of %s service charge, email of " % (x // 100, x % 100, mname)
        ns = [n for n in notes if n["tenant_id"] == tid and n["note"].startswith(want)]
        if not (dict(l["allocs"]).get(r) == p(cmap[r]["amount_due"]) and 0 < x < p(cmap[s]["amount_due"])
                and dict(l["allocs"]).get(s) == p(cmap[s]["amount_due"]) - x and len(ns) == 1
                and ns[0]["date"] < l["date"]):
            bad.append(l["id"])
    rep.check(scope, "short-pay split + dispute note", not bad, ",".join(bad))

    # Parent payers
    bad = []
    lk = {e["payer_name"]: e for e in lookup}
    for l in lines:
        if l["case_type"] != "parent_payer":
            continue
        t = tmap[tenant_of(l)]
        e = lk.get(l["payer_name"])
        if (e is None or e["group_members"] != [t["name"]] or e["source"] != "company lookup (stub)"
                or any(name_match(l["payer_name"], x["name"]) for x in tenants)):
            bad.append(l["id"])
    pp_t = sorted({tenant_of(l) for l in lines if l["case_type"] == "parent_payer"})
    rep.check(scope, "parent payer: lookup ok, no nameMatch", not bad and pp_t == ["T086", "T087", "T088", "T089"],
              ",".join(bad))

    # Duplicates
    bad = []
    for i, l in enumerate(lines):
        if l["case_type"] != "duplicate":
            continue
        orig = [o for o in lines[:i] if o["case_type"] == "clean" and o["date"] < l["date"]
                and (o["amount_p"], o["payer_name"], o["reference"]) == (l["amount_p"], l["payer_name"], l["reference"])
                and o["allocs"] and o["allocs"][0][0].endswith("-R")]
        if len(orig) != 1 or l["allocs"] or l["unalloc_p"] != l["amount_p"]:
            bad.append(l["id"])
    rep.check(scope, "duplicates copy an earlier rent line", not bad, ",".join(bad))

    # Unidentifiable
    singles = set(all_amounts)
    pairs = {a + b for a, b in combinations(all_amounts, 2)} | {2 * a for a in all_amounts}
    bad = []
    for l in lines:
        if l["case_type"] != "unidentifiable":
            continue
        if (l["amount_p"] in singles or l["amount_p"] in pairs or l["allocs"] or l["reference"]
                or any(name_match(l["payer_name"], t["name"]) for t in tenants) or l["payer_name"] in lk):
            bad.append(l["id"])
    rep.check(scope, "unidentifiable: no single/pair/name", not bad, ",".join(bad))

    paid = {tenant_of(l) for l in lines}
    rep.check(scope, "T106-T108 have no lines", not ({"T106", "T107", "T108"} & paid))
    sim = simulate_rules(lines, charges, tenants)
    by_pass = Counter((l["case_type"], sim.get(l["id"], ("agent",))[0]) for l in lines)
    wrong = [l["id"] for l in lines if l["id"] in sim and sim[l["id"]][0] in ("1a", "1c")
             and sorted(sim[l["id"]][1]) != sorted(a for a, _ in l["allocs"])]
    rep.check(scope, "rule passes make no wrong allocation", not wrong, ",".join(wrong))
    dup_t = {t["id"] for l in lines if l["case_type"] == "duplicate" for t in tenants if name_match(l["payer_name"], t["name"])}
    rep.check(scope, "duplicates on 2 distinct tenants", len(dup_t) == 2, ",".join(sorted(dup_t)))
    return by_pass, dup_t


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed-dir", default=os.path.join(HERE, "seed"))
    a = ap.parse_args()
    d = a.seed_dir
    js = lambda *x: json.load(open(os.path.join(d, *x)))
    tenants, charges, notes, lookup = js("tenants.json"), js("charges.json"), js("tenant_notes.json"), js("company_lookup.json")
    rep = Report()

    rep.check("tenants", "108 tenants T001-T108", [t["id"] for t in tenants] == ["T%03d" % i for i in range(1, 109)])
    rep.check("tenants", "fields match schema", all(list(t) == TENANT_FIELDS for t in tenants))
    rep.check("tenants", "names distinct", len({t["name"] for t in tenants}) == 108)
    months = [("2026-09", "bank_2026_09.csv", charges, notes)]
    months.append(("2026-10", "bank_2026_10.csv", charges, notes))
    hold = os.path.join(d, "holdout", "bank_2026_11.csv")
    all_charges = list(charges)
    if os.path.exists(hold):
        hc = js("holdout", "charges_2026_11.json")
        all_charges += hc
        months.append(("2026-11", os.path.join("holdout", "bank_2026_11.csv"), hc, notes + js("holdout", "tenant_notes_2026_11.json")))

    rent = {c["tenant_id"]: p(c["amount_due"]) for c in charges if c["type"] == "rent" and c["period"] == "2026-09"}
    sc = {c["tenant_id"]: p(c["amount_due"]) for c in charges if c["type"] == "service_charge" and c["period"] == "2026-09"}
    rep.check("charges", "fields match schema", all(list(c) == CHARGE_FIELDS for c in all_charges))
    rep.check("charges", "id == invoice_ref, refs unique",
              all(c["id"] == c["invoice_ref"] for c in all_charges) and len({c["id"] for c in all_charges}) == len(all_charges))
    for per in ("2026-09", "2026-10", "2026-11"):
        cs = [c for c in all_charges if c["period"] == per]
        if cs:
            rep.check("charges", "%s: 216 charges, due 1st, R+S each" % per,
                      len(cs) == 216 and all(c["due_date"] == per + "-01" and c["amount_paid"] == 0 for c in cs)
                      and Counter(c["tenant_id"] for c in cs) == Counter({t["id"]: 2 for t in tenants}))
    rep.check("charges", "rent distinct, 1,200-9,800",
              len(set(rent.values())) == 108 and all(120000 <= v <= 980000 for v in rent.values()))
    pct = [sc[t] / rent[t] for t in rent]
    rep.check("charges", "service charge 8-15% of rent", all(0.08 <= x <= 0.15 for x in pct),
              "min %.1f%% max %.1f%%" % (100 * min(pct), 100 * max(pct)))
    rep.check("charges", "amounts same every month",
              all(p(c["amount_due"]) == (rent if c["type"] == "rent" else sc)[c["tenant_id"]] for c in all_charges))
    all_amounts = sorted(set(rent.values()) | set(sc.values()))

    sims, dups = {}, []
    for per, fn, cs, ns in months:
        cs = [c for c in cs if c["period"] == per]
        by_pass, dt = check_month(rep, per, load_bank(os.path.join(d, fn)), cs, tenants, ns, lookup, all_amounts, all_charges)
        sims[per] = by_pass
        dups.append(dt)
    rep.check("all", "duplicate tenants differ by month", all(not (a & b) for a, b in combinations(dups, 2)),
              " | ".join(",".join(sorted(x)) for x in dups))
    rep.show()

    print("\nRule-pass simulation (Handoff 2 passes 1a/1b/1c; 'agent' = left for pass 2/3)")
    for per, bp in sims.items():
        print(" ", per, "  ".join("%s:%s=%d" % (ct, ps, n) for (ct, ps), n in sorted(bp.items())))
    print("\n%d checks, %d failed" % (len(rep.rows), rep.failed))
    sys.exit(1 if rep.failed else 0)


if __name__ == "__main__":
    main()
