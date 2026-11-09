import { describe, expect, it } from 'vitest';

import {
  LID_UNIQUE_SUPPORTED_CONFIDENCE,
  lidLabelLanguage,
  normalizeLidText,
  resolveLidDetection,
} from './resolveLidDetection';

describe('normalizeLidText', () => {
  it('lowercases and collapses newlines', () => {
    expect(normalizeLidText('Buenas\r\ntardes')).toBe('buenas tardes');
  });
});

describe('lidLabelLanguage', () => {
  it('strips the fastText label prefix', () => {
    expect(lidLabelLanguage('__label__es')).toBe('es');
    expect(lidLabelLanguage('__label__pt-BR')).toBe('pt');
  });
});

describe('resolveLidDetection', () => {
  it('returns null for empty or unsupported-only guesses', () => {
    expect(resolveLidDetection([])).toBeNull();
    expect(resolveLidDetection([[0.9, '__label__eo']])).toBeNull();
  });

  it('picks the highest-scoring supported language from top-k', () => {
    expect(
      resolveLidDetection([
        [0.55, '__label__eo'],
        [0.4, '__label__es'],
        [0.05, '__label__pt'],
      ]),
    ).toEqual({ language: 'es', confidence: LID_UNIQUE_SUPPORTED_CONFIDENCE });
  });

  it('keeps raw confidence when absolute mass is too low', () => {
    expect(
      resolveLidDetection([
        [0.98, '__label__eo'],
        [0.014, '__label__es'],
      ]),
    ).toEqual({ language: 'es', confidence: 0.014 });
  });

  it('coalesces unsupported Ibero-Romance aliases into Spanish confidence', () => {
    const detection = resolveLidDetection([
      [0.48, '__label__es'],
      [0.3, '__label__pt'],
      [0.12, '__label__gl'],
      [0.08, '__label__ca'],
      [0.02, '__label__an'],
    ]);
    expect(detection?.language).toBe('es');
    expect(detection?.confidence).toBeCloseTo(0.7);
  });

  it('uses pairwise decision confidence for Romance splits without merging es+pt', () => {
    const detection = resolveLidDetection([
      [0.4789, '__label__es'],
      [0.1874, '__label__pt'],
      [0.1285, '__label__it'],
      [0.1181, '__label__en'],
    ]);
    expect(detection?.language).toBe('es');
    // 0.4789 / (0.4789 + 0.1874) ≈ 0.719 — clears the 0.7 router gate
    expect(detection?.confidence).toBeCloseTo(0.4789 / (0.4789 + 0.1874));
    expect(detection!.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('promotes a unique supported winner split across unsupported labels', () => {
    const detection = resolveLidDetection([
      [0.6809, '__label__es'],
      [0.0743, '__label__io'],
      [0.0549, '__label__qu'],
      [0.0259, '__label__la'],
    ]);
    expect(detection).toEqual({
      language: 'es',
      confidence: LID_UNIQUE_SUPPORTED_CONFIDENCE,
    });
  });

  it('rejects near coin-flips between supported languages', () => {
    const detection = resolveLidDetection([
      [0.42, '__label__es'],
      [0.41, '__label__pt'],
    ]);
    expect(detection?.language).toBe('es');
    expect(detection?.confidence).toBeCloseTo(0.42 / (0.42 + 0.41));
    expect(detection!.confidence).toBeLessThan(0.7);
  });

  it('caps coalesced confidence at 1', () => {
    expect(
      resolveLidDetection([
        [0.8, '__label__es'],
        [0.3, '__label__gl'],
      ]),
    ).toEqual({ language: 'es', confidence: 1 });
  });
});
