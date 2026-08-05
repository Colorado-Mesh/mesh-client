/**
 * Classic IRC-style stable nick colors for RRC transcript + nicklist.
 * Fixed Tailwind palette — avoids amber chrome and low-contrast greys.
 */

export const RRC_NICK_COLOR_CLASSES = [
  'text-cyan-300',
  'text-green-300',
  'text-sky-300',
  'text-violet-300',
  'text-rose-300',
  'text-lime-300',
  'text-orange-300',
  'text-teal-300',
  'text-fuchsia-300',
  'text-emerald-300',
  'text-indigo-300',
  'text-pink-300',
] as const;

export type RrcNickColorClass = (typeof RRC_NICK_COLOR_CLASSES)[number];

/** Case-insensitive hash of a nick (or displayed hash prefix) → palette class. */
export function rrcNickColorClass(nickOrLabel: string): RrcNickColorClass {
  const key = nickOrLabel.trim().toLowerCase();
  if (!key) return RRC_NICK_COLOR_CLASSES[0];
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const idx = (h >>> 0) % RRC_NICK_COLOR_CLASSES.length;
  return RRC_NICK_COLOR_CLASSES[idx];
}
