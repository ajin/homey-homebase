import Homey from 'homey';
import { HamulightRadio, HeardFrame } from '../../lib/hamulight/radio';
import { levelsInfo, RemoteLearner } from '../../lib/hamulight/learning';
import { checksumOk, commandByte, frameHex, hex, LearnedRemote, parseFrameHex } from '../../lib/hamulight/protocol';
import type HamulightDevice = require('./device');

/** Status sent to the pairing views. */
function viewStatus(learner: RemoteLearner) {
  const s = learner.status();
  return {
    phase: s.phase,
    remoteId: s.remoteId === null ? null : hex(s.remoteId, 4),
    toggle: s.toggle === null ? null : frameHex(s.toggle),
    levels: s.levels.length,
    presses: s.presses.map((p) => ({ code: frameHex(p.frame), count: p.count })),
    calculated: s.calculated,
  };
}

class HamulightDriver extends Homey.Driver {
  radio!: HamulightRadio;
  private pairCounter = 0;

  async onInit(): Promise<void> {
    this.radio = new HamulightRadio(this.homey, (...args) => this.log(...args));
    this.radio.on('frame', (h: HeardFrame) => {
      // Button frames (top bit of the command set, e.g. A0 on/off) are logged with every repeat, to
      // see how Homey delivers one press; ring positions only once per touch.
      if (!h.repeat || commandByte(h.frame) >= 0x80) {
        this.log(`Heard 433 MHz Hamulight code ${frameHex(h.frame)}${h.repeat ? ' (repeat)' : ''}`);
      }
    });

    this.homey.flow.getActionCard('hamulight_toggle').registerRunListener(async (args: { device: HamulightDevice }) => {
      await args.device.pressToggle();
    });
    this.homey.flow.getActionCard('hamulight_set_state').registerRunListener(async (args: { device: HamulightDevice; state: 'on' | 'off' }) => {
      await args.device.markState(args.state === 'on');
    });
    this.homey.flow.getActionCard('hamulight_send_code').registerRunListener(async (args: { device: HamulightDevice; code: string }) => {
      const frame = parseFrameHex(args.code);
      if (frame === null) throw new Error('Enter the code as 8 hex digits, for example 351BA045');
      await args.device.sendFrame(frame);
    });
    this.log('Hamulight 433 MHz driver initialised');
  }

  async onPair(session: Homey.Driver.PairSession): Promise<void> {
    await this.runLearnSession(session, null);
  }

  async onRepair(session: Homey.Driver.PairSession, device?: Homey.Device): Promise<void> {
    await this.runLearnSession(session, (device as HamulightDevice | undefined) ?? null);
  }

  /** Shared by pairing and repair: listen on 433 MHz and teach the remote. */
  private async runLearnSession(session: Homey.Driver.PairSession, device: HamulightDevice | null): Promise<void> {
    const who = `pair-${++this.pairCounter}`;
    const learner = new RemoteLearner();
    const onFrame = (h: HeardFrame) => {
      if (learner.add(h.frame, h.repeat)) session.emit('status', viewStatus(learner)).catch(() => undefined);
    };
    this.radio.on('frame', onFrame);
    let listening: Promise<void> | null = null;
    const startListening = () => {
      listening ??= this.radio.listen(who);
      return listening;
    };

    session.setHandler('start', async () => {
      await startListening();
      return { mode: device ? 'repair' : 'pair', status: viewStatus(learner) };
    });
    session.setHandler('status', async () => viewStatus(learner));
    session.setHandler('restart', async () => {
      learner.restart();
      return viewStatus(learner);
    });
    session.setHandler('restart_levels', async () => {
      learner.restartLevels();
      return viewStatus(learner);
    });
    session.setHandler('manual_code', async (code: string) => {
      const frame = parseFrameHex(String(code ?? ''));
      if (frame === null) throw new Error('Enter the code as 8 hex digits, for example 351BA045');
      learner.setToggle(frame);
      return viewStatus(learner);
    });
    // Lets the user check the learned on/off code before adding the light.
    session.setHandler('test_toggle', async () => {
      const r = learner.result();
      if (!r) throw new Error('No on/off code learned yet');
      await this.radio.send(r.toggle, 10);
      return true;
    });
    session.setHandler('finish', async () => {
      const r = learner.result();
      if (!r) throw new Error('No on/off code learned yet');
      if (device) {
        await device.applyLearned(r);
        return { done: true };
      }
      return { device: this.deviceDescriptor(r) };
    });
    session.setHandler('disconnect', async () => {
      this.radio.off('frame', onFrame);
      await this.radio.unlisten(who);
    });
  }

  private deviceDescriptor(r: LearnedRemote) {
    const id = hex(r.remoteId, 4);
    return {
      name: 'Hamulight light',
      data: { id: `hamulight-${id}-${Date.now().toString(36)}` },
      store: { remoteId: r.remoteId, toggle: r.toggle, levels: r.levels },
      settings: {
        info_remote: `${id} / ${frameHex(r.toggle)}`,
        info_levels: levelsInfo(r),
        dim_source: checksumOk(r.toggle) ? 'ring' : r.levels.length >= 2 ? 'learned' : 'generated',
      },
    };
  }
}

export = HamulightDriver;
