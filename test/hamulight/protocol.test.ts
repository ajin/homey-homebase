import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bitsToFrame, cleanLevels, commandPart, dimForLevelIndex, frameHex, frameSymbols, frameToBits,
  buildFrame, checksumOk, commandByte, dimForRingPosition, generatedDimFrame, levelIndexFor, parseFrameHex,
  FRAMES_PER_TX, packedIntervals, packedPayload, parseRingPosition, remoteId, ringPositionFor, ringSpan, txPlan,
} from '../../lib/hamulight/protocol';

// Captures published in aukedejong/esphome-hamulight (200 us symbols, 1 = carrier on).
const TOGGLE = '01010111111000000100010001110111010001110100011101000100010001110111010001110111011101000111010001000100010001000100011101000100010001110100011101010';
const DIM_PREFIX = '010101111110000001000100011101110100011101000111010001000100011101110100011101110100';
const DIM_GLUE = '0101';
function publishedDim(level: number): string {
  const data = level.toString(2).padStart(15, '0').split('').map((b) => (b === '1' ? '0111' : '0100')).join('');
  return DIM_PREFIX + data + DIM_GLUE + DIM_PREFIX + data;
}

test('hamulight: the published toggle capture is frame 351B A045 with our timings', () => {
  const frame = 0x351ba045;
  // The capture starts with one idle symbol and ends with the idle symbol after the end pulse.
  assert.equal('0' + frameSymbols(frame) + '0', TOGGLE);
  assert.equal(remoteId(frame), 0x351b);
  assert.equal(commandPart(frame), 0xa045);
});

test('hamulight: the published dim message is two frames of remote id + 0 + 15-bit level', () => {
  for (const level of [24357, 20479, 32767, 256]) {
    const frame = generatedDimFrame(0x351b, 1) & 0xffff0000 | level;
    const sym = frameSymbols(frame >>> 0);
    // The capture of the second frame stops at the end of its last high pulse.
    assert.equal('0' + sym + '0' + sym.slice(0, -4), publishedDim(level));
  }
});

test('hamulight: generated dim frames follow the published formula', () => {
  assert.equal(commandPart(generatedDimFrame(0x351b, 100)), 24357);
  assert.equal(commandPart(generatedDimFrame(0x351b, 1)), 20479);
  assert.equal(commandPart(generatedDimFrame(0x351b, 2)), 20479 - 289);
  assert.equal(remoteId(generatedDimFrame(0xcae4, 50)), 0xcae4);
  assert.equal(generatedDimFrame(0x351b, 70) & 0x8000, 0);
});

test('hamulight: bits round trip and reject bad payloads', () => {
  const f = 0x36055f47;
  assert.deepEqual(frameToBits(f).length, 32);
  assert.equal(bitsToFrame(frameToBits(f)), f);
  assert.equal(bitsToFrame(frameToBits(0xffffffff)), 0xffffffff);
  assert.equal(bitsToFrame([0, 1]), null);
  assert.equal(bitsToFrame(new Array(32).fill(2)), null);
  assert.equal(frameHex(f), '36055F47');
  assert.equal(parseFrameHex(' 0x36055f47 '), f);
  assert.equal(parseFrameHex('3605'), null);
});

test('hamulight: ring sweep cleaning and dim mapping', () => {
  const toggle = 0x36055f47;
  const levels = cleanLevels([0x36050001, toggle, 0x8f990002, 0x36050002, 0x36050001, 0x36050003], 0x3605, toggle);
  assert.deepEqual(levels, [0x36050001, 0x36050002, 0x36050003]);
  assert.equal(levelIndexFor(0, 3), 0);
  assert.equal(levelIndexFor(0.5, 3), 1);
  assert.equal(levelIndexFor(1, 3), 2);
  assert.equal(levelIndexFor(0.5, 0), -1);
  assert.equal(dimForLevelIndex(2, 3), 1);
  assert.equal(dimForLevelIndex(0, 1), 1);
});

test('hamulight: checksum rule matches the HM3002 (remote 4516) and the published 351B toggle', () => {
  for (const f of [0x4516a050, 0x45163eee, 0x45163ded, 0x45163cec, 0x351ba045]) assert.equal(checksumOk(f), true, frameHex(f));
  assert.equal(checksumOk(0x4516a051), false);
  assert.equal(buildFrame(0x4516, 0xa0), 0x4516a050);
  assert.equal(buildFrame(0x4516, 0x3e), 0x45163eee);
  assert.equal(commandByte(0x4516a050), 0xa0);
});

test('hamulight: ring position mapping walks from dark to bright around the ring', () => {
  const r = { dark: 0x4f, bright: 0x5f, direction: 'down' as const };
  assert.equal(ringSpan(r), 0x70); // 4F down to 00 (79) + 7F down to 5F (33)
  assert.equal(ringPositionFor(0, r), 0x4f);
  assert.equal(ringPositionFor(1, r), 0x5f);
  assert.equal(ringPositionFor(0.5, r), 0x17); // 56 steps down from 4F
  assert.equal(ringPositionFor(79 / 112, r), 0x00);
  assert.equal(ringPositionFor(80 / 112, r), 0x7f);
  assert.equal(dimForRingPosition(0x4f, r), 0);
  assert.equal(dimForRingPosition(0x5f, r), 1);
  assert.equal(dimForRingPosition(0x00, r), 79 / 112);
  assert.equal(dimForRingPosition(0x55, r), null); // in the dead zone between bright and dark
  const up = { dark: 0x10, bright: 0x30, direction: 'up' as const };
  assert.equal(ringPositionFor(0.5, up), 0x20);
  assert.equal(dimForRingPosition(0x20, up), 0.5);
  assert.equal(parseRingPosition('4f', 0), 0x4f);
  assert.equal(parseRingPosition('0x5F', 0), 0x5f);
  assert.equal(parseRingPosition('80', 7), 7);
  assert.equal(parseRingPosition('zz', 7), 7);
  assert.equal(buildFrame(0x4516, ringPositionFor(1, r)), 0x45165f0f);
});

test('hamulight: frames are packed back to back in one transmission within Homey limits', () => {
  assert.equal(FRAMES_PER_TX, 3);
  assert.ok(packedIntervals(3) <= 256);
  assert.ok(packedIntervals(4) > 256);
  const p = packedPayload(0x4516a050, 2);
  assert.equal(p.length, 32 * 2 + 1);
  assert.equal(p[32], 2);
  assert.equal(bitsToFrame(p.slice(33)), 0x4516a050);
  // one unbroken transmission, never Homey repetitions
  assert.deepEqual(txPlan(10), { perTx: 3, repetitions: 1 });
  assert.deepEqual(txPlan(3), { perTx: 3, repetitions: 1 });
  assert.deepEqual(txPlan(2), { perTx: 2, repetitions: 1 });
  assert.deepEqual(txPlan(0), { perTx: 1, repetitions: 1 });
});

test('hamulight: RFFHEM remote 3605 (inverted bit sense) is C9FA A0 B8 here and fits the checksum', () => {
  const inverted = (~0x36055f47) >>> 0;
  assert.equal(inverted, 0xc9faa0b8);
  assert.equal(checksumOk(inverted), true);
  assert.equal(commandByte(inverted), 0xa0);
});
