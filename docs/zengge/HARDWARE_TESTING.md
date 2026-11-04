# Hardware verification checklist (Quntis NS-I-204-M-E)

The goal is to move every feature from "implemented from research" to "verified on hardware".
Record results in the table at the bottom and commit them.

## 0. Before you start

* Close the Surplife phone app (force-quit) so it does not hold the BLE connection.
* Power the string and keep the Homey Pro within a few metres for the first tests.

## 1. Advertisement capture (no Homey needed)

Using **nRF Connect** (Android/iOS):

1. Scan, find MAC `08:65:F0:12:34:56` (iOS shows a UUID instead; match by name/RSSI).
2. Record: advertised name, RSSI, and the raw advertisement (tap the device, then **RAW**). Save
   the hex.
3. Check: is there a Manufacturer Specific Data entry with company id `0x5Axx`? Note its bytes.
   Is there Service Data for `0xFFFF`?
4. Connect. Record all services/characteristics. Expected: service `FFFF` with `FF01`
   (Write / Write No Response) and `FF02` (Notify). Note any other services.
5. Note whether the phone asks to pair/bond. (Expected: no.)

## 2. Homey scan

1. `npx homey login`, then `npx homey app run` (the app runs on your Homey with live logs).
2. Add device → Homebase → Surplife Bluetooth Light.
3. The log prints `Found {...}` with `productId`, `bleVersion`, `firmware` and the suggested
   command set. Copy this line into the results.
4. If the light is **not listed**, look for `Zengge-OUI device with unrecognised advertisement`
   in the log and send that line (it has the raw advertisement bytes).

You can repeat the scan any time via the Web API endpoint
`GET /api/app/com.rxd7.homebase/diagnostics/scan`.

## 3. Basic commands

In device settings enable **Diagnostic logging**. Then, one at a time, with the log open:

| Test | How | Expected log | Result |
|------|-----|--------------|--------|
| Connect | open the device | `connected; chars ffff…` | |
| State query | Flow: "Ask the controller for its state" | `State reply …` | |
| Off | toggle off | `write -> power off` and lights go off | |
| On | toggle on | lights on | |
| Brightness | dim to 20% | visibly dimmer | |
| Colour | pick red, then blue | colour changes, hue correct | |
| Effect | Flow "Run built-in effect 1 at speed 50%" | animation starts | |

If a test fails, change **Command set** in device settings (try `Symphony v3 (0xE0)`, then
`Zengge legacy`) and repeat. If nothing reacts at all, set **Maximum BLE packet size** to 20.

## 4. If nothing works: capture the official app

1. Android: Developer options → enable *Bluetooth HCI snoop log*, toggle Bluetooth off/on.
2. In the Surplife app: on, off, brightness 100 → 10, red, green, blue, two effects, speed
   slider min/max. Wait ~5 s between actions and note the times.
3. `adb bugreport` and extract `btsnoop_hci.log`.
4. Look at ATT writes to the `FF01` handle. Each starts `00 <seq> 80 00 <len> <len> <len+1> <opcode>`.
   The bytes after the opcode are the command payload. Send those back with the
   **Send raw command** Flow card (choose "as-is") to confirm, then add them to
   `lib/zengge/protocol/commands.ts` with provenance `app-template` or a new `captured-quntis` value.

## 5. Results

Quntis NS-I-204-M-E, tested 2026-11-03 on Homey Pro (Homey Pro 2023 platform, app run over CLI).

| Item | Value / result |
|------|---------------|
| Advertised name | `IOTBT123` |
| productId / bleVersion / firmware / ledVersion | 0x86 (134) / 7 / 44 / 7 |
| Advertisement form | service data (UUID 0x5A02, 14 bytes, company id stripped by Homey) + manufacturer data (29 bytes incl. company id 0x5A02) |
| Company id in Homey `manufacturerData`? | Yes (first two bytes `02 5a`) |
| GATT | `ffff{ff01, ff02}`, `fe00{ff11, ff22}`, `1801`, `1800` (Homey does not report characteristic properties) |
| Pairing/bonding requested | No |
| Catalogue entry | app `wifiDevices` table: category hc3, protocols common, common1_0, common2_0, symphonyE1, symphonyE4 |
| Working command set | `zengge_v2_e1` (0x3B for power/brightness/colour, E1 21 for effects) |
| Power on/off | **Verified**: `3b 23 …` / `3b 24 …`, opcode 0x0B, checksum |
| Brightness | **Verified** 1–100 %: `3b 01 00 00 v 00 v …`. Note: this switches the light to white (saturation 0), so the app re-sends the colour when dimming a colour |
| Colour | **Verified**: `3b a1 <hue<<7\|sat> v …` |
| Effects | **Verified**: `E1 21` (opcode 0x0A) pattern 0x19 animates. `38 …` (scene_data_v2) and `E0 02 …` (scene_data_v3, opcode 0x0A or 0x0B) are ignored (no reply, no change) |
| State notifications | **Verified**: opcode 12, JSON `{"code":0,"payload":"EA81…"}` after every accepted command; reply to `81 8a 8b 96` query comes as opcode 10 with the same JSON |
| State layout (EA81) | [6] power 23/24, [7] 24 static / 25 effect, [8] 14 static or effect id, [9] speed, [11..12] packed hue/sat, [13] colour level, [15] white level |
| Reconnect after idle disconnect | **Verified**: link re-established in ~0.6 s on the next command |
| Packet size | 255 (single frame) works |
| Phone app still works after Homey idle disconnect | not tested |
| Hue accuracy across the wheel | Encoding correct (red 0, green 120, blue 240 land exactly). Strong green LEDs shift warm colours: device hue 5-10 looks orange, 13 yellow, 30-90 green. A calibrated correction (`lib/zengge/protocol/colorCorrection.ts`, device setting "Colour correction", on by default) maps Homey orange 30 -> 7, yellow 60 -> 13, yellow-green 90 -> 24; verified by eye. Blue side left uncorrected: cyan (180) and purple (280) look pale/whitish and 320 reads as purple; judging these through a webcam was not reliable enough to calibrate |
| Named effect palettes other than Christmas 1 | not individually checked |
| Built-in effects | **Verified**: `E1 21 00 <bri> <n> 00 01 64 <speed> 00x6 <count> <colours>` (opcode 0x0A) runs built-in effect n. A colour list is required: with an empty list effects showed partial lights, no animation, or went dark after a few seconds. The app sends a 7-colour rainbow list (effect 1 then animated; 13 animated; 20 is a static multicolour pattern). The remote shows the same numbers with the firmware's own colours, which no tested BLE command selects. Ignored by this controller: `42 …` (symp_scene_v2), `61 …` (symp_scene), `E0 02 …` (scene_data_v3), and the IOTBT `E1 01 …` scene command captured by lednetwf_ble |
| Remote effect cycle | Mode button cycles 1-11, 13-22, 25-37, then 1 (two full captures at 1 s polling). 12, 23, 24, 38+ are echoed in the state but the remote skips them and they did not animate; not offered |
| Effect speed | **Verified**: E1 21 speed byte 1-100, 1 slowest, 100 fastest (side-by-side test, effect 1). The slowest setting is still fairly quick on this firmware. The remote always resets speed to 100 |
| State push | The controller pushes a state notification (opcode 12) on every remote press and power change while Homey is connected; no polling needed |

## Surplife scenes (2026-11-04)

The effect library now uses the Surplife app's own 97 scenes for product 0x86 (cloud preset file
`PresetScene1314TabsRGBWV2`, see RESEARCH.md). Played from the effect studio on the Quntis and
compared with the same scenes in the Surplife app: Christmas 1-3, Halloween 1-2, Mother's Day,
Children's Day, Beer Festival, Midsummer, Game, Movie Night (speed 80/10/1), Champagne Party.
Result: **they match** (user, 2026-11-04). Not yet compared: the Warm category (approximated
warm white) and scenes that use density, direction or a background colour.

## White channels (2026-11-04)

E1 21 pattern 20 with one palette colour `h s v X Y`, observed on the Quntis:
`00 00 64 00 00` white (RGB), `00 00 00 00 64` **warm white**, `00 00 00 64 00` dimmer cool white,
`00 00 00 64 64` bright white, `00 00 00 32 64` white. So palette byte 4 = cool-white channel and
byte 5 = warm-white channel (0-100). The Warm scenes' "T" colour is sent as `00 00 00 00 64`.
Warm scenes (all 9) played from the effect studio with real warm white: **match the Surplife app**
(user, 2026-11-04).

## Colour temperature (2026-11-04)

`temp_value_v2` = `3B B1 00 00 00 <cct> <bright> 00 00 1E 00 00` + checksum (opcode 0x0B), from the
app's wifi_dp_cmd.json template. On the Quntis, one step at a time: cct 0 = **warm white**,
cct 100 = **cool white**; brightness 20 was echoed in the state reply (white level byte). The
temperature itself is not reported in state. Exposed in Homey as `light_temperature` + `light_mode`.
With the app's delay field `00 00 1E` the change landed seconds late (user: "only changes the second
time"); Homey sends it with delay 0.
Slider in the Homey app (light_temperature): warm to cool follows each move immediately
(user, 2026-11-04, after passing the listener's new value instead of the stored one).

## Effect studio theme (2026-11-04)

Homey passes no theme class or colour variables to app settings pages. Its theme reaches the page
through `prefers-color-scheme`, inverted (Homey light -> "dark"). The studio's Auto mode uses the
inverted value and follows Homey correctly in both themes (user, Homey app). Light/Dark buttons
override it; the choice is stored in the app setting `studioTheme`.
