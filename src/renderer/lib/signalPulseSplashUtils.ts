import type { MeshProtocol } from './types';

/** i18n keys — resolved with `t()` in splash overlays. */
export const INCLUSIVE_ONE_LINER_KEYS = [
  'signalPropagation.oneLiners.stayOnTheAir',
  'signalPropagation.oneLiners.helloOperator',
  'signalPropagation.oneLiners.thanksForMeshing',
  'signalPropagation.oneLiners.builtForCommunities',
  'signalPropagation.oneLiners.stayConnected',
  'signalPropagation.oneLiners.signalsOut',
  'signalPropagation.oneLiners.gladYouAreHere',
  'signalPropagation.oneLiners.keepTheMeshAlive',
] as const;

export function pickInclusiveOneLinerKey(seed: number): (typeof INCLUSIVE_ONE_LINER_KEYS)[number] {
  const n = INCLUSIVE_ONE_LINER_KEYS.length;
  const idx = ((seed % n) + n) % n;
  return INCLUSIVE_ONE_LINER_KEYS[idx];
}

export interface SignalPulseTheme {
  illuminationStops: [number, string][];
  trailStroke: string;
  trailShadow: string;
  ringStroke: string;
  ringShadow: string;
  letterStroke: (alpha: number) => string;
  letterFill: (alpha: number) => string;
  letterGlow: (alpha: number) => string;
}

export function getSignalPulseTheme(protocol: MeshProtocol): SignalPulseTheme {
  if (protocol === 'meshcore') {
    return {
      illuminationStops: [
        [0, 'rgba(34, 211, 238, 0)'],
        [0.42, 'rgba(34, 211, 238, 0.045)'],
        [0.52, 'rgba(165, 243, 252, 0.1)'],
        [0.62, 'rgba(34, 211, 238, 0.04)'],
        [1, 'rgba(34, 211, 238, 0)'],
      ],
      trailStroke: 'rgba(34, 211, 238, 0.2)',
      trailShadow: 'rgba(34, 211, 238, 0.35)',
      ringStroke: '#22d3ee',
      ringShadow: '#67e8f9',
      letterStroke: (a) => `rgba(8, 25, 35, ${Math.min(0.78, a * 0.8)})`,
      letterFill: (a) => `rgba(165, 243, 252, ${Math.min(0.95, a)})`,
      letterGlow: (a) => `rgba(103, 232, 249, ${Math.min(0.75, a * 0.85)})`,
    };
  }
  return {
    illuminationStops: [
      [0, 'rgba(0, 255, 0, 0)'],
      [0.42, 'rgba(120, 255, 140, 0.045)'],
      [0.52, 'rgba(200, 255, 200, 0.1)'],
      [0.62, 'rgba(120, 255, 140, 0.04)'],
      [1, 'rgba(0, 255, 0, 0)'],
    ],
    trailStroke: 'rgba(0, 255, 0, 0.2)',
    trailShadow: 'rgba(0, 255, 0, 0.35)',
    ringStroke: '#00FF00',
    ringShadow: '#66ff66',
    letterStroke: (a) => `rgba(2, 18, 8, ${Math.min(0.78, a * 0.8)})`,
    letterFill: (a) => `rgba(130, 255, 150, ${Math.min(0.95, a)})`,
    letterGlow: (a) => `rgba(80, 255, 110, ${Math.min(0.75, a * 0.85)})`,
  };
}
