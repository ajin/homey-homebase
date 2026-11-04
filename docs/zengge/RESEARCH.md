# Protocol research: Surplife / Zengge BLE controllers

This records what is known, where each fact comes from, and how confident we are. Results of
testing on the real Quntis NS-I-204-M-E (product 0x86) are in
[HARDWARE_TESTING.md](HARDWARE_TESTING.md#5-results); they confirm the transport, power, brightness,
colour, `E1 21` effects and state notifications described here.

## Sources

| Id | Source | What it is |
|----|--------|-----------|
| APK | Decompiled Surplife Android app (`Surplife_sourcecode`, jadx output) | Primary source. Java BLE stack `com.zengge.hagallbjarkan`, plus Flutter assets |
| ASSETS | `flutter_assets/packages/magichome2_home_data_provide/assets/*.json`, `zg_app_builtin_assest/assets/js_bundle/60_surplife.js` | Command templates and product catalogue shipped inside the app |
| LEDNETWF | [8none1/lednetwf_ble](https://github.com/8none1/lednetwf_ble) (MIT) | Home Assistant integration, tested on several Zengge BLE controllers |
| MH2 | [rabidpaperclip/magichome2-ble](https://github.com/rabidpaperclip/magichome2-ble) (MIT) | HCI captures of the Surplife app driving YIQU string lights |

The light-level command bytes are built in the app's compiled Dart code (`libapp.so`), which was
not decompiled. The Java layer only receives `{opcode, hex}` from Dart
(`BleDeviceManagerServer.handleCommand`). This is why some commands rely on ASSETS templates or
third-party captures instead of code.

## Device identification

* MAC OUI `08:65:F0` is registered to JM Zengge Co., Ltd. (from the hardware label).
* The app accepts a device when its advertisement contains a local name (AD type 0x09) and
  either manufacturer data (0xFF, 29 bytes) or service data (0x16, 16/29 bytes) plus manufacturer
  data, with byte[1] in `0x5A..0x5E`. **Source: APK `ZGHBDevice.newDevice`.**
* Fields: sta, manufacturer, bleVersion, MAC, productId (big endian), firmware, LED version,
  checkKey flag, firmware flags, state bytes. Layout is in `lib/zengge/protocol/advertisement.ts`.
* `sta == 0xFF` means OTA mode (APK `checkDeviceIsOtaState`).
* No scan filter is used by the app (`startScan(null, ...)`), so the controller may not advertise
  the 0xFFFF service UUID. Pairing therefore scans without a filter.

## GATT and transport (high confidence, from code)

**Source: APK `handler/zghb/Service.java`, `ZGHBWriteUtils`, `LowerTransportLayerEncoder/Decoder`.**

| Item | Value |
|------|-------|
| Service | `0000ffff-0000-1000-8000-00805f9b34fb` |
| Write | `0000ff01-…` |
| Notify | `0000ff02-…` (app enables notifications on it) |
| OTA service / write / notify | `fe00` / `ff11` / `ff22` (not used by this app) |
| MTU | app requests 512; packet size = min(MTU, 255) for bleVersion < 8, min(MTU, 512) for >= 8 |
| Frame version | 0 for bleVersion < 8, 1 for >= 8 |
| Sequence | per device, starts at 1, 8-bit |

Header and segmentation are documented in `lib/zengge/protocol/transport.ts`. Our encoder is checked
byte-for-byte against a literal port of the Java encoder (`tools/zengge/crosscheck_encoder.py`,
`test/zengge/fixtures/java_encoder_cases.json`).

**Authentication / pairing / encryption:** none found in the BLE write path. The app writes frames
directly after connecting; there is no bonding call, key exchange or encryption in
`hagallbjarkan`. `checkKeyFlag` exists in the advertisement but is not used in the write path
we inspected. Treat as "no pairing required" until proven otherwise on hardware.

**Notifications:** opcode 12 = JSON `{"code":0,"payload":"<hex>"}` carrying state; opcode 22 =
raw state bytes; others are forwarded to Dart as responses. Upper-transport type 2 = ACK
(ignored). **Source: APK `BleDeviceManagerServer.onArrival`, `ZGHBReceiveCallback`.**

## Command templates (inner payloads)

| Function | Template | Opcode | Checksum | Source |
|---|---|---|---|---|
| bright_value_v2 | `3b010000{v}00{v}{delay×3}{gradient×2}` | 11 | yes | ASSETS ble_dp_cmd.json (BLE-specific, opcode explicit) |
| switch_led_v2 | `3b{open}0000000000{gradient×3}{delay×2}` | 11* | yes | ASSETS wifi_dp_cmd.json |
| switch_led | `71{open}0f` | 11* | yes | ASSETS wifi_dp_cmd.json |
| scene_data_v2 | `38{model}{speed}{bright}` | 11* | yes | ASSETS wifi_dp_cmd.json |
| state_upload | `818a8b96` | 10* | (included) | ASSETS wifi_dp_cmd.json |
| state_upload_v2 | `ea818a8b` | 10* | no | ASSETS wifi_dp_cmd.json |
| switch_led_v3 | `e001{preview}3b{open}…` | ? | no | ASSETS (see note) |
| scene_data_v3 | `e002{preview}{model}{speed}{bright}` | 10* | no | ASSETS wifi_dp_cmd.json |
| colour (0x3B A1) | `3b a1 <hue<<7 \| sat> <v> 00 00 <delay×3> 00 00` + cs | 11 | yes | LEDNETWF (hardware-tested on other products) |
| colour v3 | `e0 01 00 a1 <hs> <v> 00 00 00 00 14 00 00` | 10 | no | LEDNETWF capture |
| colour (rgb_mini) | `31{r}{g}{b}00000f` | 11* | yes | ASSETS per-product hexCmdForms |

`open`: `0x23` = on, `0x24` = off. `*` = opcode inferred: the app's own BLE file only states 11 for
bright_value_v2; LEDNETWF uses 0x0B for commands and 0x0A for queries / `0xE0` commands.

Note on v3: two independent captures (LEDNETWF, MH2) of real app traffic show `E0 01 00 <mode>`
without the literal `3b` that appears in the template, so the template is evidently transformed
by Dart code before sending. Our `symphony_v3` profile follows the captures.

MH2 also captured `E1 21 …` "scene" commands and `EC 03/04/07` music commands for YIQU string
lights (protocol family `symphonyE1` in the app catalogue). `E1 21` is implemented
(`lib/zengge/protocol/effects.ts`) and verified on the Quntis; the `EC` music commands are not.

## Product catalogue

`lib/zengge/protocol/productCatalog.ts` (114 product ids) lists which protocol families the app uses per
product and from which firmware version. String / Christmas products appear with category codes
`sdd` (0x10, 0x1A: legacy `christmas_wifi`), and `hc3` (0x47, 0x49 ChristmasCC; 0xAA, 0xB6 … symphony
E1) — most `hc3` products also list `common2_0`, so the 0x3B set is the default for them.

The Quntis reports product id **0x86**, found in the app's `wifiDevices` table (hc3, common2_0 + symphonyE1). The catalogue now includes that table (293 products).

## Homey platform

* Homey Apps SDK v3 BLE: `homey.ble.discover()/find()`, `advertisement.connect()`,
  `peripheral.discoverAllServicesAndCharacteristics()`, `characteristic.write()`,
  `characteristic.subscribeToNotifications()` (Homey >= 6), `peripheral.on('disconnect')`,
  `homey.ble.subscribeToAdvertisements()` where `hasFeature('ble-advertisements')`.
* Not available: MTU control, write-without-response selection, raw handles. Packet size is
  therefore a device setting (255 default, 20 fallback using protocol segmentation).
* BLE requires Homey Pro (local platform). Homey Cloud cannot run this app.
* Many controllers allow only one BLE central at a time: while Homey holds the link the Surplife
  phone app cannot connect. Hence the idle-disconnect setting (default 120 s).

## Effect data from the Surplife cloud (2026-11-04)

The Surplife app does not ship its scene list. Scene names, categories, pictures and commands come
from the Surplife cloud (`/app/scene/light/mode`, `/app/scene/light/list`) and are cached on the
phone. The app logs in silently with a guest account (`/app/guest/register`, `/app/guest/login`);
requests carry a `token` header and an MD5 `sign` query parameter.

A custom ("DIY") effect captured by the user from `/app/mode/diy/list` confirms the built-in effect
command layout already used by `builtinEffect()`:

```
E1 21 00 64 20 00 01 64 50 00 00 00 00 00 00 06  00 64 64 00 00  96 64 64 00 00 ...
      |  |  |        |  speed 80          |   colours {h/2, s, v, 00, 00}
      |  |  pattern 32 (symphonyControl.type)
      |  brightness 100                   count 6
```

- Palette hue byte = HSV hue / 2 (300 deg -> 0x96), s and v in percent. The app sends **no**
  colour correction; our green-shift correction is applied on top (see colourCorrection.ts).
- `symphonyControl.type` is the controller pattern number; `colorMinLength: 3`.
- Metadata per mode: `enableSpeed`, `enableBrightness`, `enableDirection`, `enableDensity`, `duration`.

### Device record from the Surplife cloud (2026-11-04, guest account, no secrets recorded)

- `productId` 134 (0x86), `version` 7, `entityType` BLE, BLE module `AK001-ZJ21511`,
  firmware `5B_0086_2C_14` / display `BT.5B.0086.2C.14,V7`.
- `attributes."0014"` = `e0 23 00 86 07 00` (product 0x0086, version 7; meaning of e0 23 unknown).
- Functions the app enables for it: POWER, RGB, **COLOR_WW_MIX**, CUSTOM_P6 / DIY_SINGLE_P6 /
  DIY_MULTI_P6 (each with `rgb: true, ww: true`), SET/ADJUST_BRIGHTNESS, SET/ADJUST_SPEED,
  **SET_COLOR_TEMPERATURE**. So the controller has a warm-white channel next to RGB; that is the
  "T" (CCT) colour in the scene list and explains the "RGBW" preset key. Its BLE encoding is
  still unverified (likely the two trailing bytes of each 5-byte palette colour).
- Guest login response lists the regional hosts: API `https://app-eu.surplife.net`, OTA
  `http://otaeu.surplife.net/ota/download`, MQTT `mqtteu.magichue.net` (cloud relay, not used by
  this BLE-only controller or by this app).

### Remote control settings (2026-11-04)

The Surplife app's "Remote Control Settings" (Bluetooth / radio remotes and control panels only)
use the commands flux_led documents for Zengge Wi-Fi controllers (`lightinglibs/flux_led`,
`protocol.py`): set `2A <mode> FF FF FF FF FF 00 00 00 00 00 00 00 0F` + checksum (mode 01 none,
02 all, 03 paired only), query `2B 2C 2D` + checksum, unpair `2A FF FF 01 FF FF FF 00 … F0` +
checksum. Verified over Bluetooth on the Quntis: the query (opcode 0x0A) returned
`2B 02 00 00 91 78 FF 1F 79 44 00 00 2C 3D` (open, 0 paired remotes; bytes 4-9 unknown), matching the
app. Code: `lib/zengge/protocol/remotes.ts`.
