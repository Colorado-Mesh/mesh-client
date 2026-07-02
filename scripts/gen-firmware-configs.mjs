#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const ROM = {
  PLATFORM_AVR: 0x90,
  PLATFORM_ESP32: 0x80,
  PLATFORM_NRF52: 0x70,
  PRODUCT_RAK4631: 0x10,
  MODEL_11: 0x11,
  MODEL_12: 0x12,
  PRODUCT_RNODE: 0x03,
  MODEL_A1: 0xa1,
  MODEL_A6: 0xa6,
  MODEL_A4: 0xa4,
  MODEL_A9: 0xa9,
  MODEL_A3: 0xa3,
  MODEL_A8: 0xa8,
  MODEL_A2: 0xa2,
  MODEL_A7: 0xa7,
  MODEL_A5: 0xa5,
  MODEL_AA: 0xaa,
  MODEL_AC: 0xac,
  PRODUCT_T32_10: 0xb2,
  MODEL_BA: 0xba,
  MODEL_BB: 0xbb,
  PRODUCT_T32_20: 0xb0,
  MODEL_B3: 0xb3,
  MODEL_B8: 0xb8,
  PRODUCT_T32_21: 0xb1,
  MODEL_B4: 0xb4,
  MODEL_B9: 0xb9,
  MODEL_B4_TCXO: 0x04,
  MODEL_B9_TCXO: 0x09,
  PRODUCT_H32_V2: 0xc0,
  MODEL_C4: 0xc4,
  MODEL_C9: 0xc9,
  PRODUCT_H32_V3: 0xc1,
  MODEL_C5: 0xc5,
  MODEL_CA: 0xca,
  PRODUCT_H32_V4: 0xc3,
  MODEL_C8: 0xc8,
  PRODUCT_HELTEC_T114: 0xc2,
  MODEL_C6: 0xc6,
  MODEL_C7: 0xc7,
  PRODUCT_TBEAM: 0xe0,
  MODEL_E4: 0xe4,
  MODEL_E9: 0xe9,
  MODEL_E3: 0xe3,
  MODEL_E8: 0xe8,
  PRODUCT_TBEAM_S_V1: 0xea,
  MODEL_DB: 0xdb,
  MODEL_DC: 0xdc,
  PRODUCT_TDECK: 0xd0,
  MODEL_D4: 0xd4,
  MODEL_D9: 0xd9,
  PRODUCT_TECHO: 0x15,
  MODEL_16: 0x16,
  MODEL_17: 0x17,
};

const htmlPath = process.argv[2] ?? '/tmp/rnode-flasher-index.html';
const html = fs.readFileSync(htmlPath, 'utf8');
const start = html.indexOf('products: [');
const end = html.indexOf("// Liam's default config");
const productsSrc = html
  .slice(start + 'products: '.length, end)
  .trim()
  .replace(/,\s*$/, '');
const products = new Function('ROM', `return (${productsSrc});`)(ROM);

function fmtValue(v, indent) {
  if (v === null || v === undefined) return 'undefined';
  if (typeof v === 'number') return `0x${v.toString(16).toUpperCase().padStart(2, '0')}`;
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    return `[\n${v.map((item) => `${indent}  ${fmtValue(item, indent + '  ')}`).join(',\n')}\n${indent}]`;
  }
  if (typeof v === 'object') {
    const entries = Object.entries(v).filter(([, val]) => val !== undefined);
    if (entries.length === 0) return '{}';
    return `{\n${entries
      .map(([k, val]) => {
        const key =
          k === 'flash_files'
            ? k
            : /^\d+$/.test(k) || /^0x[0-9a-f]+$/i.test(k)
              ? JSON.stringify(k.startsWith('0x') ? k : `0x${Number(k).toString(16)}`)
              : k;
        if (k === 'flash_files' && typeof val === 'object' && val !== null) {
          const fileEntries = Object.entries(val)
            .map(
              ([addr, fname]) =>
                `      ${JSON.stringify(addr.startsWith('0x') ? addr : `0x${parseInt(addr, 10).toString(16)}`)}: ${JSON.stringify(fname)}`,
            )
            .join(',\n');
          return `${indent}  flash_files: {\n${fileEntries}\n${indent}  }`;
        }
        return `${indent}  ${key}: ${fmtValue(val, indent + '  ')}`;
      })
      .join(',\n')}\n${indent}}`;
  }
  return String(v);
}

const body = products.map((p) => fmtValue(p, '  ')).join(',\n');

const out = `/** Ported from liamcottle/rnode-flasher index.html product catalog. */
import type { RNodeProduct } from './types';

export const FIRMWARE_PRODUCTS: RNodeProduct[] = [
${body},
];
`;

const dest = path.join(ROOT, 'src/renderer/lib/flasher/firmwareConfigs.ts');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, out);
console.log(`Wrote ${products.length} products to ${dest}`);
