# Homebase for Homey Pro

Unofficial Homey Pro app (`com.rxd7.homebase`) that controls your devices **locally**: Homey talks
to each device directly, without vendor accounts, clouds or an internet connection.

Homebase brings together several kinds of devices. Each kind has its own driver in Homey and its
own page with the supported models, features and limitations. More kinds of devices will be added
over time.

## Supported devices

| Device family | Connection | Add in Homey | Status | Models, features and limitations |
|---------------|------------|--------------|--------|----------------------------------|
| **Zengge Bluetooth lights** (set up with the Surplife app; sold under shop brands such as Quntis) | Bluetooth | Devices → + → Homebase → **Surplife Bluetooth Light** | ✅ Tested on one model; others untested | [Zengge Bluetooth lights](docs/devices/zengge-bluetooth-light.md) |

✅ tested on real hardware · 🟡 implemented, untested · ❌ not supported

Want a device added? Open an issue with the device's brand, model, how it is controlled today (app,
Bluetooth, Wi-Fi) and, if possible, its technical ids.

## Install

The app is not in the Homey App Store. Install it from a computer (Mac, Windows or Linux) on the
same network as your Homey:

1. **Install [Node.js](https://nodejs.org)** (the LTS version).
2. **Install the [Homey CLI](https://apps.developer.homey.app/the-basics/getting-started/homey-cli)**
   and keep it up to date:

   ```bash
   npm install --global homey
   ```

3. **Sign in and choose your Homey:**

   ```bash
   homey login
   homey select
   ```

4. **Get the app.** Clone this repository, or download it as a ZIP and unpack it:

   ```bash
   git clone https://github.com/ajin/homey-homebase.git
   cd homey-homebase
   ```

5. **Download what the app needs** (run this in the app folder):

   ```bash
   npm ci
   ```

6. **Check it** (optional, recommended): runs the tests and Homey's own checks.

   ```bash
   npm run release-check
   ```

7. **Install it on your Homey:**

   ```bash
   homey app install
   ```

### Add your devices

In the Homey app: **Devices → + → Homebase**, then choose the kind of device. Each device page
(see [Supported devices](#supported-devices)) lists what to do first, for example closing the
vendor's phone app.

### App settings

**Apps → Homebase → Settings** opens the **Devices** screen: every device added with Homebase,
with its status. Tap a device to open its page, for example the effect studio of a light. Devices
without extra options are listed but have nothing to open. Light and dark follow Homey.

### Update

In the app folder, get the new version (`git pull`, or download it again), then run steps 5 to 7
again. Your devices, Flows and settings stay.

### Remove

Uninstall **Homebase** in the Homey app (**Apps → Homebase → Uninstall**). This removes all its
devices and their saved settings.

### Support and testing

This app is tested by its author on the devices marked ✅ and one Homey Pro. It has not been
through any other quality checks. Use it at your own risk, and please report problems with the
device's model and technical ids (shown in its device settings).

## Requirements

* Homey Pro with Homey firmware 12 or later. Homey Cloud is not supported (no Bluetooth, no local
  network access for apps).
* Some device families need Bluetooth on the Homey; see their pages.
* For installing: a computer with Node.js 18 or later.

## Privacy and security

* Everything stays on your local network: no accounts, no cloud services, no data leaves Homey.
* The app asks Homey only for the permissions its devices need (currently Bluetooth).
* The app's API is only reachable with your Homey sign-in.

## Development

```bash
npm ci
npm test
homey app run      # runs the app on your Homey and shows its logs; stops when you press Ctrl+C
```

```
drivers/<driver-id>/       one Homey driver per kind of device
lib/core/                  shared code for every device family
lib/<family>/              everything specific to one family (e.g. lib/zengge/)
test/core/, test/<family>/ unit tests, split the same way
tools/<family>/            scripts for one family; tools/art/ for the app images
docs/devices/<family>.md   user page per family: models, features, limitations
docs/<family>/             technical notes per family: research, hardware test results
settings/index.html        app settings: Devices screen and one page per kind of device
```

* [docs/ADDING_DEVICES.md](docs/ADDING_DEVICES.md): architecture and how to add a new kind of device.
* `env.json` (not in git) holds development switches such as `{"DEBUG":"1"}`. It is bundled with
  the app, so `npm run release-check` refuses to continue while it holds anything.

## Credits

Credits for each device family are on its page.
