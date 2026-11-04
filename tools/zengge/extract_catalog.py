"""Regenerate lib/zengge/protocol/productCatalog.ts from a decompiled Surplife APK.

Usage: python3 -I tools/zengge/extract_catalog.py /path/to/Surplife_sourcecode

Reads (as data only, nothing is executed):
  resources/assets/flutter_assets/packages/magichome2_home_data_provide/assets/ble_devices.json
  resources/assets/flutter_assets/packages/zg_app_builtin_assest/assets/js_bundle/60_surplife.js
    -> the `bleDevices=[...]` and `wifiDevices=[...]` object literals, converted to JSON textually
"""
import json, re, sys, os

root = sys.argv[1]
assets = os.path.join(root, 'resources/assets/flutter_assets/packages')
a = json.load(open(os.path.join(assets, 'magichome2_home_data_provide/assets/ble_devices.json')))
s = open(os.path.join(assets, 'zg_app_builtin_assest/assets/js_bundle/60_surplife.js'), encoding='utf-8').read()

def extract(name):
    i = s.index(name + '=[') + len(name) + 1
    depth, j, in_str = 0, i, False
    while True:
        c = s[j]
        if in_str:
            if c == '\\': j += 2; continue
            if c == '"': in_str = False
        elif c == '"': in_str = True
        elif c in '[{': depth += 1
        elif c in ']}':
            depth -= 1
            if depth == 0: break
        j += 1
    lit = re.sub(r'!0\b', 'true', s[i:j + 1])
    lit = re.sub(r'!1\b', 'false', lit)
    lit = re.sub(r'([{,])([A-Za-z_$][\w$]*):', r'\1"\2":', lit)
    return json.loads(lit)

cat = {}
# BLE tables first; the Wi-Fi/BLE combo table fills in products such as 0x86 (Quntis).
for src in (a, extract('bleDevices'), extract('wifiDevices')):
    for x in src:
        e = cat.setdefault(x['productId'], {'categoryCode': x.get('categoryCode'), 'protocols': {}, 'stateProtocols': set()})
        for p in x.get('protocols', []): e['protocols'].setdefault(p['name'], p.get('deviceMinVer', 0))
        for p in x.get('stateProtocol', []): e['stateProtocols'].add(p['name'])

out = ['  0x%02x: { categoryCode: %s, protocols: { %s }, stateProtocols: %s },' % (
    pid, json.dumps(e['categoryCode']), ', '.join('%s: %d' % (json.dumps(k), v) for k, v in e['protocols'].items()),
    json.dumps(sorted(e['stateProtocols']))) for pid, e in sorted(cat.items())]
path = os.path.join(os.path.dirname(__file__), '..', '..', 'lib/zengge/protocol/productCatalog.ts')
src = open(path).read()
head = src[:src.index('export const PRODUCT_CATALOG')]
open(path, 'w').write(head + 'export const PRODUCT_CATALOG: Record<number, CatalogEntry> = {\n' + '\n'.join(out) + '\n};\n')
print(f'{len(cat)} products written to {path}')
