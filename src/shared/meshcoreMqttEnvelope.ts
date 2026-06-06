/** JSON v1 chat envelope for MeshCore MQTT (broker ↔ client). */

export interface MeshcoreMqttChatEnvelopeV1 {
  v: 1;
  text: string;
  channelIdx: number;
  senderName?: string;
  senderNodeId?: number;
  timestamp?: number;
}

export function tryParseMeshcoreMqttChatEnvelope(raw: string): MeshcoreMqttChatEnvelopeV1 | null {
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (o.v !== 1) return null;
    if (typeof o.text !== 'string' || o.text.length > 16000) return null;
    const ch = Number(o.channelIdx);
    if (!Number.isFinite(ch) || ch < 0 || ch > 255) return null;
    return {
      v: 1,
      text: o.text,
      channelIdx: ch,
      senderName: typeof o.senderName === 'string' ? o.senderName.slice(0, 200) : undefined,
      senderNodeId:
        o.senderNodeId != null &&
        Number.isFinite(Number(o.senderNodeId)) &&
        Number(o.senderNodeId) >= 0
          ? Number(o.senderNodeId) >>> 0
          : undefined,
      timestamp:
        o.timestamp != null && Number.isFinite(Number(o.timestamp))
          ? Number(o.timestamp)
          : undefined,
    };
  } catch {
    return null;
  }
}
