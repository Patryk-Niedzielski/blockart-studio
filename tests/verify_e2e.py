import base64, gzip, html, json, re, sys
sys.path.insert(0, 'tests')
src = open('tests/verify.py').read().split('html = open')[0]
exec(src)
res = json.loads(html.unescape(re.search(r'<pre id="out">RESULT:(.*?):END</pre>', open(sys.argv[1]).read(), re.S).group(1)))
bad = 0
for n, ok in res['checks']:
    print(('PASS ' if ok else 'FAIL ') + n); bad += not ok
f = {k: base64.b64decode(v) for k, v in res['files'].items()}
print('files:', {k: len(v) for k, v in f.items()})
schem = next(v for k, v in f.items() if k.endswith('.schem'))
name, r = read_nbt(gzip.decompress(schem))
W, H, L = r['Width'], r['Height'], r['Length']
data = varints(r['BlockData'])
ok = (W, H, L) == (64, 40, 1) and len(data) == W*H*L and max(data) < r['PaletteMax'] and 0 < min(data)
print(('PASS' if ok else 'FAIL'), 'e2e schem', (W, H, L), r['PaletteMax'], 'palette entries'); bad += not ok
lit = next(v for k, v in f.items() if k.endswith('.litematic'))
name, r2 = read_nbt(gzip.decompress(lit))
reg = list(r2['Regions'].values())[0]
ok = reg['Size'] == {'x': 64, 'y': 40, 'z': 1} and r2['Metadata']['TotalBlocks'] == 2560
print(('PASS' if ok else 'FAIL'), 'e2e litematic', reg['Size'], r2['Metadata']['TotalBlocks']); bad += not ok
png = next(v for k, v in f.items() if k.endswith('.png'))
print(('PASS' if png[:8] == b'\x89PNG\r\n\x1a\n' else 'FAIL'), 'png signature')
txt = next(v for k, v in f.items() if k.endswith('.txt')).decode()
print(txt.splitlines()[0]); print('\n'.join(txt.splitlines()[2:5]))
print('ALL PASSED' if not bad else f'{bad} FAILED'); sys.exit(1 if bad else 0)
