import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { LXMF_AUDIO_MODE_OPUS_OGG } from '@/shared/reticulum-voice-memo-types';

/** Persist an inbound LXMF FIELD_AUDIO block under userData (no save dialog). */
export async function cacheReticulumInboundAudio(audio: {
  mode: number;
  data_base64: string;
  size_bytes?: number;
}): Promise<string | null> {
  if (audio.mode !== LXMF_AUDIO_MODE_OPUS_OGG) {
    console.debug(
      `[reticulumAudioAttachmentCache] unknown audio mode ${audio.mode}, skipping cache`,
    );
    return null;
  }
  if (!audio.data_base64) return null;
  try {
    const ts = Date.now();
    const fileName = `voice-memo-${ts}.ogg`;
    const res = await window.electronAPI.chat.saveReticulumAttachment({
      fileName,
      mimeType: 'audio/ogg',
      dataBase64: audio.data_base64,
      promptSave: false,
    });
    return res.success && res.path ? res.path : null;
  } catch (e) {
    console.warn('[reticulumAudioAttachmentCache] cache failed ' + errLikeToLogString(e));
    return null;
  }
}
