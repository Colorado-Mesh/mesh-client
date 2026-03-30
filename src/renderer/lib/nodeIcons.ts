export const NODE_BADGE_PATHS: Record<string, string> = {
  repeater:
    'M1 9l2 2c4.97-4.97 13.03-4.97 18 0l2-2C16.93 2.93 7.08 2.93 1 9zm8 8l3 3 3-3c-1.65-1.66-4.34-1.66-6 0zm-4-4l2 2c2.76-2.76 7.24-2.76 10 0l2-2C15.14 9.14 8.87 9.14 5 13z',
  room: 'M8,2H16A2,2 0 0,1 18,4V20A2,2 0 0,1 16,22H8A2,2 0 0,1 6,20V4A2,2 0 0,1 8,2M14,11A1,1 0 0,0 13,12A1,1 0 0,0 14,13A1,1 0 0,0 15,12A1,1 0 0,0 14,11Z',
  sensor:
    'M6.18,15.64A2.18,2.18 0 0,1 8.36,17.82C8.36,19 7.38,20 6.18,20C4.98,20 4,19 4,17.82A2.18,2.18 0 0,1 6.18,15.64M4,4.44A15.56,15.56 0 0,1 19.56,20H17.73A13.73,13.73 0 0,0 4,6.27V4.44M4,10.1A9.9,9.9 0 0,1 13.9,20H12.07A8.07,8.07 0 0,0 4,11.93V10.1Z',
  home: 'M12 3L2 12h3v8h14v-8h3L12 3zm0 2.5L17 10v8h-2v-5H9v5H7v-8l5-4.5z',
  clock:
    'M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M16.2,16.2L11,13V7H12.5V12.3L17,14.9L16.2,16.2Z',
};

export function getNodeTypeIcon(hwModel: string): string | null {
  if (hwModel === 'Repeater') return NODE_BADGE_PATHS.repeater;
  if (hwModel === 'Room') return NODE_BADGE_PATHS.room;
  if (hwModel === 'Sensor') return NODE_BADGE_PATHS.sensor;
  return null;
}
