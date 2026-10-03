// @vitest-environment node
import { randomBytes, X509Certificate } from 'node:crypto';
import https from 'node:https';
import type { AddressInfo } from 'node:net';

import * as forge from 'node-forge';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../log-service', async () => {
  const { sanitizeLogMessage } = await import('../sanitize-log-message');
  return { sanitizeLogMessage };
});

import { createTakTestPki, type TakTestPki } from '../fixtures/tak-test-pki';
import {
  enrollTakClientCertificate,
  parseEnrollmentNameEntries,
  parseEnrollmentResponse,
  type TakEnrollmentHttp,
} from './enrollment';

let pki: TakTestPki;

beforeAll(() => {
  pki = createTakTestPki();
});

const CONFIG_XML = `<?xml version="1.0" encoding="UTF-8"?>
<ns2:certificateConfig xmlns:ns2="com.bbn.marti.config">
  <nameEntries>
    <nameEntry name="O" value="TAK"/>
    <nameEntry name="OU" value="Colorado Mesh"/>
  </nameEntries>
</ns2:certificateConfig>`;

function derBase64(cert: forge.pki.Certificate): string {
  return Buffer.from(
    forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(),
    'binary',
  ).toString('base64');
}

function signCsr(csrPem: string): forge.pki.Certificate {
  const csr = forge.pki.certificationRequestFromPem(csrPem);
  const cert = forge.pki.createCertificate();
  cert.publicKey = csr.publicKey!;
  cert.serialNumber = '01' + randomBytes(8).toString('hex');
  cert.validity.notBefore = new Date(Date.now() - 60_000);
  cert.validity.notAfter = new Date(Date.now() + 24 * 60 * 60 * 1000);
  cert.setSubject(csr.subject.attributes);
  cert.setIssuer(pki.ca.cert.subject.attributes);
  cert.sign(pki.ca.key, forge.md.sha256.create());
  return cert;
}

describe('TAK certificate enrollment over loopback HTTPS', () => {
  const servers: https.Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
        (s) =>
          new Promise<void>((resolve) => {
            s.closeAllConnections();
            s.close(() => {
              resolve();
            });
          }),
      ),
    );
  });

  async function startEnrollmentServer() {
    const seen = { csrSubject: [] as string[], clientUid: '' };
    const expectedAuth = `Basic ${Buffer.from('kd0abc:secret').toString('base64')}`;
    const server = https.createServer(
      { key: pki.server.keyPem, cert: pki.server.certPem },
      (req, res) => {
        if (req.headers.authorization !== expectedAuth) {
          res.writeHead(401).end();
          return;
        }
        const url = new URL(req.url ?? '/', 'https://localhost');
        if (req.method === 'GET' && url.pathname === '/Marti/api/tls/config') {
          res.writeHead(200, { 'Content-Type': 'application/xml' }).end(CONFIG_XML);
          return;
        }
        if (req.method === 'POST' && url.pathname === '/Marti/api/tls/signClient/v2') {
          let body = '';
          req.setEncoding('utf-8');
          req.on('data', (c: string) => (body += c));
          req.on('end', () => {
            const cert = signCsr(body);
            seen.csrSubject = cert.subject.attributes.map((a) => `${a.shortName}=${a.value}`);
            seen.clientUid = url.searchParams.get('clientUid') ?? '';
            res
              .writeHead(200, { 'Content-Type': 'application/json' })
              .end(JSON.stringify({ signedCert: derBase64(cert), ca0: derBase64(pki.ca.cert) }));
          });
          return;
        }
        res.writeHead(404).end();
      },
    );
    servers.push(server);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    return { port: (server.address() as AddressInfo).port, seen };
  }

  it('enrolls with the server subject fields and returns a matching key, cert, and CA', async () => {
    const { port, seen } = await startEnrollmentServer();
    const creds = await enrollTakClientCertificate({
      host: '127.0.0.1',
      port,
      username: 'kd0abc',
      password: 'secret',
      verifyServer: false,
    });

    expect(seen.csrSubject).toEqual(['CN=kd0abc', 'O=TAK', 'OU=Colorado Mesh']);
    expect(seen.clientUid).toBe('mesh-client-kd0abc');
    expect(creds.cert).toBeDefined();
    expect(creds.key).toMatch(/BEGIN PRIVATE KEY/);
    expect(new X509Certificate(creds.ca ?? '').subject).toContain('CN=Test TAK CA');
    expect(new X509Certificate(creds.cert ?? '').subject).toContain('CN=kd0abc');
  });

  it('reports a wrong login in plain language', async () => {
    const { port } = await startEnrollmentServer();
    await expect(
      enrollTakClientCertificate({
        host: '127.0.0.1',
        port,
        username: 'kd0abc',
        password: 'wrong',
        verifyServer: false,
      }),
    ).rejects.toThrow('The server rejected the username or password');
  });

  it('does not trust a self-signed enrollment server unless its CA was imported', async () => {
    const { port } = await startEnrollmentServer();
    await expect(
      enrollTakClientCertificate({
        host: '127.0.0.1',
        port,
        username: 'kd0abc',
        password: 'secret',
        verifyServer: true,
      }),
    ).rejects.toThrow(/not trusted/);
  });
});

describe('enrollment request options', () => {
  it('trusts an imported CA beside the system roots and sends Basic auth', async () => {
    const http = vi.fn<TakEnrollmentHttp>(() => Promise.resolve({ status: 403, body: '' }));
    await expect(
      enrollTakClientCertificate(
        {
          host: '[fd00::5]',
          port: 8446,
          username: 'kd0abc',
          password: 'pässword',
          verifyServer: true,
          trustedCa: pki.ca.certPem,
        },
        http,
      ),
    ).rejects.toThrow('The server rejected the username or password');
    const options = http.mock.calls[0]?.[0];
    expect(options).toMatchObject({ host: 'fd00::5', port: 8446, rejectUnauthorized: true });
    expect(options?.ca).toContain(pki.ca.certPem);
    expect(options?.headers).toMatchObject({
      Authorization: `Basic ${Buffer.from('kd0abc:pässword', 'utf-8').toString('base64')}`,
    });
  });

  it.each([
    [404, 'does not offer certificate enrollment'],
    [500, 'Certificate enrollment failed (HTTP 500)'],
  ])('explains HTTP %s', async (status, text) => {
    const http = vi.fn<TakEnrollmentHttp>(() => Promise.resolve({ status, body: '' }));
    await expect(
      enrollTakClientCertificate(
        { host: 'tak.example.org', port: 8446, username: 'u', password: 'p', verifyServer: true },
        http,
      ),
    ).rejects.toThrow(text);
  });
});

describe('enrollment parsing', () => {
  it('reads name entries with or without a namespace prefix', () => {
    expect(parseEnrollmentNameEntries(CONFIG_XML)).toEqual([
      { name: 'O', value: 'TAK' },
      { name: 'OU', value: 'Colorado Mesh' },
    ]);
    expect(parseEnrollmentNameEntries('<x:nameEntry value="v" name="O"/>')).toEqual([
      { name: 'O', value: 'v' },
    ]);
  });

  it('reads JSON responses in CA order and XML responses', () => {
    const client = derBase64(pki.client.cert);
    const ca = derBase64(pki.ca.cert);
    const fromJson = parseEnrollmentResponse(
      JSON.stringify({ ca1: derBase64(pki.server.cert), signedCert: client, ca0: ca }),
    );
    expect(new X509Certificate(fromJson.cert).subject).toContain('CN=atak-user');
    expect(fromJson.caCerts.map((p) => new X509Certificate(p).subject)).toEqual([
      'CN=Test TAK CA',
      'CN=takserver',
    ]);

    const fromXml = parseEnrollmentResponse(
      `<enrollment><signedCert>${client}</signedCert><caCert>${ca}</caCert></enrollment>`,
    );
    expect(new X509Certificate(fromXml.cert).subject).toContain('CN=atak-user');
    expect(fromXml.caCerts).toHaveLength(1);
  });

  it('rejects a response without a certificate', () => {
    expect(() => parseEnrollmentResponse('{"ca0":"x"}')).toThrow(/no certificate/);
  });
});
