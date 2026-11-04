import Homey from 'homey';
import { describeEntry, scan } from '../../lib/zengge/discovery';
import { chooseProfile } from '../../lib/zengge/protocol/profiles';
import { CATEGORY_TITLES } from '../../lib/zengge/effects/library';
import type ZenggeBleLightDevice = require('./device');

class ZenggeBleLightDriver extends Homey.Driver {
  async onInit(): Promise<void> {
    this.homey.flow.getActionCard('run_effect').registerRunListener(async (args: { device: ZenggeBleLightDevice; effect: number; speed: number }) => {
      await args.device.runEffect(args.effect, args.speed);
    });
    const runEffectCard = this.homey.flow.getActionCard('run_named_effect');
    runEffectCard.registerRunListener(async (args: { device: ZenggeBleLightDevice; effect: { id: string }; speed: number }) => {
      await args.device.runEntry(args.effect.id, args.speed);
    });
    // Each light offers only what it can play (its model's scenes and its own effects).
    runEffectCard.registerArgumentAutocompleteListener('effect', async (query: string, args: { device?: ZenggeBleLightDevice }) => {
      const q = query.trim().toLowerCase();
      if (!args.device) return [];
      return args.device.effectLibrary()
        .filter((e) => !q || e.name.toLowerCase().includes(q) || CATEGORY_TITLES[e.category].toLowerCase().includes(q))
        .map((e) => ({ id: e.id, name: e.name, description: CATEGORY_TITLES[e.category] }));
    });
    this.homey.flow.getActionCard('query_state').registerRunListener(async (args: { device: ZenggeBleLightDevice }) => {
      await args.device.queryState();
    });
    this.homey.flow.getActionCard('unpair_remotes').registerRunListener(async (args: { device: ZenggeBleLightDevice }) => {
      await args.device.unpairAllRemotes();
    });
    this.homey.flow.getActionCard('send_raw').registerRunListener(
      async (args: { device: ZenggeBleLightDevice; opcode: number; hex: string; checksum: 'append' | 'none' }) => {
        await args.device.sendRaw(args.opcode, args.hex, args.checksum === 'append');
      },
    );
    this.homey.flow.getConditionCard('is_connected').registerRunListener(async (args: { device: ZenggeBleLightDevice }) => args.device.isLinkOpen());
    this.log('Zengge Bluetooth light driver initialised');
  }

  async onPairListDevices() {
    const { recognised, unrecognisedZenggeOui } = await scan(this.homey.ble);
    for (const e of unrecognisedZenggeOui) {
      // Zengge OUI but not the ZGHB advertisement format: log it so it can be analysed.
      this.log('Zengge-OUI device with unrecognised advertisement:', JSON.stringify(describeEntry(e)));
    }
    this.log(`Pairing scan: ${recognised.length} compatible controller(s)`);
    return recognised
      .filter((e) => e.parsed && !e.parsed.inOtaMode)
      .map((e) => {
        const p = e.parsed!;
        const choice = chooseProfile(p.productId, p.bleVersion, p.firmwareVersion);
        this.log('Found', JSON.stringify(describeEntry(e)));
        return {
          name: `${e.localName || 'Surplife light'} (${p.mac.slice(-5)})`,
          data: { id: e.peripheralUuid },
          store: {
            peripheralUuid: e.peripheralUuid,
            mac: p.mac,
            productId: p.productId,
            bleVersion: p.bleVersion,
            firmwareVersion: p.firmwareVersion,
            ledVersion: p.ledVersion,
            autoProfile: choice.profile,
          },
        };
      });
  }
}

export = ZenggeBleLightDriver;
