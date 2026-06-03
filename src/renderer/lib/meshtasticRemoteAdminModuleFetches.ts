import { Admin } from '@meshtastic/protobufs';

/** Sequential module config reads during remote admin snapshot (single source of truth for fetch count). */
export const REMOTE_ADMIN_MODULE_CONFIG_FETCHES: {
  type: (typeof Admin.AdminMessage_ModuleConfigType)[keyof typeof Admin.AdminMessage_ModuleConfigType];
  key: string;
}[] = [
  { type: Admin.AdminMessage_ModuleConfigType.MQTT_CONFIG, key: 'mqtt' },
  { type: Admin.AdminMessage_ModuleConfigType.SERIAL_CONFIG, key: 'serial' },
  { type: Admin.AdminMessage_ModuleConfigType.EXTNOTIF_CONFIG, key: 'externalNotification' },
  { type: Admin.AdminMessage_ModuleConfigType.STOREFORWARD_CONFIG, key: 'storeForward' },
  { type: Admin.AdminMessage_ModuleConfigType.RANGETEST_CONFIG, key: 'rangeTest' },
  { type: Admin.AdminMessage_ModuleConfigType.TELEMETRY_CONFIG, key: 'telemetry' },
  { type: Admin.AdminMessage_ModuleConfigType.CANNEDMSG_CONFIG, key: 'cannedMessage' },
  { type: Admin.AdminMessage_ModuleConfigType.REMOTEHARDWARE_CONFIG, key: 'remoteHardware' },
  { type: Admin.AdminMessage_ModuleConfigType.NEIGHBORINFO_CONFIG, key: 'neighborInfo' },
  { type: Admin.AdminMessage_ModuleConfigType.AMBIENTLIGHTING_CONFIG, key: 'ambientLighting' },
  { type: Admin.AdminMessage_ModuleConfigType.DETECTIONSENSOR_CONFIG, key: 'detectionSensor' },
  { type: Admin.AdminMessage_ModuleConfigType.PAXCOUNTER_CONFIG, key: 'paxcounter' },
  {
    type: Admin.AdminMessage_ModuleConfigType.TRAFFICMANAGEMENT_CONFIG,
    key: 'trafficManagement',
  },
  { type: Admin.AdminMessage_ModuleConfigType.TAK_CONFIG, key: 'tak' },
];

export const REMOTE_ADMIN_MODULE_CONFIG_FETCH_COUNT = REMOTE_ADMIN_MODULE_CONFIG_FETCHES.length;
