import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'events';
import { ZenggeConnection } from '../../lib/zengge/ble/ZenggeConnection';
import { FrameDecoder, MAX_MESSAGE_BYTES } from '../../lib/zengge/protocol/transport';
import { MAX_RAW_BYTES, parseHex } from '../../lib/zengge/protocol/commands';
import { validStored } from '../../lib/zengge/effects/store';
import { builtinEntries, QUNTIS_SCOPE } from '../../lib/zengge/effects/library';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A fake Homey BLE peripheral with the Zengge service. */
class FakePeripheral extends EventEmitter {
  isConnected = true;
  disconnects = 0;
  writes: Buffer[] = [];
  async discoverAllServicesAndCharacteristics() {
    const write = { uuid: 'ff01', properties: [], write: async (b: Buffer) => { this.writes.push(b); } };
    const notify = { uuid: 'ff02', properties: [], subscribeToNotifications: async () => {}, unsubscribeFromNotifications: async () => {} };
    return [{ uuid: 'ffff', characteristics: [write, notify] }];
  }
  async disconnect() { this.disconnects++; this.isConnected = false; this.emit('disconnect'); }
}

function fakeBle(connectDelays: number[]) {
  const made: FakePeripheral[] = [];
  let n = 0;
  return {
    made,
    ble: {
      find: async () => ({
        rssi: -60,
        connect: async () => {
          const p = new FakePeripheral();
          made.push(p);
          await sleep(connectDelays[n++] ?? 0);
          return p;
        },
      }),
    },
  };
}

const opts = (over = {}) => ({
  peripheralUuid: 'x', frameVersion: 0 as const, maxPacket: 255, minWriteGapMs: 0,
  connectTimeoutMs: 40, writeTimeoutMs: 1000, log: () => {}, debug: () => false, ...over,
});

test('BLE: a connect that times out and completes later is disconnected and cannot drop the live link', async () => {
  const { ble, made } = fakeBle([120, 0]); // first connect is slow, second fast
  const conn = new ZenggeConnection(ble as never, opts());
  let lost = 0;
  conn.on('disconnect', () => lost++);
  await conn.connect();
  assert.equal(made.length, 2);
  assert.ok(conn.isConnected);
  await sleep(150); // the abandoned first attempt completes now
  assert.equal(made[0].disconnects, 1, 'late peripheral is disconnected');
  assert.ok(conn.isConnected, 'live link untouched');
  assert.equal(lost, 0, 'no false "link lost"');
  await conn.send({ opcode: 0x0b, payload: Buffer.from([1]), label: 't', provenance: 'derived' });
  assert.equal(made[1].writes.length, 1);
});

test('BLE: after a failed connect, commands fail at once instead of reconnecting again', async () => {
  const ble = { find: async () => { throw new Error('not found'); } };
  const conn = new ZenggeConnection(ble as never, opts());
  await assert.rejects(conn.connect(), /not found/);
  const t = Date.now();
  await assert.rejects(conn.send({ opcode: 1, payload: Buffer.from([1]), label: 't', provenance: 'derived' }), /not reachable/);
  assert.ok(Date.now() - t < 50);
});

test('frame decoder ignores messages claiming more than the size limit', () => {
  const d = new FrameDecoder();
  const big = MAX_MESSAGE_BYTES + 1;
  const frame = Buffer.from([0x00, 0x01, 0x80, 0x00, big >> 8, big & 0xff, 0x02, 0x0a, 0x00]);
  assert.equal(d.push(frame), null);
});

test('raw payloads are limited in size', () => {
  assert.equal(parseHex('aa'.repeat(MAX_RAW_BYTES)).length, MAX_RAW_BYTES);
  assert.throws(() => parseHex('aa'.repeat(MAX_RAW_BYTES + 1)), /limited/);
});

test('stored effects are checked when read: malformed entries are skipped', () => {
  const good = { id: 'abcd1234', name: 'Mine', pattern: 1, speed: 50, colours: [{ h: 10, s: 100 }] };
  const list = validStored([good, { name: 'no colours', pattern: 1 }, null, 'x', { ...good, id: '../bad' }]);
  assert.deepEqual(list.map((e) => e.id), ['abcd1234']);
  assert.deepEqual(validStored('nope'), []);
});

test('built-in effects are built once per model', () => {
  assert.equal(builtinEntries(QUNTIS_SCOPE), builtinEntries(QUNTIS_SCOPE));
});

test('model names describe the controller, with the shop brand', () => {
  const { productName } = require('../../lib/zengge/effects/models') as typeof import('../../lib/zengge/effects/models');
  assert.equal(productName(0x86), 'Zengge Symphony RGBWW controller · 0x86 · sold as Quntis');
  assert.equal(productName(0x22a), 'Zengge Bluetooth light · 0x22a');
});

test('remote settings: commands match flux_led and the reply from the Quntis decodes', () => {
  const r = require('../../lib/zengge/protocol/remotes') as typeof import('../../lib/zengge/protocol/remotes');
  assert.equal(r.remoteConfigQuery().payload.toString('hex'), '2b2c2d84'); // as sent to the Quntis
  assert.equal(r.remoteConfigQuery().opcode, 0x0a);
  assert.equal(r.setRemoteMode('open').payload.toString('hex'), '2a02ffffffffff000000000000000f36');
  assert.equal(r.setRemoteMode('paired_only').payload.subarray(0, 2).toString('hex'), '2a03');
  assert.equal(r.setRemoteMode('disabled').payload.subarray(0, 2).toString('hex'), '2a01');
  assert.equal(r.unpairRemotes().payload.subarray(0, 4).toString('hex'), '2affff01');
  // Reply from the Quntis on 2026-11-04: open, 0 paired remotes.
  assert.deepEqual(r.parseRemoteConfig(Buffer.from('2b0200009178ff1f794400002c3d', 'hex')), { mode: 'open', paired: 0 });
  assert.equal(r.parseRemoteConfig(Buffer.from('2b0200009178ff1f794400002c3e', 'hex')), null); // bad checksum
  assert.equal(r.parseRemoteConfig(Buffer.from('81', 'hex')), null);
});
