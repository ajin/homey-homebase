import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RemoteLearner } from '../../lib/hamulight/learning';

test('hamulight learning: an unknown on/off command needs two separate presses', () => {
  const l = new RemoteLearner();
  l.add(0x36055f47, false); // remote 3605 (RFFHEM): other command set, no A0
  l.add(0x36055f47, true); // repetitions of the same press do not count
  l.add(0x36055f47, true);
  assert.equal(l.status().phase, 'toggle');
  l.add(0x12345678, false); // noise from another device
  l.add(0x36055f47, false);
  const s = l.status();
  assert.equal(s.phase, 'levels');
  assert.equal(s.remoteId, 0x3605);
  assert.equal(s.toggle, 0x36055f47);
});

test('hamulight learning: the ring sweep keeps new frames of this remote in order (unknown remote type)', () => {
  const l = new RemoteLearner();
  l.setToggle(0x36055f47); // RFFHEM bit sense: no valid checksum, so levels are learned
  assert.equal(l.status().calculated, false);
  assert.equal(l.add(0x36050001, false), true);
  assert.equal(l.add(0x36050001, true), false);
  assert.equal(l.add(0x36055f47, false), false); // on/off is not a level
  assert.equal(l.add(0x8f990002, false), false); // another remote
  l.add(0x36050002, false);
  l.add(0x36050003, false);
  assert.deepEqual(l.result(), { remoteId: 0x3605, toggle: 0x36055f47, levels: [0x36050001, 0x36050002, 0x36050003] });
  l.restartLevels();
  assert.deepEqual(l.result()?.levels, []);
  l.restart();
  assert.equal(l.result(), null);
});

test('hamulight learning: HM3002-type remotes need no ring step (brightness is calculated)', () => {
  const l = new RemoteLearner();
  l.add(0x4516a050, false);
  l.add(0x45163cec, false); // ring touched by chance
  assert.equal(l.status().calculated, true);
  assert.deepEqual(l.result(), { remoteId: 0x4516, toggle: 0x4516a050, levels: [] });
});

test('hamulight learning: HM3002 on/off (A0, valid checksum) is accepted on the first press; a ring stream is not', () => {
  const l = new RemoteLearner();
  // finger resting on the ring: two codes alternate, every later one is a repeat
  l.add(0x45163eee, false);
  l.add(0x45163ded, false);
  for (let i = 0; i < 20; i++) { l.add(0x45163eee, true); l.add(0x45163ded, true); }
  assert.equal(l.status().phase, 'toggle');
  l.add(0x4516a050, false);
  assert.equal(l.status().toggle, 0x4516a050);
  assert.equal(l.status().remoteId, 0x4516);
});

test('hamulight learning: HM3002 ring codes heard in separate touches are never taken for on/off', () => {
  const l = new RemoteLearner();
  l.add(0x4516aa5a, false); // ring touched,
  l.add(0x4516aa5a, false); // and touched again 1.6 s later (seen on the HM3002 during pairing)
  l.add(0x4516af5f, false);
  l.add(0x4516af5f, false);
  assert.equal(l.status().phase, 'toggle');
  l.add(0x4516a050, false);
  assert.equal(l.status().toggle, 0x4516a050);
});
