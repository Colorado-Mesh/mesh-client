import { describe, expect, it } from 'vitest';

import {
  isMeshcoreCliSecretCommand,
  meshcoreCliSecretCommandHead,
  redactMeshcoreCliSecretCommand,
  redactMeshcoreCliSecretsInText,
} from './meshcoreCliSecrets';

describe('meshcoreCliSecrets commands', () => {
  it.each([
    ['set wifi.pwd hunter2', 'set wifi.pwd'],
    ['get wifi.pwd', 'get wifi.pwd'],
    ['set pin 123456', 'set pin'],
    ['SET  PIN 1', 'SET  PIN'],
    ['set guest.password x', 'set guest.password'],
    ['get prv.key', 'get prv.key'],
    ['password newpass', 'password'],
    ['a1|set wifi.pwd hunter2', 'set wifi.pwd'],
  ])('%s is secret', (command, head) => {
    expect(meshcoreCliSecretCommandHead(command)).toBe(head);
    expect(redactMeshcoreCliSecretCommand(command)).toBe(`${head} [redacted]`);
  });

  it.each(['set wifi.ssid home', 'get pinned', 'ver', 'set name pin', 'neighbors'])(
    '%s is not secret',
    (command) => {
      expect(isMeshcoreCliSecretCommand(command)).toBe(false);
      expect(redactMeshcoreCliSecretCommand(command)).toBe(command);
    },
  );
});

describe('redactMeshcoreCliSecretsInText', () => {
  it.each([
    ['[cli] set wifi.pwd hunter2 -> OK', '[cli] set wifi.pwd [redacted]'],
    ['[cli] a1|set pin 123456', '[cli] a1|set pin [redacted]'],
    ['get wifi.pwd -> hunter2', 'get wifi.pwd [redacted]'],
    ['reply: wifi.pwd = hunter2', 'reply: wifi.pwd: [redacted]'],
    ['> wifi.pwd: hunter2', '> wifi.pwd: [redacted]'],
    ['set guest.password abc', 'set guest.password [redacted]'],
  ])('%s', (input, expected) => {
    expect(redactMeshcoreCliSecretsInText(input)).toBe(expected);
  });

  it('works per line and leaves other lines and already-redacted text alone', () => {
    const text =
      'a\r\nset pin 1\r\nb set wifi.pwd [redacted]\nwifi.pwd: [redacted]\nreset pin ok\n';
    expect(redactMeshcoreCliSecretsInText(text)).toBe(
      'a\r\nset pin [redacted]\r\nb set wifi.pwd [redacted]\nwifi.pwd: [redacted]\nreset pin ok\n',
    );
  });

  it('does not touch ordinary password wording', () => {
    const line = '[repeater] login failed: wrong password for 0x1a';
    expect(redactMeshcoreCliSecretsInText(line)).toBe(line);
  });
});
