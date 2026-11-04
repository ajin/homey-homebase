"""Literal Python port of LowerTransportLayerEncoder (Surplife app) used to cross-check
lib/zengge/protocol/transport.ts. Usage: python3 tools/zengge/crosscheck_encoder.py | node build-test/... (see docs)."""
import json, sys

def ctrl(protect, ack, seg, ver):
    b = 0
    if seg: b |= 0x40
    if protect: b |= 0x20
    if ack: b |= 0x10
    return b | (ver & 3)

def seg_num(n, i3, h, s):
    length = (n - i3) + h
    i8 = i3 - s
    if length <= i8: return 2
    return length // i8 + 1 if length % i8 == 0 else length // i8 + 2

def generator(payload, seq, cmd, i3, v1):
    H = 9 if v1 else 8; S = 6 if v1 else 5
    n = len(payload); out = []
    if n <= i3 - H:
        b = bytearray(n + H)
        b[0] = ctrl(False, False, False, 1 if v1 else 0); b[1] = seq; b[2] = 0x80; b[3] = 0
        b[4] = (n >> 8) & 255; b[5] = n & 255
        if v1: b[6] = ((n + 1) >> 8) & 255; b[7] = (n + 1) & 255; b[8] = cmd
        else: b[6] = (n + 1) & 255; b[7] = cmd
        b[H:] = payload; return [bytes(b)]
    cnt = seg_num(n, i3, H, S); i12 = 0
    for i in range(cnt):
        if i == 0:
            b = bytearray(i3)
            b[0] = ctrl(False, False, True, 1 if v1 else 0); b[1] = seq
            b[4] = (n >> 8) & 255; b[5] = n & 255
            if v1: l = i3 - 8; b[6] = (l >> 8) & 255; b[7] = l & 255; b[8] = cmd
            else: b[6] = (i3 - 7) & 255; b[7] = cmd
            b[H:] = payload[:i3 - H]; i12 = i3 - H
        else:
            frag = (0x8000 | i) if i == cnt - 1 else i
            m = min(n - i12, i3 - S)
            b = bytearray(m + S)
            b[0] = ctrl(False, False, True, 1 if v1 else 0); b[1] = seq
            b[2] = (frag >> 8) & 255; b[3] = frag & 255
            if v1: b[4] = (m >> 8) & 255; b[5] = m & 255
            else: b[4] = m & 255
            b[S:] = payload[i12:i12 + m]; i12 += m
        out.append(bytes(b))
    return out

cases = []
for v1 in (False, True):
    for i3 in (20, 23, 64, 255):
        for n in (0, 1, 11, 12, 13, 14, 15, 40, 100, 300, 600):
            p = bytes((i * 7 + 3) & 255 for i in range(n))
            cases.append({"v1": v1, "max": i3, "len": n, "frames": [f.hex() for f in generator(p, 0x42, 0x0b, i3, v1)]})
json.dump(cases, sys.stdout)
