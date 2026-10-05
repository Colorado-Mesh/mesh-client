/**
 * Mesh-Mapper (colonelpanichacks/drone-mesh-mapper) Remote ID detections relayed over a
 * mesh text channel. The ESP32 firmware prints:
 *   `Drone: <MAC> RSSI:<n>[ https://maps.google.com/?q=<lat>,<lon>]`
 *   `Pilot: https://maps.google.com/?q=<lat>,<lon>`  (forks: `http://maps.apple.com/?ll=…&q=Pilot`)
 * The two lines may arrive in one message or as separate messages.
 */

import { parseAppleMapsLlCoords, parseGoogleMapsQueryCoords } from './chatLocationUtils';

export interface DroneReportCoords {
  lat: number;
  lon: number;
}

export interface ParsedDroneReport {
  mac?: string;
  rssi?: number;
  drone?: DroneReportCoords;
  pilot?: DroneReportCoords;
}

const PILOT_LINE = /^Pilot: (\S+)$/i;

function isMacAddress(value: string): boolean {
  const octets = value.split(':');
  return octets.length === 6 && octets.every((o) => /^[0-9a-f]{2}$/i.test(o));
}

/** `Drone: <MAC> RSSI:<n>[ <map url>]` → parts, or null. */
function parseDroneLine(line: string): { mac: string; rssi: number; url?: string } | null {
  const tokens = line.split(/\s+/);
  if (tokens.length < 3 || tokens.length > 4) return null;
  const [label, mac, rssiToken, url] = tokens;
  if (label.toLowerCase() !== 'drone:' || !isMacAddress(mac)) return null;
  const rssiMatch = /^RSSI:(-?\d{1,3})$/i.exec(rssiToken);
  if (!rssiMatch) return null;
  return { mac: mac.toUpperCase(), rssi: Number.parseInt(rssiMatch[1], 10), url };
}

function parseMapLink(url: string): DroneReportCoords | null {
  return parseGoogleMapsQueryCoords(url) ?? parseAppleMapsLlCoords(url);
}

/** Short drone-to-pilot distance in the user's unit (feet/miles or meters/km). */
export function formatDroneDistance(km: number, unit: 'miles' | 'km', locale?: string): string {
  const fmt = (value: number, unitName: string, digits: number) =>
    new Intl.NumberFormat(locale, {
      style: 'unit',
      unit: unitName,
      unitDisplay: 'short',
      maximumFractionDigits: digits,
    }).format(value);
  if (unit === 'km') {
    return km < 1 ? fmt(Math.round(km * 1000), 'meter', 0) : fmt(km, 'kilometer', 1);
  }
  const miles = km * 0.621371;
  return miles < 0.2 ? fmt(Math.round(miles * 5280), 'foot', 0) : fmt(miles, 'mile', 1);
}

/** Parse a Mesh-Mapper drone/pilot message; null when any line is not in that format. */
export function parseDroneReport(text: string): ParsedDroneReport | null {
  if (!text || text.length > 512) return null;
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0 || lines.length > 2) return null;

  const report: ParsedDroneReport = {};
  let sawDrone = false;
  let sawPilot = false;
  for (const line of lines) {
    const drone = sawDrone ? null : parseDroneLine(line);
    if (drone) {
      sawDrone = true;
      report.mac = drone.mac;
      report.rssi = drone.rssi;
      if (drone.url) {
        const coords = parseMapLink(drone.url);
        if (!coords) return null;
        report.drone = coords;
      }
      continue;
    }
    const pilot = PILOT_LINE.exec(line);
    if (pilot && !sawPilot) {
      const coords = parseMapLink(pilot[1]);
      if (!coords) return null;
      sawPilot = true;
      report.pilot = coords;
      continue;
    }
    return null;
  }
  return report;
}
