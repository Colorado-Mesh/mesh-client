import { describe, expect, it } from 'vitest';

import { evaluateSignature, parseAuthenticodeJson } from './verify-win-packaging.mjs';

describe('parseAuthenticodeJson', () => {
  it('parses Valid status with signer subject', () => {
    const json = JSON.stringify({
      Status: 'Valid',
      SignerCertificate: { Subject: 'CN=Colorado Mesh, O=Colorado Mesh, C=US' },
    });
    expect(parseAuthenticodeJson(json)).toEqual({
      status: 'Valid',
      subject: 'CN=Colorado Mesh, O=Colorado Mesh, C=US',
    });
  });

  it('parses NotSigned with null certificate', () => {
    const json = JSON.stringify({ Status: 'NotSigned', SignerCertificate: null });
    expect(parseAuthenticodeJson(json)).toEqual({ status: 'NotSigned', subject: null });
  });
});

describe('evaluateSignature', () => {
  it('skips when NotSigned (dormant/unsigned build stays green)', () => {
    expect(evaluateSignature({ status: 'NotSigned', subject: null }).action).toBe('skip');
  });

  it('fails when signed but status is not Valid', () => {
    const r = evaluateSignature({ status: 'HashMismatch', subject: 'CN=X' });
    expect(r.action).toBe('fail');
    expect(r.reason).toMatch(/HashMismatch/);
  });

  it('passes when Valid and no publisher expectation', () => {
    expect(evaluateSignature({ status: 'Valid', subject: 'CN=Colorado Mesh' }).action).toBe('pass');
  });

  it('passes when Valid and subject contains the expected publisher', () => {
    const r = evaluateSignature(
      { status: 'Valid', subject: 'CN=Colorado Mesh, O=Colorado Mesh' },
      'Colorado Mesh',
    );
    expect(r.action).toBe('pass');
  });

  it('fails when Valid but publisher does not match (updater would break)', () => {
    const r = evaluateSignature({ status: 'Valid', subject: 'CN=Someone Else' }, 'Colorado Mesh');
    expect(r.action).toBe('fail');
    expect(r.reason).toMatch(/does not contain expected publisher/);
  });
});
