import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeFrames, FrameDecoder, frameVersionForBle, SequenceCounter } from '../../lib/zengge/protocol/transport';
import { parseAdvertisement } from '../../lib/zengge/protocol/advertisement';
import { checksum, parseHex, stateUploadV1, symphonyV3, zenggeLegacy, zenggeV2 } from '../../lib/zengge/protocol/commands';
import { homeyToHsv, hsvToRgb, packHueSaturation, rgbToHsv, unpackHueSaturation } from '../../lib/zengge/protocol/color';
import { notificationPayload, parseState } from '../../lib/zengge/protocol/state';
import { chooseProfile } from '../../lib/zengge/protocol/profiles';

const hex = (b: Buffer) => b.toString('hex');

test('single frame header matches app encoder (v0)', () => {
  // Reference packet published by lednetwf_ble: 00 01 80 00 00 0d 0e 0b <13-byte payload>
  const payload = Buffer.from('3ba1006464000000000000000000'.slice(0, 26), 'hex');
  const [frame] = encodeFrames(0x0b, payload, { seq: 1 });
  assert.equal(hex(frame.subarray(0, 8)), '0001800000' + '0d0e0b');
  assert.equal(hex(frame.subarray(8)), hex(payload));
});

test('single frame header (v1, bleVersion >= 8) has 2-byte inner length', () => {
  const [frame] = encodeFrames(0x0a, Buffer.from([0x81, 0x8a, 0x8b, 0x96]), { seq: 7, version: 1 });
  assert.equal(hex(frame), '01078000' + '0004' + '0005' + '0a' + '818a8b96');
});

test('frame version follows ZGHBWriteUtils.getWriteVersion', () => {
  assert.equal(frameVersionForBle(5), 0);
  assert.equal(frameVersionForBle(7), 0);
  assert.equal(frameVersionForBle(8), 1);
});

test('segmentation matches app layout and round-trips through the decoder', () => {
  for (const version of [0, 1] as const) {
    for (const max of [20, 23, 64]) {
      for (const len of [1, 11, 12, 13, 14, 40, 100, 300]) {
        const payload = Buffer.from(Array.from({ length: len }, (_, i) => (i * 7 + 3) & 0xff));
        const frames = encodeFrames(0x0b, payload, { seq: 0x42, maxPacket: max, version });
        for (const f of frames) assert.ok(f.length <= max, `frame ${f.length} > ${max}`);
        if (frames.length > 1) {
          // First segment: ctrl has the segmented bit, frag = 0x0000, inner len = max-7 (v0) / max-8 (v1)
          assert.equal(frames[0][0] & 0x40, 0x40);
          assert.equal(frames[0][2], 0);
          assert.equal(frames[0][3], 0);
          if (version === 0) assert.equal(frames[0][6], max - 7);
          // Last segment carries the 0x8000 flag
          const last = frames[frames.length - 1];
          assert.equal(last[2] & 0x80, 0x80);
        }
        const dec = new FrameDecoder();
        let out = null;
        for (const f of frames) out = dec.push(f) ?? out;
        assert.ok(out, `no message for version ${version} max ${max} len ${len}`);
        assert.equal(out!.opcode, 0x0b);
        assert.equal(hex(out!.payload), hex(payload));
      }
    }
  }
});

test('decoder drops out-of-order segments', () => {
  const payload = Buffer.alloc(60, 0xaa);
  const frames = encodeFrames(0x0b, payload, { seq: 3, maxPacket: 20 });
  const dec = new FrameDecoder();
  dec.push(frames[0]);
  assert.equal(dec.push(frames[2]), null);
  assert.equal(dec.push(frames[frames.length - 1]), null);
});

test('sequence counter starts at 1 and wraps at 8 bits', () => {
  const s = new SequenceCounter();
  assert.equal(s.next(), 1);
  for (let i = 0; i < 254; i++) s.next();
  assert.equal(s.next(), 0);
});

test('checksums and app templates', () => {
  assert.equal(checksum([0x81, 0x8a, 0x8b]), 0x96);
  assert.equal(hex(stateUploadV1().payload), '818a8b96');
  // bright_value_v2 "3b010000{value}00{value}{delay}{delay}{delay}{gradient}{gradient}" + cs, opcode 11
  const b = zenggeV2.brightness(50)!;
  assert.equal(b.opcode, 11);
  const body = [0x3b, 0x01, 0x00, 0x00, 50, 0x00, 50, 0, 0, 0, 0, 0];
  assert.equal(hex(b.payload), hex(Buffer.from([...body, checksum(body)])));
  // switch_led_v2 "3b{open}0000000000{gradient}x3{delay}x2" + cs
  const on = zenggeV2.power(true);
  assert.equal(on.payload.length, 13);
  assert.equal(on.payload[1], 0x23);
  assert.equal(zenggeV2.power(false).payload[1], 0x24);
  // switch_led "71{open}0f" + cs
  assert.equal(hex(zenggeLegacy.power(true).payload), '71230fa3');
  // scene_data_v3 "e002{preview}{model}{speed}{bright}", no checksum, opcode 0x0a
  const sc = symphonyV3.scene(5, 80, 100)!;
  assert.equal(sc.opcode, 0x0a);
  assert.equal(hex(sc.payload), 'e0020005' + '50' + '64');
});

test('hue/saturation packing', () => {
  assert.deepEqual(packHueSaturation(240, 100), [0x78, 0x64]);
  assert.deepEqual(packHueSaturation(1, 50), [0x00, 0xb2]);
  assert.deepEqual(unpackHueSaturation(0x78, 0x64), { h: 240, s: 100 });
  const c = zenggeV2.color({ h: 120, s: 100, v: 80 });
  assert.equal(hex(c.payload.subarray(0, 5)), '3ba1' + '3c64' + '50');
});

test('colour conversions', () => {
  assert.deepEqual(homeyToHsv(0.5, 1, 0.25), { h: 180, s: 100, v: 25 });
  assert.deepEqual(hsvToRgb({ h: 0, s: 100, v: 100 }), [255, 0, 0]);
  assert.deepEqual(hsvToRgb({ h: 240, s: 100, v: 100 }), [0, 0, 255]);
  assert.deepEqual(rgbToHsv(0, 255, 0), { h: 120, s: 100, v: 100 });
});

function mfrBlock(bleVersion: number, productId: number, state: number[]): Buffer {
  const b = Buffer.alloc(29);
  b[0] = 0x10; // sta / company id low
  b[1] = 0x5a; // company id high
  b[2] = 0x01;
  b[3] = bleVersion;
  Buffer.from('0865f0123456', 'hex').copy(b, 4);
  b[10] = (productId >> 8) & 0xff;
  b[11] = productId & 0xff;
  b[12] = 0x21;
  b[13] = 0x03;
  b[14] = (1 << 2) | 0x01; // fw high bits = 1, checkKey = 1
  b[15] = 0x05;
  Buffer.from(state).copy(b, 16);
  return b;
}

test('advertisement: manufacturer data with company id (29 bytes)', () => {
  const adv = parseAdvertisement({ localName: 'LEDnetWF', manufacturerData: mfrBlock(6, 0xaa, [0x23, 0x61, 0xf0]) });
  assert.ok(adv);
  assert.equal(adv!.mac, '08:65:F0:12:34:56');
  assert.equal(adv!.productId, 0xaa);
  assert.equal(adv!.bleVersion, 6);
  assert.equal(adv!.firmwareVersion, 0x121);
  assert.equal(adv!.checkKeyFlag, 1);
  assert.equal(adv!.powerOn, true);
  assert.equal(adv!.source, 'manufacturerData');
});

test('advertisement: company-id-stripped form accepted only when MAC matches', () => {
  const stripped = mfrBlock(5, 0x47, [0x24]).subarray(2);
  assert.equal(parseAdvertisement({ manufacturerData: stripped }), null);
  assert.equal(parseAdvertisement({ manufacturerData: stripped, address: '00:11:22:33:44:55' }), null);
  const adv = parseAdvertisement({ manufacturerData: stripped, address: '08:65:f0:12:34:56' });
  assert.equal(adv?.productId, 0x47);
  assert.equal(adv?.powerOn, false);
});

test('advertisement: rejects foreign manufacturer data', () => {
  const b = mfrBlock(5, 1, []);
  b[1] = 0x4c;
  assert.equal(parseAdvertisement({ manufacturerData: b }), null);
  assert.equal(parseAdvertisement({ manufacturerData: Buffer.from('4c000215', 'hex') }), null);
});

test('advertisement: v7 service data + manufacturer state', () => {
  const sd = mfrBlock(7, 0xb6, []).subarray(0, 16);
  const mfr = Buffer.alloc(29);
  mfr[0] = 0x10;
  mfr[1] = 0x5a;
  mfr[3 + 11] = 0x23;
  const adv = parseAdvertisement({ manufacturerData: mfr, serviceData: [{ uuid: 'ffff', data: sd }] });
  assert.equal(adv?.source, 'serviceData+manufacturerData');
  assert.equal(adv?.productId, 0xb6);
  assert.equal(adv?.state?.length, 25);
  assert.equal(adv?.powerOn, true);
});

test('state: 0x81 reply and JSON-wrapped notification', () => {
  const raw = Buffer.from('8133236100' + '64' + 'ff0000' + '00' + '01' + '00' + 'f0' + '00', 'hex');
  const s = parseState(raw);
  assert.equal(s.format, '0x81');
  assert.equal(s.on, true);
  assert.deepEqual(s.rgb, [255, 0, 0]);
  const json = Buffer.from(JSON.stringify({ code: 0, payload: raw.toString('hex') }));
  const unwrapped = notificationPayload({ opcode: 12, payload: json, seq: 1, type: 0, ack: false, protect: false });
  assert.equal(hex(unwrapped), hex(raw));
  assert.equal(parseState(Buffer.from('ea81000001ff23', 'hex')).on, true);
});

test('profile selection from the app catalogue', () => {
  assert.equal(chooseProfile(0x35, 5, 20).profile, 'zengge_v2'); // common2_0 from fw 0
  assert.equal(chooseProfile(0x0e, 5, 9).profile, 'zengge_legacy'); // common2_0 only from fw 10
  assert.equal(chooseProfile(0x0e, 5, 10).profile, 'zengge_v2');
  assert.equal(chooseProfile(0x10, 3, 1).profile, 'zengge_legacy'); // christmas_wifi, no common2_0
  assert.equal(chooseProfile(0xfffe, 6, 1).profile, 'zengge_v2'); // unknown, BLE v5+
});

test('parseHex', () => {
  assert.equal(hex(parseHex('3b 23 0x00,ff')), '3b2300ff');
  assert.throws(() => parseHex('abc'));
  assert.throws(() => parseHex('zz'));
});

test('encoder is byte-identical to a literal port of the app Java encoder', () => {
  // Fixture generated by tools/zengge/crosscheck_encoder.py (line-by-line port of LowerTransportLayerEncoder).
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const cases = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../test/zengge/fixtures/java_encoder_cases.json'), 'utf8')) as
    Array<{ v1: boolean; max: number; len: number; frames: string[] }>;
  for (const c of cases) {
    const p = Buffer.from(Array.from({ length: c.len }, (_, i) => (i * 7 + 3) & 0xff));
    const got = encodeFrames(0x0b, p, { seq: 0x42, maxPacket: c.max, version: c.v1 ? 1 : 0 }).map(hex);
    assert.deepEqual(got, c.frames, `v1=${c.v1} max=${c.max} len=${c.len}`);
  }
});

test('E1 21 scene matches the frame verified on the Quntis', () => {
  const { symphonyScene, presetCommand, EFFECT_PRESETS } = require('../../lib/zengge/protocol/effects') as typeof import('../../lib/zengge/protocol/effects');
  // Exact payload that started the "Christmas 1" animation on the Quntis (2026-11-03, test step 5).
  const verified = 'e121006419000164500000000000000500646400007864640000006464000000646400001e64640000';
  const cmd = symphonyScene(0x19, 80, 100, [0, 120, 0, 0, 30].map((h) => ({ h, s: 100, b: 100 })));
  assert.equal(cmd.opcode, 0x0a);
  assert.equal(hex(cmd.payload), verified);
  const xmas = EFFECT_PRESETS.find((p) => p.id === 'christmas1')!;
  assert.equal(hex(presetCommand(xmas, 100).payload), verified);
  for (const p of EFFECT_PRESETS) {
    const c = presetCommand(p, 50);
    assert.equal(c.payload[15], p.hues.length, p.id);
    assert.equal(c.payload.length, 16 + 5 * p.hues.length, p.id);
  }
});

test('Quntis EA81 state layout (captured replies)', () => {
  const st = (h: string) => parseState(Buffer.from(h, 'hex'));
  // after power on, before any colour command
  const boot = st('ea8100008607232401500004646400000000000600000001640100' + '06');
  assert.equal(boot.on, true);
  // after "brightness 36%": white level 0x24 in [13] and [15], saturation 0
  const white = st('ea8100008607232414500000002400240000000600000001640100' + '06');
  assert.equal(white.brightness, 36);
  assert.equal(white.saturation, 0);
  // after "colour h=0 s=80 v=6"
  const red = st('ea8100008607232414500000500600000000000600000001640100' + '06');
  assert.deepEqual([red.hue, red.saturation, red.brightness], [0, 80, 6]);
  // after E1 21 Christmas 1
  const fx = st('ea8100008607232519500000646400000000000600000001640100' + '06');
  assert.equal(fx.mode, 0x25);
  assert.equal(fx.effectId, 0x19);
  assert.equal(st('ea8100008607242414500000646400000000000600000001640100' + '06').on, false);
});

test('Quntis product 0x86 selects the 0x3B + E1 21 command set', () => {
  assert.equal(chooseProfile(0x86, 7, 44).profile, 'zengge_v2_e1');
});

test('white temperature = temp_value_v2 with no delay (verified on the Quntis: 0 warm, 100 cool)', () => {
  const { zenggeV2E1 } = require('../../lib/zengge/protocol/commands') as typeof import('../../lib/zengge/protocol/commands');
  assert.equal(hex(zenggeV2E1.whiteTemperature!(0, 100).payload), '3bb100000000640000000000' + '50');
  assert.equal(hex(zenggeV2E1.whiteTemperature!(100, 100).payload), '3bb100000064640000000000' + 'b4');
  assert.equal(zenggeV2E1.whiteTemperature!(0, 100).opcode, 0x0b);
});

test('Quntis hue correction matches the calibration points and inverts', () => {
  const { correctHue, uncorrectHue } = require('../../lib/zengge/protocol/colorCorrection') as typeof import('../../lib/zengge/protocol/colorCorrection');
  assert.equal(correctHue(0), 0); // red
  assert.equal(correctHue(30), 7); // orange (device 5-10 looked orange)
  assert.equal(correctHue(60), 13); // yellow
  assert.equal(correctHue(120), 120); // pure green
  assert.equal(correctHue(240), 240); // blue unchanged
  assert.equal(correctHue(320), 320); // magenta unchanged
  for (let h = 0; h < 360; h += 5) {
    assert.ok(Math.abs(uncorrectHue(correctHue(h)) - h) <= 3, `round trip ${h}`);
  }
  for (let h = 1; h < 360; h++) assert.ok(correctHue(h) >= correctHue(h - 1), `monotonic at ${h}`);
});

test('built-in effect = E1 21 with an explicit colour list (empty list does not animate)', () => {
  const { builtinEffect, BUILTIN_EFFECTS } = require('../../lib/zengge/protocol/effects') as typeof import('../../lib/zengge/protocol/effects');
  // Exact payload that made effect 13 animate on the Quntis (2026-11-03, rainbow test step 3).
  const verified = 'e12100640d00016464000000000000070064640000036464000006646400003c646400005a6464000078646400008c64640000';
  const c = builtinEffect(13, 100, 100);
  assert.equal(c.opcode, 0x0a);
  assert.equal(hex(c.payload), verified);
  assert.equal(hex(builtinEffect(13, 100, 100, []).payload), verified); // never sent empty
  assert.equal(BUILTIN_EFFECTS.length, 34); // the remote's cycle
  for (const skipped of [12, 23, 24, 38, 0]) assert.throws(() => builtinEffect(skipped, 50, 50), /not available/);
  const { zenggeV2E1 } = require('../../lib/zengge/protocol/commands') as typeof import('../../lib/zengge/protocol/commands');
  assert.equal(hex(zenggeV2E1.scene(13, 100, 100)!.payload), verified);
});

test('effect library is scoped to the light model', () => {
  const lib = require('../../lib/zengge/effects/library') as typeof import('../../lib/zengge/effects/library');
  const quntis = lib.buildLibrary([], { productId: 0x86, effects: true });
  assert.equal(quntis.filter((e) => e.id.startsWith('s:')).length, 97);
  // Another product in the same cloud scene set gets the same scenes.
  assert.equal(lib.buildLibrary([], { productId: 0x022a, effects: true }).filter((e) => e.id.startsWith('s:')).length, 97);
  // A model with E1 21 effects but an unknown scene set: patterns only, no Quntis scenes.
  const other = lib.buildLibrary([], { productId: 0x85, effects: true });
  assert.equal(other.filter((e) => e.id.startsWith('s:')).length, 0);
  assert.equal(other.filter((e) => e.category === 'patterns').length, 34);
  assert.deepEqual(Object.keys(lib.categoriesFor(other)), ['mine', 'patterns']);
  // No effect support: nothing to offer.
  assert.equal(lib.buildLibrary([], { productId: 0x85, effects: false }).length, 0);
});

test('custom effects are stored per light', () => {
  const store = require('../../lib/zengge/effects/store') as typeof import('../../lib/zengge/effects/store');
  const data = new Map<string, unknown>();
  const settings = { get: (k: string) => data.get(k), set: (k: string, v: unknown) => { data.set(k, v); } } as never;
  const a = { deviceId: 'aaa', productId: 0x86, effects: true };
  const b = { deviceId: 'bbb', productId: 0x86, effects: true };
  store.saveCustomEffect(settings, a, { name: 'Only A', pattern: 13, speed: 50, colours: [{ h: 0, s: 100 }] });
  assert.equal(store.getCustomEffects(settings, a).length, 1);
  assert.equal(store.getCustomEffects(settings, b).length, 0);
  // Effects shared before the update are offered to every light once, then kept per light.
  data.set(store.LEGACY_CUSTOM_EFFECTS_KEY, [{ id: 'old1', name: 'Old', pattern: 1, speed: 80, colours: [{ h: 0, s: 100 }] }]);
  assert.equal(store.getCustomEffects(settings, b).length, 1);
  assert.equal(store.getCustomEffects(settings, a).length, 1); // A already has its own list
  assert.throws(() => store.saveCustomEffect(settings, { deviceId: 'c', productId: 0x85, effects: false }, { name: 'x', pattern: 1, colours: [{ h: 0 }] }), /does not support/);
});

test('effect library: ids, picker values, custom effects', () => {
  const lib = require('../../lib/zengge/effects/library') as typeof import('../../lib/zengge/effects/library');
  const all = lib.buildLibrary([]);
  assert.equal(all.filter((e) => e.category === 'patterns').length, 34);
  assert.equal(all.filter((e) => e.id.startsWith('s:')).length, 97); // the app's scenes for 0x86
  assert.equal(new Set(all.map((e) => e.id)).size, all.length); // ids unique
  // Built-in pattern entries send exactly the verified built-in command.
  const { builtinEffect, symphonyScene, BUILTIN_EFFECTS } = require('../../lib/zengge/protocol/effects') as typeof import('../../lib/zengge/protocol/effects');
  const p13 = all.find((e) => e.id === 'p:13')!;
  assert.equal(hex(lib.entryCommand(p13, 100, 100).payload), hex(builtinEffect(13, 100, 100).payload));
  // Surplife scenes are sent byte-for-byte as the app sends them.
  // "Game" (pattern 32, six colours) = the app's own E1 21 frame captured from /app/mode/diy/list.
  const game = all.find((e) => e.id === 's:game')!;
  assert.equal(hex(lib.entryCommand(game, 80, 100).payload),
    'e12100642000016450000000000000060064640000966464000078646400005a646400003c646400001e64640000');
  // "Northern lights" (otherMode 2) = magichome2-ble's HCI capture of the app (pattern 0x0d, mode 2, hue byte 14).
  const nl = all.find((e) => e.id === 's:northern_lights')!;
  assert.equal(hex(lib.entryCommand(nl, 99, 100).payload), hex(symphonyScene(0x0d, 99, 100, [{ h: 14, s: 100, b: 100 }], 0x02).payload));
  // Warm-white "T" colours use the warm-white channel (palette byte 5), verified on the Quntis.
  const candle = all.find((e) => e.id === 's:gentle_candlelight')!;
  assert.equal(hex(lib.entryCommand(candle, 80, 100).payload), 'e1210064020001645000000000000001' + '0000000064');
  assert.ok(all.every((e) => e.category === 'mine' || e.category === 'patterns' || BUILTIN_EFFECTS.includes(e.pattern)), 'scene patterns exist on the controller');
  // Custom effects: sanitised, palette converted with the colour correction, listed first with a star.
  const c = lib.sanitiseCustom({ name: '  Cosy red ', pattern: 13, speed: 250, colours: [{ h: 0, s: 100 }, { h: 30, s: 80 }] }, () => 'abcd1234');
  assert.deepEqual(c, { id: 'abcd1234', name: 'Cosy red', pattern: 13, speed: 100, colours: [{ h: 0, s: 100 }, { h: 30, s: 80 }] });
  const withCustom = lib.buildLibrary([c]);
  assert.equal(withCustom[0].id, 'c:abcd1234');
  assert.deepEqual(withCustom[0].palette.map((p) => p.h), [0, 3]); // orange 30 -> device 7 -> palette 3
  const values = lib.pickerValues(withCustom);
  assert.equal(values[0].id, 'static');
  assert.equal(values[1].title.en, '★ Cosy red');
  assert.throws(() => lib.sanitiseCustom({ name: 'x', pattern: 12, colours: [{ h: 0 }] }, () => 'id00'), /pattern/);
  assert.throws(() => lib.sanitiseCustom({ name: '', pattern: 1, colours: [{ h: 0 }] }, () => 'id00'), /name/);
  assert.throws(() => lib.sanitiseCustom({ name: 'a', pattern: 1, colours: [] }, () => 'id00'), /colour/);
});

test('brightness curve: perceptual slider steps, and state maps back to the same slider value', () => {
  const { dimToLevel, levelToDim } = require('../../lib/zengge/protocol/color') as typeof import('../../lib/zengge/protocol/color');
  assert.equal(dimToLevel(1), 100);
  assert.equal(dimToLevel(0.5), 27);
  assert.equal(dimToLevel(0.01), 2); // lowest slider position still lights (level 1 is dark)
  assert.equal(dimToLevel(0.12), 3);
  assert.equal(dimToLevel(0.5, 'linear'), 50);
  for (const dim of [0.2, 0.33, 0.5, 0.71, 0.9, 1]) assert.ok(Math.abs(levelToDim(dimToLevel(dim)) - dim) <= 0.02, `dim ${dim}`);
  assert.equal(levelToDim(46, 'linear'), 0.46);
});
