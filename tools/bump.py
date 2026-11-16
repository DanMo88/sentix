#!/usr/bin/env python3
"""Bump the app/cache version everywhere: python3 tools/bump.py"""
import os, re
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ip, sp = os.path.join(ROOT, "index.html"), os.path.join(ROOT, "sw.js")
h = open(ip, encoding="utf-8").read()
v = int(re.search(r'DS_VERSION = "(\d+)"', h).group(1)); n = v + 1
h = h.replace(f"?v={v}", f"?v={n}").replace(f'DS_VERSION = "{v}"', f'DS_VERSION = "{n}"')
open(ip, "w", encoding="utf-8").write(h)
s = open(sp, encoding="utf-8").read().replace(f"'sf-v{v}'", f"'sf-v{n}'").replace(f"?v={v}", f"?v={n}")
open(sp, "w", encoding="utf-8").write(s)
print(n)
