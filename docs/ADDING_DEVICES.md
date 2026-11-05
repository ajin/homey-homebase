# Architecture and adding devices

Homebase supports several kinds of devices. Each kind ("device family") keeps its code, tests,
tools and documentation in its own folders; only a few parts are shared.

## Folder structure

```
app.ts, api.ts                 the app and its API (shared; the API routes call into a family)
settings/index.html            app settings: Devices screen + one page ("panel") per kind of device
drivers/<driver-id>/           one Homey driver per kind of device: pairing, capabilities, flows, settings
lib/core/                      shared helpers for every family (e.g. the background command queue)
lib/<family>/                  everything specific to one device family
test/core/, test/<family>/     unit tests, split the same way
tools/<family>/                scripts for one family (e.g. regenerating its data)
docs/devices/<family>.md       user page: supported models, features and limitations
docs/<family>/                 technical notes: research, protocol, hardware test results
```

Current families:

| Family | Driver | Library | User page | Technical notes |
|--------|--------|---------|-----------|-----------------|
| Zengge Bluetooth lights | `drivers/zengge-ble-light` | `lib/zengge/` | [devices/zengge-bluetooth-light.md](devices/zengge-bluetooth-light.md) | [zengge/](zengge/) |
| Hamulight 433 MHz lights | `drivers/hamulight-433-light` | `lib/hamulight/` | [devices/hamulight.md](devices/hamulight.md) | [hamulight/](hamulight/) |

## Adding a new kind of device

1. **Library:** create `lib/<family>/` with the transport (Bluetooth, LAN, ...) and the protocol.
   Keep protocol code free of Homey imports so it can be unit tested; reuse `lib/core/` where it
   fits (for example `CommandQueue`, so capability changes answer Homey at once).
2. **Driver:** create `drivers/<driver-id>/` with pairing and the device class. Request only the
   permissions it needs in `.homeycompose/app.json`.
3. **Tests:** add `test/<family>/*.test.ts` (`npm test` runs every `*.test.ts` under `test/`).
4. **Docs:** add `docs/devices/<family>.md` (models, features and limitations) and add a row to the
   *Supported devices* table in the README.

### Its page in the app settings

The app settings open on a **Devices** screen that lists every paired device of every driver.
Tapping a device opens the page for its kind (its *panel*). Devices of the same kind share a page;
a different kind gets its own page, unless it offers the same features.

A device class takes part with two optional methods:

* `settingsPanel(): string | null` - the panel id, e.g. `'effects'`. `null` (or no method) lists
  the device without anything to open.
* `panelSummary(): { status, live }` - the status line on its card (`live` highlights it).

Card icons follow the device class (`light`, `socket`, `sensor`, anything else gets a generic icon).

To add a page for a new kind of device:

1. Return its panel id from `settingsPanel()`.
2. In `settings/index.html`, add a hidden page section and an entry in `PANELS` whose `open(id)`
   loads and shows it.
3. Add the app API routes the page needs (in `.homeycompose/app.json` and `api.ts`), scoped to
   one device id, like the effect studio's `/effects?device=<id>`.

Existing panels:

| Panel | Used by | Page |
|-------|---------|------|
| `effects` | Zengge Bluetooth lights whose model supports effects | Effect studio: the model's scenes, its patterns and that light's own effects (`effectLibrary()`, `effectScope()`, `runEntry()`, `playEntry()`, `showStaticColour()`, `currentEffectId()`, `currentEffectSpeed()`, `modelName()`; see `EffectDevice` in `api.ts`) |

## Zengge Bluetooth lights

```
lib/zengge/discovery.ts             Bluetooth scan, shared by pairing and diagnostics
lib/zengge/ble/ZenggeConnection.ts  Homey BLE link: connect, queue, rate limit, notifications
lib/zengge/protocol/transport.ts    ZGHB framing (from the app's Java code), product independent
lib/zengge/protocol/advertisement.ts  identifies controllers from advertisements
lib/zengge/protocol/commands.ts     command sets ("profiles"): power, brightness, colour, effects, queries
lib/zengge/protocol/state.ts        decodes state replies and notifications
lib/zengge/protocol/profiles.ts     picks a command set from product id and firmware
lib/zengge/protocol/productCatalog.ts  generated from the Surplife app (tools/zengge/extract_catalog.py)
lib/zengge/effects/                 scenes, patterns, "My effects" storage and model names
```

### Another Zengge Bluetooth product with the same command set

1. Scan it (`/diagnostics/scan`) and note `productId`.
2. If `chooseProfile` already picks a working command set, it works with the existing driver.
   Add its name to `lib/zengge/effects/models.ts` and a row to
   [devices/zengge-bluetooth-light.md](devices/zengge-bluetooth-light.md).

### A Zengge product needing different bytes

1. Capture the official app traffic (see [zengge/HARDWARE_TESTING.md](zengge/HARDWARE_TESTING.md) §4).
2. Add a `CommandProfile` in `lib/zengge/protocol/commands.ts` with the exact bytes and a provenance.
3. Add its id to `ProfileId`, `PROFILES`, the `command_profile` dropdown in
   `driver.settings.compose.json`, and teach `chooseProfile` when to use it.
4. Add unit tests with the captured bytes in `test/zengge/`.

### Zengge Wi-Fi controllers

The transport layer is Bluetooth-specific. A Wi-Fi Zengge controller (Magic Home-style, TCP port
5577) uses the same inner commands with a different envelope. Implement a `WifiConnection` with
the same `send(LightCommand)` / `request()` / `message` / `disconnect` surface as
`ZenggeConnection`; the device code and command profiles can then be reused.

### Updating the Zengge catalogue after a Surplife app update

```bash
python3 -I tools/zengge/extract_catalog.py /path/to/decompiled/Surplife_sourcecode
npm test
```

## Hamulight 433 MHz lights

```
.homeycompose/signals/433/hamulight.json     receive definition (timings of one frame)
.homeycompose/signals/433/hamulight_tx.json  send definition (lead pulse, frames back to back)
lib/hamulight/protocol.ts           frames, checksum, ring positions, presets, send plan (no Homey imports)
lib/hamulight/learning.ts           learns the remote id (and ring codes for unknown remote types)
lib/hamulight/radio.ts              shared 433 MHz signals: ref-counted receive, serialised sending
drivers/hamulight-433-light/pair/   pairing page (repair/ holds the same page for Repair)
tools/hamulight/make_images.py      driver images
```
