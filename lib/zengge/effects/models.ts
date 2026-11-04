/**
 * Display names for controller models, used by the app settings to show which light and model an
 * effect list belongs to. Product ids come from the controller's advertisement.
 *
 * Zengge publishes no model names, so the names describe the controller (as in the README's
 * supported devices table), with a known shop brand where there is one.
 */
const NAMES: Record<number, string> = {
  0x86: 'Zengge Symphony RGBWW controller · sold as Quntis',
};

export function productName(productId: number): string {
  const hex = `0x${productId.toString(16).padStart(2, '0')}`;
  const name = NAMES[productId];
  return name ? name.replace(' · ', ` · ${hex} · `) : `Zengge Bluetooth light · ${hex}`;
}
