import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CommandQueue, mergeLightValues } from '../../lib/core/commandQueue';

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

test('command queue: runs jobs one at a time and keeps only the latest per key', async () => {
  const ran: string[] = [];
  const results: (Error | null)[] = [];
  const q = new CommandQueue((e) => results.push(e));
  let release!: () => void;
  q.push('light', () => new Promise<void>((r) => { ran.push('light 1'); release = r; })); // slow reconnect
  q.push('light', async () => { ran.push('light 2'); });
  q.push('power', async () => { ran.push('power'); });
  q.push('light', async () => { ran.push('light 3'); }); // replaces light 2, moves after power
  await tick();
  assert.deepEqual(ran, ['light 1']);
  release();
  await tick();
  assert.deepEqual(ran, ['light 1', 'power', 'light 3']);
  assert.deepEqual(results, [null, null, null]);
});

test('command queue: a failing job is reported and does not stop the next one', async () => {
  const results: (string | null)[] = [];
  const q = new CommandQueue((e) => results.push(e ? e.message : null));
  q.push('power', async () => { throw new Error('out of range'); });
  q.push('light', async () => {});
  await tick();
  assert.deepEqual(results, ['out of range', null]);
});

test('merge light values: the latest choice between colour and white wins', () => {
  assert.deepEqual(mergeLightValues({ light_temperature: 0.3, light_mode: 'temperature' }, { light_hue: 0.5 }), { light_hue: 0.5 });
  assert.deepEqual(mergeLightValues({ light_hue: 0.5, light_saturation: 1, dim: 0.4 }, { light_temperature: 0.2 }), { dim: 0.4, light_temperature: 0.2 });
  assert.deepEqual(mergeLightValues({ light_hue: 0.5 }, { dim: 0.8 }), { light_hue: 0.5, dim: 0.8 });
});
