import { create, toBinary } from '@bufbuild/protobuf';
import { Mesh as MeshPb } from '@meshtastic/protobufs';

/** Minimal FromRadio shape for mqtt_client_proxy_message parsing. */
export interface FromRadioMqttProxyCarrier {
  payloadVariant?: {
    case?: string;
    value?: {
      topic?: string;
      retained?: boolean;
      payloadVariant?: { case?: string; value?: Uint8Array | string };
    };
  };
}

export interface MqttClientProxyWire {
  topic: string;
  retained: boolean;
  payloadVariant: { case: 'data'; value: Uint8Array } | { case: 'text'; value: string };
}

export interface MeshtasticMqttClientProxyDeps {
  isProxyActive: () => boolean;
  isDeviceConfigured: () => boolean;
  publishToBroker: (args: {
    topic: string;
    data?: Uint8Array;
    text?: string;
    retained: boolean;
  }) => Promise<void>;
  writeToRadio: (bytes: Uint8Array) => Promise<void>;
}

/** Parse FromRadio mqtt_client_proxy_message for device → broker publish. */
export function parseMqttClientProxyFromFromRadio(
  fromRadio: FromRadioMqttProxyCarrier,
): MqttClientProxyWire | null {
  const variant = fromRadio.payloadVariant;
  if (variant?.case !== 'mqttClientProxyMessage') return null;
  const proxy = variant.value;
  if (!proxy) return null;
  const pv = proxy.payloadVariant;
  if (pv?.case === 'data') {
    return {
      topic: proxy.topic ?? '',
      retained: proxy.retained ?? false,
      payloadVariant: { case: 'data', value: pv.value as Uint8Array },
    };
  }
  if (pv?.case === 'text') {
    return {
      topic: proxy.topic ?? '',
      retained: proxy.retained ?? false,
      payloadVariant: { case: 'text', value: pv.value as string },
    };
  }
  return null;
}

/** Encode ToRadio.mqtt_client_proxy_message (broker → device downlink). */
export function buildToRadioMqttClientProxyBytes(msg: MqttClientProxyWire): Uint8Array {
  const proxyMsg = create(MeshPb.MqttClientProxyMessageSchema, {
    topic: msg.topic,
    retained: msg.retained,
    payloadVariant: msg.payloadVariant,
  });
  const toRadio = create(MeshPb.ToRadioSchema, {
    payloadVariant: { case: 'mqttClientProxyMessage', value: proxyMsg },
  });
  return toBinary(MeshPb.ToRadioSchema, toRadio);
}

/**
 * Bridges Meshtastic firmware MQTT proxy (PhoneAPI §14) between radio and mqtt-manager.
 * Failure point: broker publish or ToRadio write — logs via deps; buffers ToRadio until configured.
 */
export class MeshtasticMqttClientProxyBridge {
  private pendingToDevice: Uint8Array[] = [];

  constructor(private readonly deps: MeshtasticMqttClientProxyDeps) {}

  /** Flush buffered downlink after configComplete / DeviceConfigured. */
  flushPendingToDevice(): void {
    if (!this.deps.isDeviceConfigured()) return;
    const pending = [...this.pendingToDevice];
    this.pendingToDevice = [];
    for (const bytes of pending) {
      void this.deps.writeToRadio(bytes).catch((e: unknown) => {
        console.warn(
          '[MeshtasticMqttClientProxyBridge] flush writeToRadio failed ' +
            (e instanceof Error ? e.message : String(e)),
        );
      });
    }
  }

  clearPending(): void {
    this.pendingToDevice = [];
  }

  async handleFromRadio(fromRadio: FromRadioMqttProxyCarrier): Promise<void> {
    const proxy = parseMqttClientProxyFromFromRadio(fromRadio);
    if (!proxy || !this.deps.isProxyActive()) return;

    try {
      if (proxy.payloadVariant.case === 'data') {
        await this.deps.publishToBroker({
          topic: proxy.topic,
          data: proxy.payloadVariant.value,
          retained: proxy.retained,
        });
        return;
      }
      await this.deps.publishToBroker({
        topic: proxy.topic,
        text: proxy.payloadVariant.value,
        retained: proxy.retained,
      });
    } catch (e: unknown) {
      console.warn(
        '[MeshtasticMqttClientProxyBridge] publishToBroker failed ' +
          (e instanceof Error ? e.message : String(e)),
      );
    }
  }

  async handleBrokerRaw(topic: string, payload: Uint8Array, retained: boolean): Promise<void> {
    if (!this.deps.isProxyActive()) return;

    const bytes = buildToRadioMqttClientProxyBytes({
      topic,
      retained,
      payloadVariant: { case: 'data', value: payload },
    });

    if (!this.deps.isDeviceConfigured()) {
      this.pendingToDevice.push(bytes);
      return;
    }
    await this.deps.writeToRadio(bytes);
  }
}
