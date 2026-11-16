#!/usr/bin/env python3
"""Validate built course data: python3 tools/validate.py [--no-audio]"""
import glob, json, os, re, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
from build import slug, word_core
MAXW = {"A1": 9, "A2": 10, "B1": 12, "B2": 13, "C1": 14, "C2": 14}
FA = re.compile(r"[\u0600-\u06FF]")
errs, seen = [], {}
course = json.load(open(os.path.join(ROOT, "data", "course.json"), encoding="utf-8"))
plan = [l.strip() for l in open(os.path.join(ROOT, "content", "plan.txt"), encoding="utf-8") if l.strip() and not l.startswith("#")]
audio = "--no-audio" not in sys.argv
def need(path, what):
    p = os.path.join(ROOT, path)
    if not os.path.exists(p) or os.path.getsize(p) < 1000:
        errs.append(f"missing audio {path} ({what})")
stats = {}
for lv in course["levels"]:
    for meta in lv["lessons"]:
        n = meta["id"]
        plv, _, ptitle = [x.strip() for x in plan[n - 1].partition("|")]
        if plv != lv["id"]:
            errs.append(f"lesson {n}: level {lv['id']} != plan {plv}")
        if meta.get("locked"):
            continue
        L = json.load(open(os.path.join(ROOT, "data", "lessons", f"{n:03d}.json"), encoding="utf-8"))
        st = stats.setdefault(lv["id"], [0, 0])
        st[0] += 1; st[1] += len(L["sentences"])
        if not 10 <= len(L["sentences"]) <= 14:
            errs.append(f"lesson {n}: {len(L['sentences'])} sentences")
        for s in L["sentences"]:
            nl = s["nl"]
            m = re.match(r"^(.*?)([.?!]+)$", nl)
            if not m:
                errs.append(f"{n}: no end punctuation: {nl}"); continue
            toks = m.group(1).split(" ")
            if " ".join(toks) + m.group(2) != nl or any(not t or not word_core(t) for t in toks):
                errs.append(f"{n}: tiles do not rebuild: {nl!r}")
            if len(toks) > MAXW[lv["id"]]:
                errs.append(f"{n}: {len(toks)} words > {MAXW[lv['id']]}: {nl}")
            if not FA.search(s.get("fa", "")):
                errs.append(f"{n}: no Persian meaning: {nl}")
            if not FA.search(s.get("pr", "")):
                errs.append(f"{n}: no reading: {nl}")
            for t in toks:
                c = word_core(t).lower()
                if not FA.search(L["pron"].get(c, "")):
                    errs.append(f"{n}: no word reading for {c!r}")
                if audio: need("audio/w-" + slug(word_core(t)) + ".mp3", t)
            key = re.sub(r"[^a-z0-9' ]", "", nl.lower())
            if key in seen:
                errs.append(f"{n}: duplicate sentence (also lesson {seen[key]}): {nl}")
            seen.setdefault(key, n)
            if audio: need("audio/s-" + slug(nl) + ".mp3", nl)
        if len(L["reading"]) < 4:
            errs.append(f"{n}: reading has {len(L['reading'])} lines")
        for r in L["reading"]:
            if not FA.search(r.get("fa", "")) or not FA.search(r.get("pr", "")):
                errs.append(f"{n}: reading line lacks fa/pr: {r['nl']}")
            if audio: need(r["audio"], r["nl"])
print("per level (lessons, sentences):", stats)
print("total:", sum(v[0] for v in stats.values()), "lessons,", sum(v[1] for v in stats.values()), "sentences")
if errs:
    print(f"{len(errs)} ERRORS"); print("\n".join(errs[:80])); sys.exit(1)
print("VALID")
