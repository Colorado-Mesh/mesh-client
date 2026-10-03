import { createPrivateKey, generateKeyPair, X509Certificate } from 'node:crypto';
import https from 'node:https';
import tls from 'node:tls';
import { promisify } from 'node:util';

import * as forge from 'node-forge';

import { MS_PER_SECOND } from '../../shared/timeConstants';
import { sanitizeLogMessage } from '../log-service';
import { describeTakRemoteError } from './remote-client';
import type { TakRemoteCredentials } from './remote-credentials';
import { tlsConnectHost } from './remote-settings';

/** TAK Server serves certificate enrollment on its own HTTPS port, separate from the CoT stream. */
export const DEFAULT_TAK_ENROLLMENT_PORT = 8446;
const ENROLLMENT_TIMEOUT_MS = 20 * MS_PER_SECOND;
/** The config XML and the signed chain are a few KB. */
const ENROLLMENT_RESPONSE_MAX_BYTES = 256 * 1024;

const generateKeyPairAsync = promisify(generateKeyPair);

export interface TakEnrollmentRequest {
  host: string;
  port: number;
  username: string;
  password: string;
  /** Check the enrollment server's certificate against the system roots and any imported CA. */
  verifyServer: boolean;
  /** CA already imported for this server; trusted alongside the system roots. */
  trustedCa?: string;
}

interface HttpResponse {
  status: number;
  body: string;
}

export type TakEnrollmentHttp = (
  options: https.RequestOptions,
  body?: string,
) => Promise<HttpResponse>;

function httpsRequest(options: https.RequestOptions, body?: string): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > ENROLLMENT_RESPONSE_MAX_BYTES) {
          req.destroy(new Error('The enrollment response is too large'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf-8') });
      });
      res.on('error', reject);
    });
    req.setTimeout(ENROLLMENT_TIMEOUT_MS, () => {
      req.destroy(Object.assign(new Error('connection timed out'), { code: 'ETIMEDOUT' }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

function httpError(status: number): Error {
  if (status === 401 || status === 403) {
    return new Error('The server rejected the username or password');
  }
  if (status === 404) {
    return new Error('This server does not offer certificate enrollment on this port');
  }
  return new Error(`Certificate enrollment failed (HTTP ${status})`);
}

/** O / OU / … entries the server wants in the certificate subject, from `/Marti/api/tls/config`. */
export function parseEnrollmentNameEntries(xml: string): { name: string; value: string }[] {
  const entries: { name: string; value: string }[] = [];
  for (const tag of xml.matchAll(/<[\w:]*nameEntry[^>]*>/g)) {
    const name = /\bname="([^"]*)"/.exec(tag[0])?.[1];
    const value = /\bvalue="([^"]*)"/.exec(tag[0])?.[1];
    if (name && value) entries.push({ name, value });
  }
  return entries;
}

function toPem(base64OrPem: string): string {
  const trimmed = base64OrPem.trim();
  if (trimmed.startsWith('-----BEGIN ')) return new X509Certificate(trimmed).toString();
  return new X509Certificate(Buffer.from(trimmed.replace(/\s+/g, ''), 'base64')).toString();
}

/**
 * Signed client certificate and CA chain from `signClient/v2`. Servers answer JSON
 * (`signedCert`, `ca0`, `ca1`, …) when asked for it; older ones answer XML with `signedCert`
 * and `caCert` elements.
 */
export function parseEnrollmentResponse(body: string): { cert: string; caCerts: string[] } {
  const trimmed = body.trim();
  if (trimmed.startsWith('{')) {
    const json = JSON.parse(trimmed) as Record<string, unknown>;
    const signed = json.signedCert;
    if (typeof signed !== 'string') throw new Error('The enrollment response has no certificate');
    const caCerts = Object.keys(json)
      .filter((k) => /^ca\d+$/.test(k))
      .sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)))
      .map((k) => json[k])
      .filter((v): v is string => typeof v === 'string')
      .map(toPem);
    return { cert: toPem(signed), caCerts };
  }
  // Base64 never contains "<", so each element's text runs to the next tag.
  const signed = /<[\w:]*signedCert>([^<]*)</.exec(trimmed)?.[1];
  if (!signed) throw new Error('The enrollment response has no certificate');
  const caCerts = [...trimmed.matchAll(/<[\w:]*caCert>([^<]*)</g)].map((m) => toPem(m[1] ?? ''));
  return { cert: toPem(signed), caCerts };
}

/**
 * Enroll for a client certificate the way ATAK does: read the subject fields the server wants,
 * generate a key pair here, send a CSR with the username and password, and keep the signed
 * certificate with the server's CA chain. The private key never leaves this process and the
 * password is not stored.
 */
export async function enrollTakClientCertificate(
  request: TakEnrollmentRequest,
  http: TakEnrollmentHttp = httpsRequest,
): Promise<TakRemoteCredentials> {
  const { host, port, username, password, verifyServer, trustedCa } = request;
  const authorization = `Basic ${Buffer.from(`${username}:${password}`, 'utf-8').toString('base64')}`;
  const call = async (
    method: 'GET' | 'POST',
    requestPath: string,
    extraHeaders: Record<string, string> = {},
    body?: string,
  ): Promise<HttpResponse> => {
    const options: https.RequestOptions = {
      host: tlsConnectHost(host),
      port,
      method,
      path: requestPath,
      rejectUnauthorized: verifyServer,
      ...(trustedCa ? { ca: [...tls.rootCertificates, trustedCa] } : {}),
      headers: { Authorization: authorization, ...extraHeaders },
    };
    try {
      return await http(options, body);
    } catch (err) {
      throw new Error(describeTakRemoteError(err as NodeJS.ErrnoException), { cause: err });
    }
  };

  console.debug(
    `[TakEnroll] Enrolling ${sanitizeLogMessage(username)} at ${sanitizeLogMessage(host)}:${port}`,
  );
  const config = await call('GET', '/Marti/api/tls/config');
  if (config.status !== 200) throw httpError(config.status);

  const { privateKey, publicKey } = await generateKeyPairAsync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const csr = forge.pki.createCertificationRequest();
  csr.publicKey = forge.pki.publicKeyFromPem(publicKey);
  csr.setSubject([
    { name: 'commonName', value: username },
    ...parseEnrollmentNameEntries(config.body).map((e) => ({ shortName: e.name, value: e.value })),
  ]);
  csr.sign(forge.pki.privateKeyFromPem(privateKey), forge.md.sha256.create());

  const query = new URLSearchParams({ clientUid: `mesh-client-${username}`, version: '3' });
  const signed = await call(
    'POST',
    `/Marti/api/tls/signClient/v2?${query.toString()}`,
    { Accept: 'application/json', 'Content-Type': 'text/plain' },
    forge.pki.certificationRequestToPem(csr),
  );
  if (signed.status !== 200) throw httpError(signed.status);

  const { cert, caCerts } = parseEnrollmentResponse(signed.body);
  const key = createPrivateKey(privateKey);
  if (!new X509Certificate(cert).checkPrivateKey(key)) {
    throw new Error('The server returned a certificate for a different key');
  }
  console.debug(
    `[TakEnroll] Enrolled ${sanitizeLogMessage(username)}; ${caCerts.length} CA certificate(s)`,
  );
  return {
    ...(caCerts.length > 0 ? { ca: caCerts.join('') } : {}),
    cert,
    key: key.export({ type: 'pkcs8', format: 'pem' }),
  };
}
