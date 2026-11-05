"""Generate the Hamulight driver images (no external deps): warm LED spots in a veranda beam."""
import math, struct, zlib, os

def png(path, w, h, pixel):
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        for x in range(w):
            raw.extend(pixel(x, y, w, h))
    def chunk(t, data):
        c = struct.pack('>I', len(data)) + t + data
        return c + struct.pack('>I', zlib.crc32(t + data) & 0xffffffff)
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
    data += chunk(b'IDAT', zlib.compress(bytes(raw), 9)) + chunk(b'IEND', b'')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, 'wb').write(data)

WARM = (255, 196, 120)
BG = (20, 24, 38)
BEAM = (70, 76, 88)

def mix(a, b, t):
    t = max(0.0, min(1.0, t))
    return tuple(int(a[k] * (1 - t) + b[k] * t) for k in range(3))

def spots(x, y, w, h):
    beam_top, beam_bot = h * 0.18, h * 0.26
    if beam_top <= y < beam_bot:
        return BEAM
    c = BG
    n = 4
    for i in range(n):
        cx = (i + 0.5) * w / n
        r = min(w, h) * 0.035
        # the spot itself, set into the beam's underside
        if abs(x - cx) < r * 1.6 and beam_bot <= y < beam_bot + r * 0.8:
            return WARM
        # light cone below it
        if y > beam_bot:
            dy = (y - beam_bot) / h
            spread = r * 1.6 + dy * w * 0.22
            dx = abs(x - cx) / spread
            if dx < 1:
                a = (1 - dx) * max(0.0, 0.55 - dy * 0.6)
                c = mix(c, WARM, a)
    return c

here = os.path.dirname(os.path.abspath(__file__))
out = os.path.join(here, '..', '..', 'drivers', 'hamulight-433-light', 'assets', 'images')
for name, size in {'small': (75, 75), 'large': (500, 500), 'xlarge': (1000, 1000)}.items():
    png(os.path.join(out, f'{name}.png'), size[0], size[1], spots)
print('written to', os.path.normpath(out))
