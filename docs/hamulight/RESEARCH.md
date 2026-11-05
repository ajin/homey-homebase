# Hamulight L2046 433 MHz protocol notes

## Sources

* [aukedejong/esphome-hamulight](https://github.com/aukedejong/esphome-hamulight): ESPHome light
  for L2046 spots. Gives the toggle and dim messages as 200 µs symbol strings (1 = carrier on).
* [RFD-FHEM/RFFHEM issue 1206](https://github.com/RFD-FHEM/RFFHEM/issues/1206): SIGNALduino
  protocol 22 for Hamulight; 32-bit frames, remote ids `3605`, `8F99`, `CAE4`, `F86E`.
* [Home Assistant thread](https://community.home-assistant.io/t/project-share-esphome-hamulight-led-spots-control/358271):
  the ESPHome codes did not work for most other users (different remote id).
* [Homey Community: Hamulight support](https://community.homey.app/t/hamulight-support/142392):
  L2446 (Apex) cloning failed; that remote uses FSK.

## Frame format (verified against the published captures, see test/hamulight/protocol.test.ts)

```
start  H200 L200 H200 L200 H1200 L1200   (the real remote sends four short pairs, see below)
bits   32 x (0 = H200 L600, 1 = H600 L200), most significant bit first
end    H200 L200 H200
```

This is the form Homey's receive definition matches (`.homeycompose/signals/433/hamulight.json`);
sending uses `hamulight_tx.json`, which follows the real remote more closely (below).

Decoding the aukedejong captures this way gives:

| Message | Frame | |
|---------|-------|---|
| toggle | `351B A045` | remote id `351B`, then `A045` |
| dim | `351B` + `0` + 15-bit level | level 20479 (darkest) … 256, 32767 … 24357 (brightest) |

### HM3002 (remote `4516`), captured with Homey on 2026-11-05

| Button | Frame |
|--------|-------|
| on/off | `4516 A050` (command `A0`, same as the L2046 capture above) |
| brightness ring | `4516 3CEC`, `4516 3DED`, `4516 3EEE`, … (command = ring position) |

Preset keys: `AA`, `A9`, `AF`, `A6` (25, 50, 75, 100 %), verified with this remote.

With a weak battery the ring kept sending by itself: position `3C` every 1-5 s (and at first a
steady stream alternating `3D`/`3E`), which pulled the brightness back down. A new battery
stopped it.

**Checksum:** byte 3 = (id high byte + id low byte + command + 0x55) & 0xFF. It holds for every
HM3002 frame above, for the published `351B A045` and, once FHEM's inverted bit sense is undone,
for the RFFHEM remote `3605` (below). It does not hold for aukedejong's dim levels, which were
fitted rather than captured.

Homebase learns only the remote id from the user's remote (a frame with command `A0` and a valid
checksum is on/off at once) and builds every other frame itself: on/off, and brightness as a
ring position (setting *Brightness codes* = *Ring position*). Recording ring codes during pairing
is only used for remotes whose frames do not carry this checksum. The *Calculated (experimental)*
option uses aukedejong's formula, whose frames fail the checksum; it is kept only for such
remotes.

## How the real remote sends (confirmed 2026-11-05)

* [RFFHEM protocol 22](https://github.com/RFD-FHEM/RFFHEM/blob/master/lib/FHEM/Devices/SIGNALduino/SD_Protocols/Data.pm):
  clockabs 200, start `[1,-1,1,-1,6,-6]`, one `[1,-3]`, zero `[3,-1]`, 32 bits, 433.92 MHz. FHEM's
  bit sense is the inverse of ours: its remote `3605` with on/off `5F47` is `C9FA A0B8` here and
  fits the same checksum.
* Raw captures ([issue 1206](https://github.com/RFD-FHEM/RFFHEM/issues/1206)): **exactly 10 frames per
  press, back to back with no gap**, each preceded by four H200 L200 pairs and the H1200 L1200 sync;
  the first frame starts with a short ~130 µs pulse (what aukedejong's 84 µs pulse imitates). All
  frames of one press are identical (no toggle bit, no rolling code).
* FHEM users report that their light ignores further toggles for about 8-10 s. The tested L2046
  follows remote presses 2 s apart, so Homebase keeps only 2 s between its own toggles.
* Preset keys: `AA`, `A9`, `AF`, `A6` = 25, 50, 75, 100 %
  ([klockie86/Hamulight2MQTT](https://github.com/klockie86/Hamulight2MQTT), RFFHEM dim_1..4).
* Ring: FHEM maps 0-100 % to 1.17 x pct + 170 (minus 127 above 254) in its inverted bits, i.e.
  position `55` (darkest) counting down through `00`/`7F` to `5F` (brightest) here.
* The receiver learns one remote: power off/on, then press the upper button 5 times
  ([HA thread](https://community.home-assistant.io/t/project-share-esphome-hamulight-led-spots-control/358271)).
  Only the learned remote id is accepted, so each installation needs its own id.
* aukedejong's calculated dim frames fail the checksum for every level; do not copy them.

Homebase sends accordingly (`hamulight_tx`): lead pulse, 4 pairs + sync, frames without gaps,
at least 2 s between toggles. Homey allows 3 such frames per transmission (256 pulse intervals).
Sending 10 as 2 frames x 5 Homey repetitions sometimes made the light switch on and straight off
again (Homey leaves gaps between repetitions, so the light saw two presses), so Homebase sends
one unbroken transmission of 3 frames.

## Homey Pro 2023

Receiving: Homey hands frames to the app in batches. One remote press (10 frames, 0.3 s on air)
arrived as 1-2 batches of 3-6 frames, up to 2.4 s apart; frames within a batch arrive within a few
ms. Homebase therefore treats on/off repeats within 3 s as the same press. Homey also hears its
own transmissions back (seen up to 3.4 s later), so the device ignores its own codes for 5 s.

Send delay: with the app running as a development build (`homey app run`), every send took about
4.7 s plus air time before the light reacted (measured with a dummy remote id: a predefined
`cmd()` of a minimal one-frame signal 4.76-4.83 s, `tx()` of one frame 4.70-4.77 s, ten frames
about 5.04 s), with receiving on or off and through a Homey Bridge alike. Installed with
`homey app install`, sending 2 frames x 5 Homey repetitions still took about 4 s, while one
unbroken transmission without repetitions reacts almost at once (2026-11-05, timed by eye). So
both the development build and Homey's repetitions add delay; measure installed builds before
blaming the platform.

Setting `carrier` to 433920000 made the light stop reacting (Homey's default carrier works).

Satellite mode: with `"rf433": { "satelliteMode": true }` in the driver manifest and the device
passed to `tx()`, the device gets an antenna choice (Homey Pro or a Homey Bridge) under Advanced
settings. Both antennas reached the light.

## Answered during testing (2026-11-05)

* **Ring range:** position `55` (darkest) counting down through `00`/`7F` to `5F` (brightest), from
  the RFFHEM mapping. On the HM3002 light, brightness from Homey across this range (5-100 %) and
  the remote's presets all set the expected levels. (One 33 % command was missed early on, before
  the framing was fixed.)
* **A brightness code does not switch the light on** when it is off: a 100 % code sent while the
  light was off left it off. The driver sends on/off first.
