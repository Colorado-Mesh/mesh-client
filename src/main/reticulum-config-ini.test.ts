import { describe, expect, it } from 'vitest';

import {
  parseReticulumIniEnabledValue,
  parseReticulumIniInterfaceField,
} from './reticulum-config-ini';

describe('parseReticulumIniEnabledValue', () => {
  it.each([
    ['yes', true],
    ['YES', true],
    ['true', true],
    ['True', true],
    ['on', true],
    ['1', true],
    ['no', false],
    ['false', false],
    ['off', false],
    ['0', false],
    ['maybe', false],
    ['', false],
  ])('treats %s as %s', (raw, expected) => {
    expect(parseReticulumIniEnabledValue(raw)).toBe(expected);
  });
});

describe('parseReticulumIniInterfaceField', () => {
  it('parses unquoted key=value lines', () => {
    expect(parseReticulumIniInterfaceField('type = tcp')).toEqual({
      key: 'type',
      value: 'tcp',
    });
  });

  it('strips surrounding quotes of either kind', () => {
    expect(parseReticulumIniInterfaceField('name = "my node"')).toEqual({
      key: 'name',
      value: 'my node',
    });
    expect(parseReticulumIniInterfaceField("call = 'N0CALL'")).toEqual({
      key: 'call',
      value: 'N0CALL',
    });
  });

  it('keeps inner equals signs in the value', () => {
    expect(parseReticulumIniInterfaceField('url = https://host:port/path?x=1')).toEqual({
      key: 'url',
      value: 'https://host:port/path?x=1',
    });
  });

  it('normalizes keys to lowercase and trims whitespace', () => {
    expect(parseReticulumIniInterfaceField('  Type  =  tcp  ')).toEqual({
      key: 'type',
      value: 'tcp',
    });
  });

  it('rejects lines without an equals sign or with an empty key', () => {
    expect(parseReticulumIniInterfaceField('just a value')).toBeNull();
    expect(parseReticulumIniInterfaceField('=value')).toBeNull();
    expect(parseReticulumIniInterfaceField('')).toBeNull();
  });
});
