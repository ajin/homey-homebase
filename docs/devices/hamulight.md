# Hamulight 433 MHz lights (L2046)

Hamulight LED spot sets for verandas, canopies and soffits, powered by the **L2046** LED driver
and controlled with a handheld 433 MHz remote (for example the **HM3002**, with an on/off button
and a round touch ring for brightness). Homebase sends the remote's own radio codes from Homey's
433 MHz radio, so the remote keeps working next to Homey.

In Homey: **Devices → + → Homebase → Hamulight Light (433 MHz)**.

Not affiliated with Hamulight.

## Supported models

| Product | Remote | Technical ids | Status |
|---------|--------|---------------|--------|
| **Hamulight LED driver L2046** (Prim. 220-240 V AC, Sec. 3.6 V DC 6 A, "LEDspots 4-12 stuks") | HM3002 (on/off + touch ring) | 433.92 MHz, OOK, 200 µs symbols, 32-bit frames with a 16-bit remote id | 🟡 Implemented, testing on real hardware |
| Other Hamulight sets with a 433 MHz **OOK** remote (e.g. L2046-CON12 sets) | | same frame format | 🟡 Should work if pairing finds the remote |
| **Hamulight Apex L2446** | L2446 | FSK modulation | ❌ Not supported: Homey's 433 MHz receiver only does OOK/ASK |

## What you need

* A **Homey Pro** with a 433 MHz radio (Homey Pro 2023 and Homey Pro 2016-2019). Homey Bridge and
  Homey Cloud are not supported.
* The light's own remote, for teaching. Each remote has its own id, so codes from another
  installation do not work: Homey learns yours.
* Homey within radio range of the light (try first with Homey in the same room or close by). A
  Homey Bridge in satellite mode can send instead: device → settings → Advanced settings →
  antenna (shown after the light has been switched once from Homey).

## Adding the light

1. **Devices → + → Homebase → Hamulight Light (433 MHz).**
2. **Press on/off** on the remote, near Homey. Homey shows *Remote found* with the remote id and
   the on/off code (for example `4516A050`). One press is enough.
3. Tap **Test**: the light should switch after a few seconds.
4. Tap **Add light**.

Each light only accepts the remote it learned, so Homey copies your remote's id; codes from
another installation do not work. Remotes like the HM3002 need nothing more: brightness is
calculated from the ring position. For an unknown remote type, pairing asks to slide along the
ring from darkest to brightest so it can record the brightness codes.

**After adding:**

* **Antenna** (device → settings → Advanced settings, shown after the light was switched once
  from Homey): send from the Homey Pro or a Homey Bridge in satellite mode, whichever is closer.
* **Follow the handheld remote:** keeps on/off in Homey right when the remote is used near Homey.
* **Brightness ring:** darkest and brightest ring positions, if your light's range differs.

To teach the remote again later: open the device → settings (cog) → **Repair**.

## Features

* **On/off and brightness** from Homey, Flows and voice assistants.
* **Follows the handheld remote:** when the remote is used within range of Homey, on/off and the
  preset keys (25/50/75/100 %) update Homey (setting *Follow the handheld remote*).
* **Flow cards:** *On/off button on the handheld remote was pressed* (trigger), *Press the on/off
  button*, *Mark as on/off without sending* (to correct the state) and *Send 433 MHz code*
  (testing).

## Limitations

* **The light only knows "toggle".** There is no separate on and off code and the light never
  reports its state. Homey keeps track itself, so if the remote is used out of Homey's range, the
  state in Homey can be wrong. Fix it with *Mark as on/off without sending*, or the *Press the
  on/off button* card.
* Brightness from Homey sets a position on the ring (about 1 % per step). Homey sends one
  command per change, so the light jumps to the new level instead of fading.
* Commands reach the light almost at once with the installed app. (While developing with
  `homey app run`, every 433 MHz send took about 5 s; see the research notes.)
* Remote presses less than 3 s apart show in Homey as one press (Homey receives each press in
  batches up to about 2.5 s apart, so a shorter window would count one press twice).
* Switching on/off and dimming are one-way radio commands: Homey cannot confirm the light received
  them. Raise *Repeats per command* if commands are missed.

## Credits

The protocol was reverse engineered by others; see [hamulight/RESEARCH.md](../hamulight/RESEARCH.md).
