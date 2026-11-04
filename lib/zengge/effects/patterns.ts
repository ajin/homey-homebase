/**
 * What the controller's built-in patterns look like.
 *
 * Source: magichome2-ble (MIT) docs/protocol_map.md "Effect ID Table" - observations of the same
 * pattern numbers on Surplife-app string lights (YIQU), captured while driving them with the
 * Surplife app. Entries marked "Quntis" were observed on the user's Quntis NS-I-204-M-E
 * (2026-11-03) and override the table; patterns with no description are previewed without
 * movement rather than with a guessed one.
 */

export type Motion =
  | 'rainbow' // colours sweep along the string
  | 'fade' // whole string fades from colour to colour
  | 'strobe' // sharp flashes
  | 'flow' // smooth liquid-like movement
  | 'blink' // alternating groups blink
  | 'breathe' // brightness rises and falls
  | 'mixed' // several segment patterns combined
  | 'chase' // colours chase along the string
  | 'twinkle' // random twinkling points
  | 'cycle' // steps through the colours
  | 'gradient' // a gradient slowly shifts
  | 'segments' // coloured segments move along
  | 'flash' // different colours flash quickly
  | 'static' // fixed multicolour pattern, no movement
  | 'shift' // every LED a different colour, each changing to the next
  | 'unknown';

export interface PatternInfo {
  name: string;
  motion: Motion;
}

export const PATTERN_INFO: Record<number, PatternInfo> = {
  1: { name: 'Colour fade', motion: 'fade' }, // Quntis: slow fade through the colours
  2: { name: 'Colour shift', motion: 'shift' }, // Quntis: each LED a different colour, changing
  4: { name: 'Strobe', motion: 'strobe' },
  7: { name: 'Water flow', motion: 'flow' },
  10: { name: 'Alternating blink', motion: 'blink' },
  11: { name: 'Breathe', motion: 'breathe' },
  13: { name: 'Colour flash', motion: 'flash' }, // Quntis: different colours flashing quickly
  14: { name: 'Wave', motion: 'chase' },
  15: { name: 'Twinkle', motion: 'twinkle' },
  17: { name: 'Alternating strobe', motion: 'strobe' },
  19: { name: 'Two-colour fade', motion: 'fade' },
  20: { name: 'Static colours', motion: 'static' }, // Quntis: colours on different LEDs, no movement
  22: { name: 'Smooth rainbow', motion: 'rainbow' },
  25: { name: 'Colour chase', motion: 'segments' },
  26: { name: 'Two-colour pulse', motion: 'breathe' },
  28: { name: 'Two-colour swap', motion: 'blink' },
  29: { name: 'Gradient shift', motion: 'gradient' },
  32: { name: 'Smooth transition', motion: 'fade' },
  33: { name: 'Segment flow', motion: 'flow' },
  34: { name: 'Async breathing', motion: 'breathe' },
  37: { name: 'Rainbow chase', motion: 'chase' },
};

export function patternInfo(pattern: number): PatternInfo {
  return PATTERN_INFO[pattern] ?? { name: `Pattern ${pattern}`, motion: 'unknown' };
}
