import { describe, expect, it } from 'vitest';

import {
  CONNECTION_HEADER_PULSE_RED_DOT,
  CONNECTION_HEADER_PULSE_RED_TEXT,
  deviceHeaderVariant,
  headerDotClass,
  headerIconClass,
  headerTextClass,
  isDeviceErrorDisconnect,
  isMqttErrorDisconnect,
  isTakErrorDisconnect,
  mqttHeaderVariant,
  takHeaderVariant,
} from './connectionHeaderStatus';

describe('connectionHeaderStatus', () => {
  describe('isMqttErrorDisconnect', () => {
    it('is true for error status', () => {
      expect(isMqttErrorDisconnect('error', false)).toBe(true);
    });

    it('is true when connection loss flag is set', () => {
      expect(isMqttErrorDisconnect('disconnected', true)).toBe(true);
    });

    it('is false for manual disconnect', () => {
      expect(isMqttErrorDisconnect('disconnected', false)).toBe(false);
    });
  });

  describe('isDeviceErrorDisconnect', () => {
    it('is true when reconnecting', () => {
      expect(isDeviceErrorDisconnect('reconnecting', false)).toBe(true);
    });

    it('is true when connection loss flag is set', () => {
      expect(isDeviceErrorDisconnect('disconnected', true)).toBe(true);
    });

    it('is false for manual disconnect', () => {
      expect(isDeviceErrorDisconnect('disconnected', false)).toBe(false);
    });
  });

  describe('isTakErrorDisconnect', () => {
    it('is true when server stopped with error', () => {
      expect(isTakErrorDisconnect(false, true, false)).toBe(true);
    });

    it('is true when client lost while server running', () => {
      expect(isTakErrorDisconnect(true, false, true)).toBe(true);
    });

    it('is false when manually stopped', () => {
      expect(isTakErrorDisconnect(false, false, false)).toBe(false);
    });
  });

  describe('variants and classes', () => {
    it('mqtt error uses pulsing red text', () => {
      expect(mqttHeaderVariant('error', false)).toBe('error');
      expect(headerTextClass('error')).toBe(CONNECTION_HEADER_PULSE_RED_TEXT);
      expect(headerIconClass('error')).toBe(CONNECTION_HEADER_PULSE_RED_TEXT);
    });

    it('mqtt connecting uses yellow pulse', () => {
      expect(mqttHeaderVariant('connecting', false)).toBe('warn');
      expect(headerTextClass('warn')).toContain('text-yellow-400');
    });

    it('device error uses pulsing red dot', () => {
      expect(deviceHeaderVariant('reconnecting', false)).toBe('error');
      expect(headerDotClass('error')).toBe(CONNECTION_HEADER_PULSE_RED_DOT);
    });

    it('device manual disconnect is idle', () => {
      expect(deviceHeaderVariant('disconnected', false)).toBe('idle');
      expect(headerDotClass('idle')).not.toContain('animate-pulse');
    });

    it('tak running ok is green', () => {
      expect(takHeaderVariant(true, false, false)).toBe('ok');
      expect(headerTextClass('ok')).toContain('text-brand-green');
    });
  });
});
