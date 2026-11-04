/**
 * The Surplife app's built-in scenes for this controller.
 *
 * Source: the Surplife cloud preset file for product 0x86 ("PresetScene1314TabsRGBWV2",
 * version 3, served from resource.surplife.net/cloud/app/resource/...), captured by the user from
 * the Surplife iOS app on 2026-11-04. The app does not ship this list; it downloads it per product.
 *
 * Per scene: `type` is the controller pattern number (E1 21 byte 4), `other` is `otherMode`
 * (E1 21 byte 5, confirmed by magichome2-ble's capture of "Northern lights": pattern 13, mode 2),
 * colours are the app's HSV values (hue degrees, saturation and value 0-100).
 * Special colours: W = white (s 0, v 100), K = off (v 0), T = the app's warm-white (CCT) colour,
 * sent on the controller's warm-white channel (palette byte 5; verified on the Quntis 2026-11-04).
 *
 * Not reproduced (encoding unknown): density, direction and background colour. The app's
 * names are translation keys; the English names below are derived from those keys.
 */

import type { PaletteColour } from '../protocol/effects';

export type SceneColour = [h: number, s: number, v: number] | 'W' | 'K' | 'T';

export interface SurplifeScene {
  key: string;
  name: string;
  category: SceneCategory;
  type: number;
  speed: number;
  other?: number;
  colours: SceneColour[];
}

export type SceneCategory = 'festival' | 'view' | 'atmosphere' | 'commerce' | 'romance' | 'life' | 'warm';

export const SCENE_CATEGORY_TITLES: Record<SceneCategory, string> = {
  festival: 'Festival',
  view: 'Scenery',
  atmosphere: 'Atmosphere',
  commerce: 'Commercial',
  romance: 'Romance',
  life: 'Life',
  warm: 'Warm',
};

const c = (h: number, s = 100, v = 100): SceneColour => [h, s, v];
const RAINBOW6 = [c(0), c(300), c(240), c(180), c(120), c(60)];
const RAINBOW7W: SceneColour[] = [c(0), c(120), c(240), c(60), c(300), c(180), 'W'];
const AMBER = c(17.65);

type Row = [key: string, name: string, type: number, speed: number, colours: SceneColour[], other?: number];

const ROWS: Record<SceneCategory, Row[]> = {
  festival: [
    ['bcp_christmas3a(1)', 'Christmas 1', 2, 80, [c(0), c(120), 'W']],
    ['bcp_christmas3a(2)', 'Christmas 2', 29, 80, [c(10.62), c(120), c(60), 'W']],
    ['bcp_christmas3a(3)', 'Christmas 3', 20, 80, ['W', c(0), c(120), c(60)]],
    ['bcp_halloween3a(1)', 'Halloween 1', 19, 80, [c(2.83), c(271.29)]],
    ['bcp_halloween3a(2)', 'Halloween 2', 22, 80, [c(300), c(180), c(28.94)]],
    ['bcp_halloween3a(3)', 'Halloween 3', 29, 80, [c(5.88), c(271.29), c(120, 100, 56), c(120)]],
    ['bcp_valentine_day', "Valentine's Day", 33, 78, [c(353.88), c(353.79), c(349.81, 76), c(349.81, 76), c(353.88), c(353.88)]],
    ['bcp_thanksgiving', 'Thanksgiving', 26, 80, [c(9.41), c(32.43, 73)]],
    ['bcp_mother', "Mother's Day", 28, 80, [c(16.47), c(28.94)]],
    ['bcp_father', "Father's Day", 28, 80, [c(240), c(210, 90), c(180, 80)]],
    ['bcp_forest_day', 'Forest Day', 17, 80, [c(120), c(60), c(28.94), c(180)]],
    ['bcp_new_year', 'New Year', 32, 80, [c(0), c(29.88), c(11.75)]],
    ['bcp_children', "Children's Day", 22, 80, RAINBOW6],
    ['bcp_easter', 'Easter', 4, 80, [c(0), c(14.12), 'W']],
    ['bcp_birthday', 'Birthday', 1, 80, RAINBOW6],
    ['bcp_st_day', "St. Patrick's Day", 33, 80, [c(120), c(112.03, 50), 'W', c(120), c(112.06, 80), c(112.16, 60)]],
    ['bcp_pumpkin_festival', 'Pumpkin Festival', 17, 80, [c(21.73, 95), 'K', c(21.73, 95), 'K', c(21.73, 95), 'K', c(21.73, 95), 'K']],
    ['bcp_puppet_festival', 'Puppet Festival', 25, 80, [c(0), c(240), 'W', c(0), c(60)]],
    ['bcp_easter_eggs', 'Easter Eggs', 20, 80, [c(120), c(270.12), c(60), c(23.29)]],
    ['bcp_candy_cane', 'Candy Cane', 10, 80, [c(0), c(60), c(0), c(60), c(0), c(60), c(0), c(60)]],
    ['bcp_carnival_two', 'Carnival', 11, 80, [c(0), 'W', 'K', c(240)]],
    ['bcp_lemon_festival', 'Lemon Festival', 2, 80, [c(60), c(29.88)]],
    ['bcp_beer_festival', 'Beer Festival', 32, 80, [c(240), 'W', c(240)]],
    ['bcp_midsummer_festival', 'Midsummer', 13, 80, [c(0), c(47.76), c(270.13, 100, 89), c(330.13, 100, 89)]],
  ],
  view: [
    ['bcp_late_autumn', 'Late Autumn', 15, 80, [c(29.88), c(10.59)]],
    ['bcp_sea_wave', 'Sea Wave', 14, 80, [c(240), c(150.12), c(30, 90), c(150.12), c(240)]],
    ['bcp_iceland_blue', 'Iceland Blue', 15, 80, [c(240), c(209.88), c(180)]],
    ['bcp_glacier_express', 'Glacier Express', 15, 80, [c(240), c(40)]],
    ['bcp_firefly_night', 'Firefly Night', 2, 80, [c(18.59)]],
    ['bcp_green_meadow', 'Green Meadow', 29, 80, [c(120), c(60)]],
    ['bcp_northern_lights', 'Northern Lights', 13, 99, [c(29.88)], 2],
    ['bcp_dream_meteor', 'Dream Meteor', 13, 80, RAINBOW6],
    ['bcp_early_spring', 'Early Spring', 20, 80, [c(120), c(60)]],
    ['bcp_vulcanian_eruption', 'Volcanic Eruption', 11, 80, [c(0), c(60), 'W']],
    ['bcp_starry_night_sky', 'Starry Night Sky', 32, 80, [c(240), c(60), c(240)]],
    ['bcp_thunder_and_lightning', 'Thunder and Lightning', 7, 80, [c(180), 'W']],
    ['bcp_meteor_shower', 'Meteor Shower', 11, 80, [c(60)]],
    ['bcp_dream_fireworks', 'Dream Fireworks', 10, 80, RAINBOW7W],
    ['bcp_summer_wind', 'Summer Wind', 14, 80, [c(180), c(120), c(60)]],
    ['built_moonlight', 'Moonlight', 14, 80, [c(29.88), 'W']],
  ],
  atmosphere: [
    ['bcp_game', 'Game', 32, 80, RAINBOW6],
    ['bcp_party', 'Party', 34, 80, RAINBOW6],
    ['bcp_trend', 'Trend', 15, 80, RAINBOW6],
    ['bcp_holiday', 'Holiday', 33, 80, RAINBOW6],
    ['bcp_bonfire_party', 'Bonfire Party', 27, 80, ['W', c(0), c(29.88), c(60)]],
    ['bcp_neon_world', 'Neon World', 4, 80, RAINBOW6],
    ['bcp_journey_to_the_planet', 'Journey to the Planet', 37, 80, RAINBOW7W],
    ['bcp_dynamic_rhythm', 'Dynamic Rhythm', 10, 80, [c(240), c(120), c(0), c(180), c(300), c(60)]],
    ['bcp_champagne_party', 'Champagne Party', 17, 80, ['W', c(300), c(0), c(240), c(180), c(60)]],
    ['bcp_movie_night', 'Movie Night', 25, 80, RAINBOW7W],
  ],
  commerce: [
    ['bcp_astral_summit', 'Astral Summit', 13, 80, ['W'], 2],
    ['bcp_star_shining', 'Star Shining', 9, 80, [c(209.88), c(240)]],
    ['bcp_meteoric_crest', 'Meteoric Crest', 13, 80, [c(35.29)], 2],
    ['bcp_dynamic_flow_line', 'Dynamic Flow Line', 13, 80, [c(180), c(120), c(60)], 1],
    ['bcp_science', 'Science', 31, 80, RAINBOW6],
    ['bcp_midnight_city', 'Midnight City', 35, 80, RAINBOW6],
    ['bcp_advertising', 'Advertising', 22, 80, RAINBOW7W],
    ['bcp_fireworks_festival', 'Fireworks Festival', 36, 80, RAINBOW7W],
    ['bcp_rainbow_water', 'Rainbow Water', 14, 80, RAINBOW6],
    ['bcp_quality_stroke', 'Quality Stroke', 11, 80, RAINBOW6],
  ],
  romance: [
    ['bcp_candlelight_dinner', 'Candlelight Dinner', 2, 80, [AMBER]],
    ['bcp_confessional_surprise', 'Confession Surprise', 22, 80, [c(330.12), c(29.88)]],
    ['bcp_dating', 'Dating', 6, 80, [c(330.12), c(300), 'W']],
    ['bcp_wedding_vow', 'Wedding Vow', 15, 80, [c(330.12), 'W', c(330.12)]],
    ['bcp_musicbox_beats', 'Music Box Beats', 6, 80, RAINBOW6],
    ['bcp_roseleaf', 'Rose Leaf', 20, 80, [c(0), c(330.12), c(300)]],
    ['bcp_garden_picnic', 'Garden Picnic', 29, 80, [c(180), c(120), c(60), c(330.12)]],
  ],
  life: [
    ['bcp_night_lamp', 'Night Lamp', 20, 80, [c(17.67), 'W']],
    ['built_sunlight', 'Sunlight', 26, 80, ['W', AMBER]],
    ['built_cozy', 'Cozy', 13, 80, [AMBER]],
    ['bcp_sports', 'Sports', 26, 80, ['W', c(240)]],
    ['bcp_work', 'Work', 19, 80, ['W', AMBER]],
    ['bcp_dinner', 'Dinner', 31, 80, [AMBER, 'W']],
    ['bcp_patio', 'Patio', 2, 80, [AMBER, 'W']],
    ['bcp_night_view', 'Night View', 20, 80, [c(240), 'W']],
    ['bcp_cloakroom', 'Cloakroom', 1, 80, ['W', AMBER]],
    ['built_rest', 'Rest', 33, 80, [AMBER, 'W', AMBER, 'W', AMBER]],
    ['bcp_read', 'Reading', 19, 80, [AMBER]],
    ['bcp_outdoor_light', 'Outdoor Light', 19, 80, ['W']],
    ['bcp_childlike', 'Childlike', 29, 80, [AMBER, 'W']],
    ['bcp_camping', 'Camping', 22, 80, [c(240), 'W']],
    ['bcp_meditation', 'Meditation', 17, 80, [AMBER, 'W']],
    ['bcp_shadow', 'Shadow', 25, 80, [c(21.73, 95), c(60)]],
    ['bcp_macaroon', 'Macaroon', 20, 80, [c(21.18), c(46.35), c(310.91, 60)]],
    ['bcp_coffee_time', 'Coffee Time', 20, 80, [c(20, 100, 74), c(0, 0, 36), c(0, 0, 36)]],
    ['bcp_major_locate', 'Locate', 20, 80, ['K', 'K', 'K', 'W', 'K', 'K', 'K']],
    ['bcp_little_beauty', 'Little Beauty', 13, 80, ['W', c(21.73, 95)]],
    ['bcp_star', 'Star', 16, 100, ['W']],
  ],
  warm: [
    ['bcp_gentle_candlelight', 'Gentle Candlelight', 2, 80, ['T']],
    ['bcp_sunset_breeze', 'Sunset Breeze', 10, 80, ['T']],
    ['bcp_moonlight_rail', 'Moonlight Rail', 18, 80, ['T', 'W']],
    ['bcp_velvet_dream_time', 'Velvet Dream', 11, 80, ['T']],
    ['bcp_soft_twilight', 'Soft Twilight', 1, 80, ['T']],
    ['bcp_quiet_night_thoughts', 'Quiet Night Thoughts', 26, 80, ['T']],
    ['bcp_gentle_moonlight', 'Gentle Moonlight', 33, 80, ['T', 'W']],
    ['bcp_quiet_time', 'Quiet Time', 13, 80, ['T'], 1],
    ['bcp_warm_afterglow', 'Warm Afterglow', 15, 80, ['T', 'W']],
  ],
};

/**
 * Products that use this scene file, from the cloud's PresetSceneConfig index (captured
 * 2026-11-04): "PresetScene1314TabsRGBWV2" version 3, product ids with minVer 1.
 */
export const SCENE_SET_NAME = 'PresetScene1314TabsRGBWV2';
export const SCENE_PRODUCTS: number[] = [0x86, 0x022a, 0x022d, 0x0253, 0x0287];

export const SURPLIFE_SCENES: SurplifeScene[] = (Object.keys(ROWS) as SceneCategory[]).flatMap((category) =>
  ROWS[category].map(([key, name, type, speed, colours, other]) => ({ key, name, category, type, speed, other, colours })),
);

/** Scene id used in the picker: the key without the app prefix and punctuation. */
export function sceneId(key: string): string {
  return key.replace(/^(bcp|built)_/, '').replace(/[^a-z0-9]+/gi, '_').replace(/_+$/, '');
}

/** Display colour (HSV) for previews. */
export function sceneDisplayColour(col: SceneColour): { h: number; s: number; v: number } {
  if (col === 'W') return { h: 0, s: 0, v: 100 };
  if (col === 'K') return { h: 0, s: 0, v: 0 };
  if (col === 'T') return { h: 35, s: 45, v: 100 };
  return { h: col[0], s: col[1], v: col[2] };
}

/**
 * Palette bytes as the app sends them: hue / 2 rounded down, saturation and value in percent
 * (matches the app's own custom-effect command, captured 2026-11-04). No colour correction, so
 * scenes look the same as when started from the Surplife app. 'T' uses the warm-white channel.
 */
export function scenePaletteColour(col: SceneColour): PaletteColour {
  if (col === 'T') return { h: 0, s: 0, b: 0, cw: 0, ww: 100 }; // warm-white channel only
  const d = sceneDisplayColour(col);
  return { h: Math.floor(d.h / 2) & 0xff, s: Math.round(d.s), b: Math.round(d.v) };
}

/** The Surplife app's scenes for a product, or none when its scene set is not known here. */
export function scenesForProduct(productId: number): SurplifeScene[] {
  return SCENE_PRODUCTS.includes(productId) ? SURPLIFE_SCENES : [];
}
