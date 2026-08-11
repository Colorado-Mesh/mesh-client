// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  getHeadlessRemoteConfig,
  HEADLESS_FPS_MAX,
  HEADLESS_FPS_MIN,
  HEADLESS_HOST_DEFAULT,
  HEADLESS_JPEG_QUALITY_MIN,
  HEADLESS_PORT_DEFAULT,
  HEADLESS_VIEWPORT_HEIGHT_DEFAULT,
  HEADLESS_VIEWPORT_WIDTH_DEFAULT,
  HEADLESS_WS_HEARTBEAT_SEC_DEFAULT,
  isDockerContainer,
  isHeadlessServerMode,
  parseBooleanEnv,
  parseViewportSize,
} from './headless';

const WITHOUT_HEADLESS: NodeJS.ProcessEnv = {};
const NOT_DOCKER = (): boolean => false;
const IN_DOCKER = (): boolean => true;

describe('isHeadlessServerMode / parseBooleanEnv', () => {
  it('treats 1/true/yes/on as enabled', () => {
    for (const v of ['1', 'true', 'TRUE', 'yes', 'on']) {
      expect(parseBooleanEnv(v)).toBe(true);
    }
  });

  it('treats missing/0/false/no/garbage as disabled', () => {
    for (const v of [undefined, '', '0', 'false', 'no', 'off', 'banana']) {
      expect(parseBooleanEnv(v)).toBe(false);
    }
  });

  it('isHeadlessServerMode reads MESH_CLIENT_HEADLESS', () => {
    expect(isHeadlessServerMode({}, NOT_DOCKER)).toBe(false);
    expect(isHeadlessServerMode({ MESH_CLIENT_HEADLESS: '1' }, NOT_DOCKER)).toBe(true);
    expect(isHeadlessServerMode({ MESH_CLIENT_HEADLESS: '0' }, NOT_DOCKER)).toBe(false);
  });

  it('isHeadlessServerMode forces headless inside a container regardless of env', () => {
    expect(isHeadlessServerMode({}, IN_DOCKER)).toBe(true);
    expect(isHeadlessServerMode({ MESH_CLIENT_HEADLESS: '0' }, IN_DOCKER)).toBe(true);
  });
});

describe('isDockerContainer', () => {
  it('detects Docker via /.dockerenv', () => {
    expect(isDockerContainer((path) => path === '/.dockerenv')).toBe(true);
  });

  it('detects Podman via /run/.containerenv', () => {
    expect(isDockerContainer((path) => path === '/run/.containerenv')).toBe(true);
  });

  it('returns false on a plain host', () => {
    expect(isDockerContainer(() => false)).toBe(false);
  });
});

describe('getHeadlessRemoteConfig defaults', () => {
  it('uses documented defaults when unset', () => {
    const cfg = getHeadlessRemoteConfig(WITHOUT_HEADLESS);
    expect(cfg.host).toBe(HEADLESS_HOST_DEFAULT);
    expect(cfg.port).toBe(HEADLESS_PORT_DEFAULT);
    expect(cfg.token).toBe('');
    expect(cfg.fps).toBe(5);
    expect(cfg.jpegQuality).toBe(70);
    expect(cfg.viewportWidth).toBe(HEADLESS_VIEWPORT_WIDTH_DEFAULT);
    expect(cfg.viewportHeight).toBe(HEADLESS_VIEWPORT_HEIGHT_DEFAULT);
    expect(cfg.wsHeartbeatSec).toBe(HEADLESS_WS_HEARTBEAT_SEC_DEFAULT);
  });

  it('applies configured values', () => {
    const cfg = getHeadlessRemoteConfig({
      MESH_CLIENT_REMOTE_HOST: '127.0.0.1',
      MESH_CLIENT_REMOTE_PORT: '9123',
      MESH_CLIENT_REMOTE_TOKEN: '  sekrit  ',
      MESH_CLIENT_REMOTE_FPS: '8',
      MESH_CLIENT_REMOTE_JPEG_QUALITY: '55',
      MESH_CLIENT_REMOTE_VIEWPORT: '1024x768',
      MESH_CLIENT_REMOTE_WS_HEARTBEAT_SEC: '15',
    });
    expect(cfg.host).toBe('127.0.0.1');
    expect(cfg.port).toBe(9123);
    expect(cfg.token).toBe('sekrit');
    expect(cfg.fps).toBe(8);
    expect(cfg.jpegQuality).toBe(55);
    expect(cfg.viewportWidth).toBe(1024);
    expect(cfg.viewportHeight).toBe(768);
    expect(cfg.wsHeartbeatSec).toBe(15);
  });

  it('clamps out-of-range integers instead of crashing', () => {
    const cfg = getHeadlessRemoteConfig({
      MESH_CLIENT_REMOTE_PORT: '0',
      MESH_CLIENT_REMOTE_FPS: '200',
      MESH_CLIENT_REMOTE_JPEG_QUALITY: '-5',
      MESH_CLIENT_REMOTE_VIEWPORT: '999999x1',
    });
    expect(cfg.port).toBe(1); // clampTcpPort clamps to IANA min (not fallback)
    expect(cfg.fps).toBe(HEADLESS_FPS_MAX);
    expect(cfg.jpegQuality).toBe(HEADLESS_JPEG_QUALITY_MIN);
    expect(cfg.viewportWidth).toBe(HEADLESS_VIEWPORT_WIDTH_DEFAULT);
    expect(cfg.viewportHeight).toBe(HEADLESS_VIEWPORT_HEIGHT_DEFAULT);
  });

  it('falls back to defaults on total garbage', () => {
    const cfg = getHeadlessRemoteConfig({
      MESH_CLIENT_REMOTE_PORT: 'not-a-port',
      MESH_CLIENT_REMOTE_FPS: 'lots',
      MESH_CLIENT_REMOTE_JPEG_QUALITY: '!!',
      MESH_CLIENT_REMOTE_VIEWPORT: 'a;b',
    });
    expect(cfg.port).toBe(HEADLESS_PORT_DEFAULT);
    expect(cfg.fps).toBe(5);
    expect(cfg.jpegQuality).toBe(70);
    expect(cfg.viewportWidth).toBe(HEADLESS_VIEWPORT_WIDTH_DEFAULT);
    expect(cfg.viewportHeight).toBe(HEADLESS_VIEWPORT_HEIGHT_DEFAULT);
  });

  it('burns down but never throws for any env combination', () => {
    const weird = {
      MESH_CLIENT_HEADLESS: 'x'.repeat(100),
      MESH_CLIENT_REMOTE_PORT: '65536',
      MESH_CLIENT_REMOTE_FPS: `${HEADLESS_FPS_MIN - 10}`,
      MESH_CLIENT_REMOTE_VIEWPORT: '0x0',
      MESH_CLIENT_REMOTE_HOST: '',
    };
    expect(() => getHeadlessRemoteConfig(weird)).not.toThrow();
    expect(() => isHeadlessServerMode(weird, NOT_DOCKER)).not.toThrow();
  });
});

describe('parseViewportSize', () => {
  it('parses WxH', () => {
    expect(parseViewportSize('1920x1080', 1280, 800)).toEqual({ width: 1920, height: 1080 });
  });

  it('rejects non-numeric, zero, huge, or malformed sizes', () => {
    expect(parseViewportSize('abc', 1, 2)).toEqual({ width: 1, height: 2 });
    expect(parseViewportSize('0x100', 1, 2)).toEqual({ width: 1, height: 2 });
    expect(parseViewportSize('100x', 1, 2)).toEqual({ width: 1, height: 2 });
    expect(parseViewportSize('100x200x300', 1, 2)).toEqual({ width: 1, height: 2 });
    expect(parseViewportSize('20000x20000', 1, 2)).toEqual({ width: 1, height: 2 });
  });
});
