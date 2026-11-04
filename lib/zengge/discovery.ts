/**
 * BLE scanning shared by the pairing flow and the diagnostics API.
 */
import type Homey from 'homey';
import { parseAdvertisement, ZenggeAdvertisement } from './protocol/advertisement';
import { chooseProfile } from './protocol/profiles';

/** IEEE OUI registered to JM Zengge Co., Ltd. (seen on the Quntis controller). */
export const ZENGGE_OUIS = ['08:65:f0'];

export interface ScanEntry {
  peripheralUuid: string;
  address: string;
  localName: string | null;
  rssi: number;
  connectable: boolean;
  parsed: ZenggeAdvertisement | null;
  /** Raw advertisement data, hex, for diagnostics. Contains no secrets. */
  manufacturerData: string;
  serviceData: Array<{ uuid: string; data: string }>;
  serviceUuids: string[];
}

function hasZenggeOui(address: string): boolean {
  const a = address.toLowerCase();
  return ZENGGE_OUIS.some((o) => a.startsWith(o));
}

export async function scan(ble: Homey.Homey['ble']): Promise<{ recognised: ScanEntry[]; unrecognisedZenggeOui: ScanEntry[] }> {
  const ads = await ble.discover();
  const recognised: ScanEntry[] = [];
  const unrecognisedZenggeOui: ScanEntry[] = [];
  for (const adv of ads) {
    const parsed = parseAdvertisement({
      localName: adv.localName,
      address: adv.address,
      manufacturerData: adv.manufacturerData,
      serviceData: adv.serviceData,
    });
    const entry: ScanEntry = {
      peripheralUuid: adv.uuid,
      address: adv.address,
      localName: adv.localName || null,
      rssi: adv.rssi,
      connectable: adv.connectable,
      parsed,
      manufacturerData: adv.manufacturerData ? Buffer.from(adv.manufacturerData).toString('hex') : '',
      serviceData: (adv.serviceData ?? []).map((s) => ({ uuid: s.uuid, data: Buffer.from(s.data).toString('hex') })),
      serviceUuids: adv.serviceUuids ?? [],
    };
    if (parsed) recognised.push(entry);
    else if (hasZenggeOui(adv.address ?? '')) unrecognisedZenggeOui.push(entry);
  }
  return { recognised, unrecognisedZenggeOui };
}

export function describeEntry(e: ScanEntry): Record<string, unknown> {
  const p = e.parsed;
  return {
    address: e.address,
    name: e.localName,
    rssi: e.rssi,
    productId: p ? `0x${p.productId.toString(16)}` : null,
    bleVersion: p?.bleVersion ?? null,
    firmware: p?.firmwareVersion ?? null,
    ledVersion: p?.ledVersion ?? null,
    suggestedCommandSet: p ? chooseProfile(p.productId, p.bleVersion, p.firmwareVersion) : null,
    manufacturerData: e.manufacturerData,
    serviceData: e.serviceData,
    serviceUuids: e.serviceUuids,
  };
}
