import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '../lib/a11yTestHelpers';
import { registerMeshtasticKeyVerificationSender } from '../lib/meshtastic/meshtasticKeyVerification';
import type { IdentityId } from '../lib/types';
import {
  applyKeyVerificationClientNotification,
  initiateKeyVerification,
  resetKeyVerificationStore,
  useKeyVerificationStore,
} from '../stores/keyVerificationStore';
import { KeyVerificationDialog } from './KeyVerificationDialog';

const ID = 'id-kv-dialog' as IdentityId;

describe('KeyVerificationDialog', () => {
  const sender = vi.fn();
  let unregister: () => void;

  beforeEach(() => {
    resetKeyVerificationStore();
    sender.mockReset().mockResolvedValue(undefined);
    unregister = registerMeshtasticKeyVerificationSender(sender);
    vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    unregister();
    vi.restoreAllMocks();
  });

  it('renders nothing without a session', () => {
    const { container } = render(<KeyVerificationDialog />);
    expect(container).toBeEmptyDOMElement();
  });

  it('responder: shows the formatted security number', () => {
    render(<KeyVerificationDialog />);
    act(() => {
      applyKeyVerificationClientNotification(ID, {
        payloadVariant: {
          case: 'keyVerificationNumberInform',
          value: { nonce: 1n, remoteLongname: 'Alice', securityNumber: 12345 },
        },
      });
    });
    expect(screen.getByRole('dialog', { name: /Alice/ })).toBeInTheDocument();
    expect(screen.getByTestId('key-verification-security-number')).toHaveTextContent('012 345');
  });

  it('initiator: submits the typed security number', async () => {
    const user = userEvent.setup();
    render(<KeyVerificationDialog />);
    await act(async () => {
      await initiateKeyVerification(ID, 0x42, 'Bob');
    });
    act(() => {
      applyKeyVerificationClientNotification(ID, {
        payloadVariant: {
          case: 'keyVerificationNumberRequest',
          value: { nonce: 8n, remoteLongname: 'Bob' },
        },
      });
    });
    await user.type(screen.getByRole('textbox', { name: /Security number from Bob/ }), '654321');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(sender).toHaveBeenLastCalledWith({
      type: 'provideSecurityNumber',
      remoteNodeNum: 0x42,
      nonce: 8n,
      securityNumber: 654321,
    });
  });

  it('compare step: confirm sends DO_VERIFY and shows success', async () => {
    const user = userEvent.setup();
    render(<KeyVerificationDialog />);
    await act(async () => {
      await initiateKeyVerification(ID, 0x42, 'Bob');
    });
    act(() => {
      applyKeyVerificationClientNotification(ID, {
        payloadVariant: {
          case: 'keyVerificationFinal',
          value: {
            nonce: 8n,
            remoteLongname: 'Bob',
            isSender: true,
            verificationCharacters: 'Q7Z9',
          },
        },
      });
    });
    expect(screen.getByTestId('key-verification-characters')).toHaveTextContent('Q7Z9');
    await user.click(screen.getByRole('button', { name: 'They match' }));
    expect(sender).toHaveBeenLastCalledWith({ type: 'doVerify', remoteNodeNum: 0x42, nonce: 8n });
    expect(await screen.findByRole('status')).toHaveTextContent(/manually verified/);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(useKeyVerificationStore.getState().session).toBeNull();
  });

  it('shows an error notice when the radio cannot be reached', async () => {
    sender.mockRejectedValue(new Error('offline'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(<KeyVerificationDialog />);
    await act(async () => {
      await initiateKeyVerification(ID, 0x42, 'Bob');
    });
    expect(screen.getByRole('alert')).toHaveTextContent(/Could not reach the radio/);
  });

  it('Escape cancels the session', async () => {
    const user = userEvent.setup();
    render(<KeyVerificationDialog />);
    await act(async () => {
      await initiateKeyVerification(ID, 0x42, 'Bob');
    });
    await user.keyboard('{Escape}');
    expect(useKeyVerificationStore.getState().session).toBeNull();
  });

  it('has no axe violations on the compare step', async () => {
    const { container } = render(<KeyVerificationDialog />);
    act(() => {
      applyKeyVerificationClientNotification(ID, {
        payloadVariant: {
          case: 'keyVerificationFinal',
          value: {
            nonce: 1n,
            remoteLongname: 'Bob',
            isSender: false,
            verificationCharacters: 'AB12',
          },
        },
      });
    });
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
