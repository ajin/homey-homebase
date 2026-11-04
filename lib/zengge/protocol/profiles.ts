/**
 * Choose a command profile for a controller, using the app's own product catalogue.
 */
import { PRODUCT_CATALOG, CatalogEntry } from './productCatalog';
import { ProfileId } from './commands';

export interface ProfileChoice {
  profile: ProfileId;
  reason: string;
  catalog: CatalogEntry | null;
}

export function describeProduct(productId: number): CatalogEntry | null {
  return PRODUCT_CATALOG[productId] ?? null;
}

/**
 * Pick the most likely working profile.
 * - Products declaring "common2_0" (and firmware >= its deviceMinVer) get the unified 0x3B set.
 * - bleVersion >= 5 without catalogue data also gets 0x3B (the BLE-only bright_value_v2 template
 *   in ble_dp_cmd.json is a 0x3B command).
 * - Otherwise fall back to the legacy 0x71/0x31 set.
 * The user can override this in device settings.
 */
export function chooseProfile(productId: number, bleVersion: number, firmwareVersion: number): ProfileChoice {
  const catalog = describeProduct(productId);
  if (catalog) {
    const minV2 = catalog.protocols.common2_0;
    const minE1 = catalog.protocols.symphonyE1;
    if (minV2 !== undefined && firmwareVersion >= minV2 && minE1 !== undefined && firmwareVersion >= minE1) {
      return { profile: 'zengge_v2_e1', reason: `product 0x${productId.toString(16)} lists common2_0 and symphonyE1`, catalog };
    }
    if (minV2 !== undefined && firmwareVersion >= minV2) {
      return { profile: 'zengge_v2', reason: `product 0x${productId.toString(16)} lists common2_0 (fw >= ${minV2})`, catalog };
    }
    if (minV2 !== undefined) {
      return { profile: 'zengge_legacy', reason: `product lists common2_0 only from fw ${minV2}; device reports ${firmwareVersion}`, catalog };
    }
    return { profile: 'zengge_legacy', reason: `product 0x${productId.toString(16)} has no common2_0 protocol`, catalog };
  }
  if (bleVersion >= 5) {
    return { profile: 'zengge_v2', reason: `unknown product 0x${productId.toString(16)}, bleVersion ${bleVersion} >= 5`, catalog: null };
  }
  return { profile: 'zengge_legacy', reason: `unknown product, bleVersion ${bleVersion}`, catalog: null };
}
