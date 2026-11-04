/**
 * Which handheld radio remotes the controller obeys: the Surplife app's "Remote Control Settings"
 * (Bluetooth / 2.4 GHz remotes and control panels; infrared remotes and phones are not affected).
 *
 * Source: lightinglibs/flux_led (protocol.py: RemoteConfig, construct_remote_config,
 * construct_query_remote_config, construct_unpair_remotes), written for Zengge Wi-Fi controllers.
 * The same inner commands work over Bluetooth: on the Quntis (product 0x86) the query sent with
 * opcode 0x0A was answered with `2B 02 00 00 91 78 FF 1F 79 44 00 00 2C 3D` (2026-11-04), i.e.
 * "open" and 0 paired remotes, matching the Surplife app.
 */
import { checksum, LightCommand, OPCODE_COMMAND, OPCODE_QUERY } from './commands';

export type RemoteMode = 'disabled' | 'open' | 'paired_only';

const MODE_BYTES: Record<RemoteMode, number> = { disabled: 0x01, open: 0x02, paired_only: 0x03 };

/** The controller's factory setting: every remote of the right type works. */
export const DEFAULT_REMOTE_MODE: RemoteMode = 'open';

function withSum(bytes: number[]): Buffer {
  return Buffer.from([...bytes, checksum(bytes)]);
}

/** Ask which remotes are allowed and how many are paired (answer: see parseRemoteConfig). */
export function remoteConfigQuery(): LightCommand {
  return { opcode: OPCODE_QUERY, payload: withSum([0x2b, 0x2c, 0x2d]), label: 'remote settings query', provenance: 'third-party' };
}

export function setRemoteMode(mode: RemoteMode): LightCommand {
  const payload = withSum([0x2a, MODE_BYTES[mode], 0xff, 0xff, 0xff, 0xff, 0xff, 0, 0, 0, 0, 0, 0, 0, 0x0f]);
  return { opcode: OPCODE_COMMAND, payload, label: `remote settings: ${mode}`, provenance: 'third-party' };
}

export function unpairRemotes(): LightCommand {
  const payload = withSum([0x2a, 0xff, 0xff, 0x01, 0xff, 0xff, 0xff, 0, 0, 0, 0, 0, 0, 0, 0xf0]);
  return { opcode: OPCODE_COMMAND, payload, label: 'unpair all remotes', provenance: 'third-party' };
}

export interface RemoteConfig {
  mode: RemoteMode;
  paired: number;
}

/** Decode a reply to remoteConfigQuery: `2B <mode> 00 <paired remotes> … <checksum>`. */
export function parseRemoteConfig(data: Buffer): RemoteConfig | null {
  if (data.length < 5 || data[0] !== 0x2b) return null;
  if (checksum(data.subarray(0, data.length - 1)) !== data[data.length - 1]) return null;
  const mode = (Object.keys(MODE_BYTES) as RemoteMode[]).find((m) => MODE_BYTES[m] === data[1]);
  return mode ? { mode, paired: data[3] } : null;
}
