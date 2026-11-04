/**
 * Run before `homey app install` / `homey app publish`: env.json is bundled with the app, so any
 * development switch left in it (DEBUG, TEST_SEQUENCE, POLL_STATE_MS, KEEP_CONNECTED) would be
 * active in the installed app. Passes only when env.json is absent or empty ({}).
 */
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'env.json');
if (!fs.existsSync(file)) {
  console.log('release-check: no env.json, OK');
  process.exit(0);
}
const keys = Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')));
if (keys.length) {
  console.error(`release-check: env.json still has development switches: ${keys.join(', ')}`);
  console.error('Empty it ({}) or remove it before installing or publishing.');
  process.exit(1);
}
console.log('release-check: env.json is empty, OK');
