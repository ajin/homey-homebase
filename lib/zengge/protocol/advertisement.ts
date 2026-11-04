/**
 * Zengge / Surplife BLE advertisement parsing.
 *
 * Ported from com.zengge.hagallbjarkan.device.ZGHBDevice.newDevice() in the Surplife app.
 * The app identifies a compatible controller by an identification block that is either:
 *   - the manufacturer-specific data (AD type 0xFF, 29 bytes incl. the 2-byte company id), or
 *   - service data (AD type 0x16, 16 or 29 bytes) when the device also sends manufacturer data
 *     (in that case the state is read from the manufacturer data at offset 3).
 *
 * Identification block layout (offsets incl. the 2 company-id bytes):
 *   [0]      sta (company id low byte; 0xFF means the controller is in OTA mode)
 *   [1]      0x5A..0x5E (company id high byte; the app rejects anything else)
 *   [2]      manufacturer low byte  -> manufacturer = ([1] << 8) | [2]
 *   [3]      bleVersion
 *   [4..9]   MAC address
 *   [10..11] productId (big endian)
 *   [12]     firmware version (low byte)
 *   [13]     LED version
 *   [14]     bits0-1 checkKeyFlag, bits2-7 firmware version high bits (bleVersion >= 6)
 *   [15]     firmwareFlag (bits 0-4)
 *   [16..26] state (bleVersion >= 5, manufacturer-data-only form)
 *
 * Homey exposes `manufacturerData` as a Buffer and `serviceData` as [{uuid, data}]. Whether the
 * 2-byte company id is included is not documented, so both forms are accepted.
 */

export interface AdvertisementInput {
  localName?: string;
  /** Peripheral MAC address (used only to validate company-id-stripped payloads). */
  address?: string;
  manufacturerData?: Buffer | null;
  serviceData?: Array<{ uuid: string; data: Buffer }> | null;
}

export interface ZenggeAdvertisement {
  sta: number;
  manufacturer: number;
  bleVersion: number;
  mac: string;
  productId: number;
  firmwareVersion: number;
  ledVersion: number;
  checkKeyFlag: number;
  firmwareFlag: number;
  /** Raw state bytes from the advertisement (format depends on bleVersion), if present. */
  state: Buffer | null;
  /** Power according to the advertisement, when it can be determined. */
  powerOn: boolean | null;
  inOtaMode: boolean;
  source: 'manufacturerData' | 'serviceData+manufacturerData';
  localName: string | null;
}

const MFR_HIGH_MIN = 0x5a;
const MFR_HIGH_MAX = 0x5e;

/**
 * Return the identification block with the 2 company-id bytes in front, or null.
 * If the platform stripped the company id, only accept the block when the embedded MAC matches
 * the advertising address (otherwise any 27-byte payload would be accepted).
 */
function normaliseIdBlock(buf: Buffer, validLengths: number[], address?: string): Buffer | null {
  if (validLengths.includes(buf.length) && buf[1] >= MFR_HIGH_MIN && buf[1] <= MFR_HIGH_MAX) return buf;
  if (address && validLengths.map((l) => l - 2).includes(buf.length)) {
    const embedded = buf.subarray(2, 8).toString('hex');
    if (embedded === address.replace(/[^0-9a-f]/gi, '').toLowerCase()) {
      // sta and the company id high byte are unknown in this form.
      return Buffer.concat([Buffer.from([0x00, 0x00]), buf]);
    }
  }
  return null;
}

function readCommon(block: Buffer) {
  const bleVersion = block[3];
  let firmwareVersion = block[12];
  if (bleVersion >= 6 && block.length >= 15) {
    firmwareVersion = ((block[14] >> 2) << 8) | block[12];
  }
  const mac = Array.from(block.subarray(4, 10))
    .map((x) => x.toString(16).padStart(2, '0'))
    .join(':')
    .toUpperCase();
  return {
    sta: block[0],
    manufacturer: (block[1] << 8) | block[2],
    bleVersion,
    mac,
    productId: (block[10] << 8) | block[11],
    firmwareVersion,
    ledVersion: block[13],
  };
}

function powerFrom(byte: number | undefined): boolean | null {
  if (byte === 0x23) return true;
  if (byte === 0x24) return false;
  return null;
}

/**
 * Parse an advertisement. Returns null when it is not a Zengge ZGHB controller, using the same
 * acceptance rules as the official app.
 */
export function parseAdvertisement(adv: AdvertisementInput): ZenggeAdvertisement | null {
  const mfr = adv.manufacturerData && adv.manufacturerData.length > 0 ? adv.manufacturerData : null;
  const sd = (adv.serviceData ?? []).map((s) => s.data).filter((d) => d && d.length > 0);
  const localName = adv.localName ?? null;

  // Variant 2: service data carries identification, manufacturer data carries state.
  for (const data of sd) {
    const id = normaliseIdBlock(data, [16, 29], adv.address);
    if (!id || !mfr) continue;
    const common = readCommon(id);
    let state: Buffer | null = null;
    let checkKeyFlag = 0;
    let firmwareFlag = 0;
    if (common.bleVersion >= 5) {
      checkKeyFlag = id[14] & 0x03;
      firmwareFlag = id[15] & 0xff;
      // App reads state from the *raw* manufacturer AD payload (company id included) at offset 3.
      const rawMfr = mfr.length >= 29 ? mfr : Buffer.concat([Buffer.alloc(2), mfr]);
      if (common.bleVersion >= 7) {
        state = rawMfr.length >= 28 ? Buffer.from(rawMfr.subarray(3, 28)) : null;
      } else {
        state = Buffer.from(rawMfr.subarray(3));
      }
    }
    return {
      ...common,
      checkKeyFlag,
      firmwareFlag,
      state,
      // lednetwf_ble (hardware-tested) reads power at state[11] for bleVersion >= 7.
      powerOn: state && common.bleVersion >= 7 ? powerFrom(state[11]) : null,
      inOtaMode: common.sta === 0xff,
      source: 'serviceData+manufacturerData',
      localName,
    };
  }

  // Variant 1: manufacturer data only (29 bytes incl. company id).
  if (mfr) {
    const id = normaliseIdBlock(mfr, [29], adv.address);
    if (!id) return null;
    const common = readCommon(id);
    let state: Buffer | null = null;
    let checkKeyFlag = 0;
    let firmwareFlag = 0;
    if (common.bleVersion >= 5) {
      checkKeyFlag = id[14] & 0x03;
      firmwareFlag = id[15] & 0x1f;
      state = Buffer.from(id.subarray(16, 27));
    }
    return {
      ...common,
      checkKeyFlag,
      firmwareFlag,
      state,
      // State block starts with the power byte (0x23 on / 0x24 off), same order as the 0x81 reply.
      powerOn: state ? powerFrom(state[0]) : null,
      inOtaMode: common.sta === 0xff,
      source: 'manufacturerData',
      localName,
    };
  }
  return null;
}
