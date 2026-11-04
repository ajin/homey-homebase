"""Generate the Zengge Bluetooth light driver images (no external deps). The app images come from tools/art/render.sh."""
import math, struct, zlib, sys, os

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

COLORS = [(230, 57, 70), (255, 183, 3), (42, 157, 143), (69, 123, 157), (255, 255, 255)]

def lights(x, y, w, h):
    bg = (20, 24, 38)
    # a sagging wire with bulbs
    n = 7
    for i in range(n):
        cx = (i + 0.5) * w / n
        cy = h * 0.45 + math.sin(i / (n - 1) * math.pi) * h * 0.18
        r = min(w, h) * 0.07
        d = math.hypot(x - cx, y - cy)
        c = COLORS[i % len(COLORS)]
        if d < r:
            return c
        if d < r * 2.2:
            a = (1 - (d - r) / (r * 1.2)) * 0.35
            return tuple(int(bg[k] * (1 - a) + c[k] * a) for k in range(3))
    wire = h * 0.45 + math.sin(x / w * math.pi) * h * 0.18 - min(w, h) * 0.09
    if abs(y - wire) < max(1, h * 0.006):
        return (90, 100, 110)
    return bg

for name, s in {'small': 75, 'large': 500, 'xlarge': 1000}.items():
    png(f'drivers/zengge-ble-light/assets/images/{name}.png', s, s, lights)
