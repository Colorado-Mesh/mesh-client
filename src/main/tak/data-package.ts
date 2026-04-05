import { app, shell } from 'electron';
import fs from 'fs';
import JSZip from 'jszip';
import * as forge from 'node-forge';
import os from 'os';
import path from 'path';

import type { TAKSettings } from '../../shared/tak-types';
import type { CertBundle } from './certificate-manager';

const PKCS12_PASSWORD = 'atakatak';

function getLanIp(): string {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    const iface = ifaces[name];
    if (!iface) continue;
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) {
        return addr.address;
      }
    }
  }
  console.warn('[TAK] No LAN IPv4 found, falling back to 127.0.0.1');
  return '127.0.0.1';
}

function buildManifestXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<MissionPackageManifest version="2">
  <Configuration>
    <Parameter name="uid" value="mesh-client-tak-package"/>
    <Parameter name="name" value="Mesh Client TAK Server"/>
    <Parameter name="onReceiveImport" value="true"/>
    <Parameter name="onReceiveDelete" value="false"/>
  </Configuration>
  <Contents>
    <Content ignore="false" zipEntry="certs/ca.pem"/>
    <Content ignore="false" zipEntry="certs/client.p12"/>
    <Content ignore="false" zipEntry="connection.pref"/>
  </Contents>
</MissionPackageManifest>`;
}

function buildPrefXml(ip: string, port: number): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<preferences>
  <preference version="1" name="cot_streams">
    <entry key="count" class="class java.lang.Integer">1</entry>
    <entry key="description0" class="class java.lang.String">Mesh Client</entry>
    <entry key="enabled0" class="class java.lang.Boolean">true</entry>
    <entry key="connectString0" class="class java.lang.String">${ip}:${port}:ssl</entry>
    <entry key="caLocation0" class="class java.lang.String">cert/ca.pem</entry>
    <entry key="certificateLocation0" class="class java.lang.String">cert/client.p12</entry>
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
  const p12Der = forge.asn1.toDer(p12Asn1).getBytes();
  const p12Buffer = Buffer.from(p12Der, 'binary');

  const zip = new JSZip();
  zip.folder('MANIFEST')!.file('manifest.xml', buildManifestXml());
  zip.folder('certs')!.file('ca.pem', certs.caCert);
  zip.folder('certs')!.file('client.p12', p12Buffer);
  zip.file('connection.pref', buildPrefXml(ip, settings.port));

  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const outputPath = path.join(app.getPath('userData'), 'tak-package.zip');
  fs.writeFileSync(outputPath, buf);

  shell.showItemInFolder(outputPath);
  return outputPath;
}
