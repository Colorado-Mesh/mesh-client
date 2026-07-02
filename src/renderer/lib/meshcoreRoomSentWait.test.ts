import { describe, expect, it } from 'vitest';

import {
  deserializeMeshcoreUserMessage,
  meshcoreUserMessageKey,
} from './meshcore/meshcoreMessageI18n';
import {
  meshcoreRoomPostSendErrorMessage,
  meshcoreRoomPostSendErrorStored,
} from './meshcoreRoomSentWait';

describe('meshcoreRoomSentWait', () => {
  it('maps undefined reject to default room post key', () => {
    expect(meshcoreUserMessageKey(meshcoreRoomPostSendErrorMessage(undefined))).toBe(
      'meshcore.errors.roomPost.default',
    );
    expect(meshcoreUserMessageKey(meshcoreRoomPostSendErrorMessage(new Error('undefined')))).toBe(
      'meshcore.errors.roomPost.default',
    );
  });

  it('maps sendRoomPost timeout to timeout key', () => {
    expect(
      meshcoreUserMessageKey(
        meshcoreRoomPostSendErrorMessage(new Error('sendRoomPost timed out after 90000ms')),
      ),
    ).toBe('meshcore.errors.roomPost.timeout');
  });

  it('meshcoreRoomPostSendErrorStored serializes i18n refs', () => {
    const stored = meshcoreRoomPostSendErrorStored(undefined);
    expect(stored.startsWith('\x1eMC_I18N:')).toBe(true);
    expect(meshcoreUserMessageKey(deserializeMeshcoreUserMessage(stored))).toBe(
      'meshcore.errors.roomPost.default',
    );
  });
});
