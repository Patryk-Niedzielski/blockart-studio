"""Independent NBT reader used to verify files produced by the web app.
Usage: python3 tests/verify.py dump.html"""
import base64, gzip, json, re, struct, sys

def read_nbt(data):
    pos = 0
    def take(n):
        nonlocal pos; b = data[pos:pos+n]; pos += n; return b
    def string():
        n = struct.unpack('>H', take(2))[0]; return take(n).decode('utf-8')
    def payload(t):
        if t == 1: return struct.unpack('>b', take(1))[0]
        if t == 2: return struct.unpack('>h', take(2))[0]
        if t == 3: return struct.unpack('>i', take(4))[0]
        if t == 4: return struct.unpack('>q', take(8))[0]
        if t == 7: n = struct.unpack('>i', take(4))[0]; return take(n)
        if t == 8: return string()
        if t == 9:
            it = take(1)[0]; n = struct.unpack('>i', take(4))[0]; return [payload(it) for _ in range(n)]
        if t == 10:
            d = {}
            while True:
                ct = take(1)[0]
                if ct == 0: return d
                key = string(); d[key] = payload(ct)
        if t == 11: n = struct.unpack('>i', take(4))[0]; return list(struct.unpack(f'>{n}i', take(4*n)))
        if t == 12: n = struct.unpack('>i', take(4))[0]; return list(struct.unpack(f'>{n}q', take(8*n)))
        raise ValueError(t)
    assert take(1)[0] == 10
    name = string()
    root = payload(10)
    assert pos == len(data), 'trailing bytes'
    return name, root

def varints(b):
    out, v, shift = [], 0, 0
    for x in b:
        v |= (x & 0x7f) << shift
        if x & 0x80: shift += 7
        else: out.append(v); v = 0; shift = 0
    return out

def expected(fx, wall):
    W, H = 5, 3
    grid = {}
    for py in range(H):
        for px in range(W):
            v = fx['idx'][py*W+px]
            name = 'minecraft:air' if v < 0 else fx['ids'][v]
            pos = (px, H-1-py, 0) if wall else (px, 0, py)
            grid[pos] = name
    return grid

def check_schem(b, fx, wall):
    name, r = read_nbt(gzip.decompress(b))
    assert name == 'Schematic' and r['Version'] == 2 and r['DataVersion'] == 3465
    W, H, L = r['Width'], r['Height'], r['Length']
    assert (W, H, L) == ((5, 3, 1) if wall else (5, 1, 3)), (W, H, L)
    inv = {v: k for k, v in r['Palette'].items()}
    assert r['PaletteMax'] == len(inv) and inv[0] == 'minecraft:air'
    data = varints(r['BlockData'])
    assert len(data) == W*H*L
    for (x, y, z), n in expected(fx, wall).items():
        got = inv[data[x + z*W + y*W*L]]
        assert got == n, ((x, y, z), got, n)
    return r['Metadata']

def check_lite(b, fx, wall):
    name, r = read_nbt(gzip.decompress(b))
    reg = r['Regions']['test']
    s = reg['Size']; X, Y, Z = s['x'], s['y'], s['z']
    assert (X, Y, Z) == ((5, 3, 1) if wall else (5, 1, 3))
    pal = [p['Name'] for p in reg['BlockStatePalette']]
    assert pal[0] == 'minecraft:air'
    bits = max(2, (len(pal)-1).bit_length())
    longs = [v & ((1 << 64)-1) for v in reg['BlockStates']]
    big = sum(v << (64*i) for i, v in enumerate(longs))
    assert len(longs) == -(-X*Y*Z*bits // 64)
    for (x, y, z), n in expected(fx, wall).items():
        i = (y*Z + z)*X + x
        got = pal[(big >> (i*bits)) & ((1 << bits)-1)]
        assert got == n, ((x, y, z), got, n)
    assert r['Metadata']['TotalBlocks'] == 14

html = open(sys.argv[1], encoding='utf-8').read()
import html as _h
res = json.loads(_h.unescape(re.search(r'<pre id="out">RESULT:(.*?):END</pre>', html, re.S).group(1)))
failed = [n for n, ok in res['checks'] if not ok]
for n, ok in res['checks']: print(('PASS ' if ok else 'FAIL ') + n)
fx = res['fixture']
D = lambda k: base64.b64decode(fx[k])
for label, fn in [
    ('schem wall', lambda: check_schem(D('wallSchem'), fx, True)),
    ('schem floor', lambda: check_schem(D('floorSchem'), fx, False)),
    ('schem native gzip', lambda: check_schem(D('nativeGzip'), fx, True)),
    ('litematic wall', lambda: check_lite(D('wallLitematic'), fx, True)),
    ('litematic floor', lambda: check_lite(D('floorLitematic'), fx, False)),
]:
    try: fn(); print('PASS', label)
    except Exception as e: failed.append(label); print('FAIL', label, repr(e))
print('ALL PASSED' if not failed else f'{len(failed)} FAILED')
sys.exit(1 if failed else 0)
