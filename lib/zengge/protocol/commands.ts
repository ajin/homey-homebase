/**
 * Light command sets ("profiles").
 *
 * The Surplife app does not build these in Java: it sends {opcode, hex} pairs from its Flutter
 * layer, using command templates shipped in its assets (ble_dp_cmd.json, wifi_dp_cmd.json and the
 * per-product `hexCmdForms`). Each builder below records where its byte layout comes from:
 *
 *   'app-template'   byte template present in the Surplife app assets (exact)
 *   'third-party'    layout from an open-source project that tested it on other Zengge hardware
 *   'derived'        inferred by analogy; least certain
 *
 * Nothing here has been verified on the Quntis NS-I-204-M-E yet. The device only counts as
 * "verified" once a command has visibly changed the lights (see docs/zengge/HARDWARE_TESTING.md).
 */
import { clamp, Hsv, hsvToRgb, packHueSaturation } from './color';
import { builtinEffect } from './effects';

export type Provenance = 'app-template' | 'third-party' | 'derived';

export interface LightCommand {
  opcode: number;
  payload: Buffer;
  label: string;
  provenance: Provenance;
}

/** Opcodes observed in the app: bright_value_v2 uses 11 (ble_dp_cmd.json); queries use 10. */
export const OPCODE_COMMAND = 0x0b;
export const OPCODE_QUERY = 0x0a;
/** Notification opcodes handled specially by BleDeviceManagerServer.onArrival(). */
export const NOTIFY_OPCODE_JSON_STATE = 12;
export const NOTIFY_OPCODE_RAW_STATE = 22;

export function checksum(bytes: number[] | Buffer): number {
  let sum = 0;
  for (const b of bytes) sum += b;
  return sum & 0xff;
}

function withChecksum(bytes: number[]): Buffer {
  return Buffer.from([...bytes, checksum(bytes)]);
}

function delay3(delay: number): number[] {
  const d = clamp(Math.round(delay), 0, 0xffffff);
  return [(d >> 16) & 0xff, (d >> 8) & 0xff, d & 0xff];
}

export type ProfileId = 'zengge_v2_e1' | 'zengge_v2' | 'zengge_legacy' | 'symphony_v3';

export interface CommandProfile {
  id: ProfileId;
  name: string;
  power(on: boolean): LightCommand;
  brightness(percent: number): LightCommand | null;
  color(hsv: Hsv): LightCommand;
  /** Built-in effect by numeric id (names are not published by the app for BLE string lights). */
  scene(effectId: number, speedPercent: number, brightnessPercent: number): LightCommand | null;
  stateQueries(): LightCommand[];
  /** True when named effect presets (E1 21) are available. */
  namedEffects?: boolean;
  /**
   * White light on the controller's white channels. coolPercent 0 = warm white, 100 = cool white.
   * Undefined when the command set has no colour-temperature command.
   */
  whiteTemperature?(coolPercent: number, brightnessPercent: number): LightCommand;
}

/**
 * "common2_0" family (the app's unified 0x3B commands), used by products whose catalogue entry
 * lists protocol common2_0. Opcode 0x0B, payload ends with an additive checksum.
 */
export const zenggeV2: CommandProfile = {
  id: 'zengge_v2',
  name: 'Zengge unified (0x3B)',
  power(on) {
    // switch_led_v2: "3b{open}0000000000{gradient}{gradient}{gradient}{delay}{delay}" + checksum
    // open: 0x23 = on, 0x24 = off (same values as the 0x81 state reply).
    return {
      opcode: OPCODE_COMMAND,
      payload: withChecksum([0x3b, on ? 0x23 : 0x24, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      label: on ? 'power on (switch_led_v2)' : 'power off (switch_led_v2)',
      provenance: 'app-template',
    };
  },
  brightness(percent) {
    // bright_value_v2: "3b010000{value}00{value}{delay}{delay}{delay}{gradient}{gradient}", opcode 11
    const v = clamp(Math.round(percent), 0, 100);
    return {
      opcode: OPCODE_COMMAND,
      payload: withChecksum([0x3b, 0x01, 0x00, 0x00, v, 0x00, v, ...delay3(0), 0x00, 0x00]),
      label: `brightness ${v}% (bright_value_v2)`,
      provenance: 'app-template',
    };
  },
  color(hsv) {
    // colour_data_v2: 3B A1 <hue/sat packed> <value> 00 00 <delay x3> <gradient x2> + checksum
    const [hi, lo] = packHueSaturation(hsv.h, hsv.s);
    const v = clamp(Math.round(hsv.v), 1, 100);
    return {
      opcode: OPCODE_COMMAND,
      payload: withChecksum([0x3b, 0xa1, hi, lo, v, 0x00, 0x00, ...delay3(0), 0x00, 0x00]),
      label: `colour h=${hsv.h} s=${hsv.s} v=${v} (0x3B A1)`,
      provenance: 'third-party',
    };
  },
  whiteTemperature(cool, bright) {
    // temp_value_v2: "3bb1000000{cct}{bright}00001e0000" + checksum, opcode 11. The app's
    // 00 00 1e is the 3-byte delay field of the 0x3B family (as in bright_value_v2); it made the
    // change land seconds late, so it is sent as 0 like our other 0x3B commands.
    // Verified on the Quntis 2026-11-04: cct 0 = warm white, 100 = cool white; brightness echoed in state.
    const c = clamp(Math.round(cool), 0, 100);
    const b = clamp(Math.round(bright), 1, 100);
    return {
      opcode: OPCODE_COMMAND,
      payload: withChecksum([0x3b, 0xb1, 0x00, 0x00, 0x00, c, b, ...delay3(0), 0x00, 0x00]),
      label: `white temperature ${c}% cool, brightness ${b}% (temp_value_v2)`,
      provenance: 'app-template',
    };
  },
  scene(effectId, speed, bright) {
    // scene_data_v2: "38{model}{speed}{bright}" + checksum
    return {
      opcode: OPCODE_COMMAND,
      payload: withChecksum([0x38, clamp(effectId, 1, 255), clamp(Math.round(speed), 1, 100), clamp(Math.round(bright), 1, 100)]),
      label: `effect ${effectId} speed ${speed} (scene_data_v2)`,
      provenance: 'app-template',
    };
  },
  stateQueries() {
    return [stateUploadV1()];
  },
};

/**
 * Unified 0x3B commands plus the symphony "E1 21" scene command for effects.
 * For products listing both common2_0 and symphonyE1 (e.g. product 0x86, the Quntis controller).
 * Power, brightness, colour and E1 21 effects verified on the Quntis on 2026-11-03.
 */
export const zenggeV2E1: CommandProfile = {
  ...zenggeV2,
  id: 'zengge_v2_e1',
  name: 'Zengge unified + symphony effects (0x3B / E1 21)',
  namedEffects: true,
  scene(effectId, speed, bright) {
    return builtinEffect(effectId, speed, bright);
  },
  stateQueries() {
    return [stateUploadV1()];
  },
};

/** Older "common" family: 0x71 power and 0x31 RGB, opcode 0x0B, checksummed. */
export const zenggeLegacy: CommandProfile = {
  id: 'zengge_legacy',
  name: 'Zengge legacy (0x71 / 0x31)',
  power(on) {
    // switch_led: "71{open}0f" + checksum
    return {
      opcode: OPCODE_COMMAND,
      payload: withChecksum([0x71, on ? 0x23 : 0x24, 0x0f]),
      label: on ? 'power on (switch_led)' : 'power off (switch_led)',
      provenance: 'app-template',
    };
  },
  brightness() {
    return null; // brightness is folded into the RGB values for this family
  },
  color(hsv) {
    // colour_data (rgb_mini products): "31{r}{g}{b}00000f" + checksum
    const [r, g, b] = hsvToRgb(hsv);
    return {
      opcode: OPCODE_COMMAND,
      payload: withChecksum([0x31, r, g, b, 0x00, 0x00, 0x0f]),
      label: `colour rgb(${r},${g},${b}) (colour_data)`,
      provenance: 'app-template',
    };
  },
  scene(effectId, speed) {
    // symp_scene / classic MagicHome mode command: "61{model}{model}{speed}0f"? varies per product.
    // Not exposed: too product-specific to send blindly.
    void effectId;
    void speed;
    return null;
  },
  stateQueries() {
    return [stateUploadV1()];
  },
};

/**
 * "v3" envelope (0xE0 ...), no checksum, opcode 0x0A. Used by newer symphony / string-light
 * firmware. The JSON templates in the app (switch_led_v3 / scene_data_v3) include a {preview}
 * field; two independent captures of real app traffic show the form `E0 01 00 <mode> ...` which
 * is what is implemented here.
 */
export const symphonyV3: CommandProfile = {
  id: 'symphony_v3',
  name: 'Symphony v3 (0xE0)',
  power(on) {
    return {
      opcode: OPCODE_QUERY,
      payload: Buffer.from([0xe0, 0x01, 0x00, on ? 0x23 : 0x24, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      label: on ? 'power on (e0 01)' : 'power off (e0 01)',
      provenance: 'third-party',
    };
  },
  brightness(percent) {
    const v = clamp(Math.round(percent), 1, 100);
    return {
      opcode: OPCODE_QUERY,
      payload: Buffer.from([0xe0, 0x01, 0x00, 0x01, 0x00, 0x00, v, 0x00, v, 0, 0, 0, 0, 0]),
      label: `brightness ${v}% (e0 01 01)`,
      provenance: 'derived',
    };
  },
  color(hsv) {
    const [hi, lo] = packHueSaturation(hsv.h, hsv.s);
    const v = clamp(Math.round(hsv.v), 1, 100);
    return {
      opcode: OPCODE_QUERY,
      payload: Buffer.from([0xe0, 0x01, 0x00, 0xa1, hi, lo, v, 0x00, 0x00, 0x00, 0x00, 0x14, 0x00, 0x00]),
      label: `colour h=${hsv.h} s=${hsv.s} v=${v} (e0 01 a1)`,
      provenance: 'third-party',
    };
  },
  scene(effectId, speed, bright) {
    // scene_data_v3: "e002{preview}{model}{speed}{bright}", needChecksum false
    return {
      opcode: OPCODE_QUERY,
      payload: Buffer.from([0xe0, 0x02, 0x00, clamp(effectId, 1, 255), clamp(Math.round(speed), 1, 100), clamp(Math.round(bright), 1, 100)]),
      label: `effect ${effectId} speed ${speed} (scene_data_v3)`,
      provenance: 'app-template',
    };
  },
  stateQueries() {
    // state_upload_v2: "ea818a8b" (no checksum) then the classic query as a fallback.
    return [
      { opcode: OPCODE_QUERY, payload: Buffer.from([0xea, 0x81, 0x8a, 0x8b]), label: 'state query (state_upload_v2)', provenance: 'app-template' },
      stateUploadV1(),
    ];
  },
};

/** state_upload: "818A8B96" (the 0x96 is the checksum of 81 8A 8B). */
export function stateUploadV1(): LightCommand {
  return { opcode: OPCODE_QUERY, payload: Buffer.from([0x81, 0x8a, 0x8b, 0x96]), label: 'state query (state_upload)', provenance: 'app-template' };
}

export const PROFILES: Record<ProfileId, CommandProfile> = {
  zengge_v2_e1: zenggeV2E1,
  zengge_v2: zenggeV2,
  zengge_legacy: zenggeLegacy,
  symphony_v3: symphonyV3,
};

/** Parse a user-supplied hex string ("3b 23 00", "3b2300", "0x3b,0x23") into bytes. */
/** Longest raw payload accepted (diagnostics only; real commands are under 100 bytes). */
export const MAX_RAW_BYTES = 512;

export function parseHex(input: string): Buffer {
  const clean = String(input).replace(/0x/gi, '').replace(/[\s,:-]/g, '');
  if (clean.length === 0 || clean.length % 2 !== 0 || /[^0-9a-f]/i.test(clean)) {
    throw new Error('Hex payload must be an even number of hex digits');
  }
  if (clean.length / 2 > MAX_RAW_BYTES) throw new Error(`Hex payload is limited to ${MAX_RAW_BYTES} bytes`);
  return Buffer.from(clean, 'hex');
}
