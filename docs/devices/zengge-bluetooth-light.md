# Zengge Bluetooth lights (Surplife app)

Bluetooth LED lights with a **Zengge** controller (JM Zengge Co., Ltd.): the kind you set up with
the **Surplife** phone app, Zengge's own app. Homebase controls them directly over Bluetooth, with
no Surplife account and no internet connection.

In Homey: **Devices → + → Homebase → Surplife Bluetooth Light**.

Not affiliated with Zengge, Surplife or Quntis.

## Is my light one of these?

These lights are sold under shop brands, such as **Quntis**, but the electronics inside come from
Zengge. The brand on the box matters less than these signs:

* **The phone app:** the light is set up with **Surplife**.
* **The MAC address** starts with `08:65:F0` (registered to JM Zengge Co., Ltd.).
* **The Bluetooth name** may start with `IOTBT` (the tested light shows as `IOTBT123`; other models
  can use other names).

The MAC address and the Surplife app are the surest signs.

## Supported models

Zengge publishes no model names for its controllers, so the product names below describe the
controller; **Also sold as** lists the shop names we know of.

| Product | Also sold as | Technical ids | Status |
|---------|--------------|---------------|--------|
| **Zengge Bluetooth Symphony controller, RGB + warm white + cool white (RGBWW)**: addressable ("Symphony") light-string controller | **Quntis** Smart Christmas Lights, 5 m / 204 LED (model NS-I-204-M-E). The Surplife app also lists this product for 26 partner apps, such as permanent holiday-lighting brands (for example `UtahLED`, `Permanent`, `Firefly`); which lights they sell is not confirmed. | Product id **0x86** (134) · Zengge category `hc3` (Symphony) · Bluetooth name `IOTBT…` · module `AK001-ZJ21511` · firmware `5B_0086_2C_14` (BLE v7) · MAC `08:65:F0:…` | ✅ **Tested**: every feature below was checked |
| **Zengge Bluetooth Symphony controllers with the same scenes** | Not known yet | Product id **0x22A, 0x22D, 0x253, 0x287** · same Surplife scene set as 0x86 (`PresetScene1314TabsRGBWV2`) | 🟡 Should work, untested |
| **Other Zengge Bluetooth light controllers** (set up with the Surplife app) | Many shop brands of string, curtain and strip lights | MAC `08:65:F0:…` · Bluetooth name often `IOTBT…` or `LEDnetWF…` · any product id | 🟡 May work, untested: they pair and the app picks the command set from the product id; if the light does not react, change **Command set** in the device settings. Features differ per model. |
| Zengge **Wi-Fi** controllers (Magic Home and similar) | | | ❌ Not supported: this driver uses Bluetooth only |
| The handheld remote (IR/RF) | | | ❌ Not supported: Homey talks to the light's controller, not to the remote. The remote keeps working, and its changes show up in Homey. |

Sources: product id, category, module and firmware come from the tested light itself and from the
Surplife app's own product data; MAC prefix `08:65:F0` is registered to JM Zengge Co., Ltd.
Know another brand that uses one of these controllers? Please report it with the product id.

**Finding your product id:** pairing lists each light found, and the device settings show
**Product id** after pairing.

## Features and limitations

Tested on product 0x86 (sold as Quntis).

| Feature | Status | Limitations |
|---------|--------|-------------|
| On / off | ✅ | |
| Brightness | ✅ | The slider follows how the eye sees brightness (50 % looks half as bright); switch to **Linear** in the device settings if you prefer. The lowest slider position is the light's dimmest visible level. |
| Colour | ✅ | Colour correction (on by default) makes orange and yellow look right on this string. Cyan and purple come out pale: a limit of these LEDs. |
| White, warm to cool | ✅ | Uses the light's own warm and cool white LEDs. The light does not report the temperature back, so changes made with the remote or phone app are not shown in Homey. |
| Scenes (97, as in the Surplife app) | ✅ | Festival, Scenery, Atmosphere, Commercial, Romance, Life and Warm. A few scenes use settings that are not decoded yet (density, direction, background colour), so they can look slightly different from the Surplife app, for example Meteor Shower, Astral Summit and Dynamic Rhythm. |
| Built-in patterns (34) | ✅ | Run with rainbow colours; the remote's own colours for each pattern cannot be chosen over Bluetooth. |
| My effects | ✅ | Up to 30 of your own effects per light: pick a pattern, up to 8 colours and a speed. |
| Effect speed | ✅ | 1–100 %, follows the remote. |
| Follows the remote and phone app | ✅ | Power, colour, brightness and effect. |
| Flows | ✅ | See [Flow cards](#flow-cards). |
| Music mode | ❌ | Not implemented: the commands are only partly understood. |
| Remote controls | ✅ | Choose which Bluetooth (radio) remotes can control the light: all, only paired ones, or none; see the paired count; unpair them all. Same as the Surplife app's Remote Control Settings. Infrared remotes and phones are not affected. |
| Permanent connection with automatic reconnect | 🟡 | Implemented, not yet tested on hardware. The default (connect when needed, release after 2 minutes) is tested. |

### Good to know

* **One Bluetooth connection at a time.** While Homey is connected, the Surplife phone app cannot
  connect, and the other way round. Homey releases the light after 2 minutes without commands
  (setting **Disconnect after idle**), so the phone app can connect again.
* **The first command after a pause takes a few seconds**, because Homey has to reconnect. The
  controls answer at once; the light follows when the connection is back.
* **Range.** Bluetooth reaches roughly one room. If the light is often "not reachable", move the
  Homey or the light controller closer.
* **Who can control the light.** These lights have no password: any phone with the Surplife app in
  Bluetooth range can connect while the light is free. Device settings → **Remote controls** limits
  which radio remotes work; keeping Homey connected (**Disconnect after idle** = 0) is the only way
  to keep other phones out.
* **Removing the light from Homey** resets its remote settings to the factory state (paired remotes
  removed, all remotes allowed), when the light is in range at that moment.
* **Colour while off.** Changing the colour or white of a light that is off does not turn it on;
  the new colour is used when you turn it on. Dimming above 0 does turn it on.

## Add your light

1. Close the Surplife app on your phone (force-quit it), so it releases the light.
2. In the Homey app: **Devices → + → Homebase → Surplife Bluetooth Light**.
3. Choose your light from the list and add it.

## Effect studio

In **Apps → Homebase → Settings**, choose your light: its page shows the scenes of its model, the
controller's patterns and your own effects. Tap one to play it on that light, adjust the speed, or
create and edit your own effects (they belong to that light only). Light and dark follow Homey.

## Flow cards

* **When:** effect changed (also with the remote), Bluetooth link lost, link restored, controller
  message received.
* **And:** Bluetooth link is open.
* **Then:** run effect (scenes, patterns and your own effects, with speed), run pattern by number,
  ask the light for its state, unpair all remotes, send a raw command (for diagnostics).

## Device settings

Command set (automatic or manual), maximum BLE packet size, disconnect after idle, minimum gap
between writes, colour correction, brightness curve, restore last state after an unexpected
reconnect, remote controls (which remotes work, paired count), diagnostic logging, and read-only controller information (MAC address, product id,
versions, active command set, last state).

## Troubleshooting

| Problem | What to do |
|---------|------------|
| The light is not found when adding it | Force-quit the Surplife phone app, switch the light off and on at the plug, and keep it within a few metres of the Homey. |
| "Not reachable" or no reaction | Check the light has power and is in range, and that the phone app is closed. Try again after 15 seconds. |
| The light does not react to colours or effects | Device settings: try another **Command set**, then **Maximum BLE packet size** 20 bytes. |
| Effects look different from the Surplife app | Some scene settings are not decoded yet (see the features table). |

For details, turn on **Diagnostic logging** in the device settings and run the app with
`homey app run` from the app folder: every Bluetooth message is shown (no passwords or personal
data exist in this protocol). `GET /api/app/com.rxd7.homebase/diagnostics/scan` returns a
Bluetooth scan of compatible controllers as JSON (needs your Homey sign-in).

## Technical notes

* [../zengge/RESEARCH.md](../zengge/RESEARCH.md): protocol findings and where each comes from
* [../zengge/HARDWARE_TESTING.md](../zengge/HARDWARE_TESTING.md): how the tested light was checked, and the results
* Code: `lib/zengge/`, driver `drivers/zengge-ble-light/`, tests `test/zengge/`

## Credits

Protocol knowledge builds on [lednetwf_ble](https://github.com/8none1/lednetwf_ble) (MIT) and
[magichome2-ble](https://github.com/rabidpaperclip/magichome2-ble) (MIT), and on analysis of the
Surplife Android app for interoperability.
