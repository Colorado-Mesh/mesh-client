import { app, shell } from 'electron';
import fs from 'fs';
import JSZip from 'jszip';
import * as forge from 'node-forge';
import path from 'path';

import type { TAKSettings } from '../../shared/tak-types';
import { sanitizeLogMessage } from '../sanitize-log-message';
import type { CertBundle } from './certificate-manager';
import { getLanIp } from './lan-ip';

const PKCS12_PASSWORD = 'atakatak';
/** Alias ATAK shows for the CA entry inside the truststore. */
const TRUSTSTORE_FRIENDLY_NAME = 'mesh-client-ca';
const TRUSTSTORE_FILE = 'truststore.p12';
const CLIENT_CERT_FILE = 'client.p12';

function toP12Buffer(p12Asn1: forge.asn1.Asn1): Buffer {
  return Buffer.from(forge.asn1.toDer(p12Asn1).getBytes(), 'binary');
}

/**
 * ATAK, iTAK and WinTAK load `caLocation` as a password-protected PKCS#12 truststore.
 * A PEM CA fails to parse there, leaves the truststore empty, and the EUD rejects the
 * server certificate ("remote host's certificate not trusted; check truststore").
 * Android's PKCS#12 provider only exposes a keyless certificate as a trusted entry when it
 * carries a friendlyName alias; the password protects the SHA-1 MAC.
 */
function buildTruststoreP12(caCert: forge.pki.Certificate): Buffer {
  return toP12Buffer(
    forge.pkcs12.toPkcs12Asn1(null, [caCert], PKCS12_PASSWORD, {
      friendlyName: TRUSTSTORE_FRIENDLY_NAME,
    }),
  );
}

function buildManifestXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<MissionPackageManifest version="2">
  <Configuration>
    <Parameter name="uid" value="mesh-client-tak-package"/>
    <Parameter name="name" value="Mesh Hub TAK Server"/>
    <Parameter name="onReceiveImport" value="true"/>
    <Parameter name="onReceiveDelete" value="false"/>
  </Configuration>
  <Contents>
    <Content ignore="false" zipEntry="certs/${TRUSTSTORE_FILE}"/>
    <Content ignore="false" zipEntry="certs/${CLIENT_CERT_FILE}"/>
    <Content ignore="false" zipEntry="connection.pref"/>
  </Contents>
</MissionPackageManifest>`;
}

function buildPrefXml(ip: string, port: number): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<preferences>
  <preference version="1" name="cot_streams">
    <entry key="count" class="class java.lang.Integer">1</entry>
    <entry key="description0" class="class java.lang.String">Mesh Hub</entry>
    <entry key="enabled0" class="class java.lang.Boolean">true</entry>
    <entry key="connectString0" class="class java.lang.String">${ip}:${port}:ssl</entry>
    <entry key="caLocation0" class="class java.lang.String">cert/${TRUSTSTORE_FILE}</entry>
    <entry key="certificateLocation0" class="class java.lang.String">cert/${CLIENT_CERT_FILE}</entry>
    <entry key="clientPassword0" class="class java.lang.String">${PKCS12_PASSWORD}</entry>
    <entry key="caPassword0" class="class java.lang.String">${PKCS12_PASSWORD}</entry>
  </preference>
</preferences>`;
}

export async function generateDataPackage(
  certs: CertBundle,
  settings: TAKSettings,
): Promise<string> {
  const ip = getLanIp();

  // Build PKCS12 client bundle
  const clientCert = forge.pki.certificateFromPem(certs.clientCert);
  const clientKey = forge.pki.privateKeyFromPem(certs.clientKey);
  const caCert = forge.pki.certificateFromPem(certs.caCert);

  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(clientKey, [clientCert, caCert], PKCS12_PASSWORD, {
    algorithm: '3des',
  });
  const p12Buffer = toP12Buffer(p12Asn1);
  const truststoreBuffer = buildTruststoreP12(caCert);

  const zip = new JSZip();
  zip.folder('MANIFEST')!.file('manifest.xml', buildManifestXml());
  zip.folder('certs')!.file(TRUSTSTORE_FILE, truststoreBuffer);
  zip.folder('certs')!.file(CLIENT_CERT_FILE, p12Buffer);
  zip.file('connection.pref', buildPrefXml(ip, settings.port));

  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const outputPath = path.join(app.getPath('userData'), 'tak-package.zip');
  const tmpPath = outputPath + '.tmp';
  try {
    fs.writeFileSync(tmpPath, buf);
    fs.renameSync(tmpPath, outputPath);
  } catch (e) {
    try {
      fs.rmSync(tmpPath, { force: true });
    } catch {
      // catch-no-log-ok best-effort cleanup
    }
    throw new Error(
      `Failed to write TAK data package: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  try {
    shell.showItemInFolder(outputPath);
  } catch (e) {
    console.warn(
      '[TAK] show data package in folder failed:',
      sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
    );
  }
  return outputPath;
}
