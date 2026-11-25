/**
 * Product qualifiers for known RNS announce aspects (Peer details inventory).
 */

const LXMF_DELIVERY_ASPECT = 'lxmf.delivery';
const LXST_TELEPHONY_ASPECT = 'lxst.telephony';
const NOMAD_NODE_ASPECT = 'nomadnetwork.node';
const RRC_HUB_ASPECT = 'rrc.hub';
const LXMF_PROPAGATION_ASPECT = 'lxmf.propagation';

export type ReticulumAnnounceAspectQualifier =
  'chat' | 'voice' | 'nomad' | 'rrc' | 'propagation' | 'unknown';

const KNOWN_ASPECT_QUALIFIERS: ReadonlyMap<string, ReticulumAnnounceAspectQualifier> = new Map([
  [LXMF_DELIVERY_ASPECT, 'chat'],
  [LXST_TELEPHONY_ASPECT, 'voice'],
  [NOMAD_NODE_ASPECT, 'nomad'],
  [RRC_HUB_ASPECT, 'rrc'],
  [LXMF_PROPAGATION_ASPECT, 'propagation'],
]);

/** Map wire aspect → product qualifier (unknown when not in the known table). */
export function reticulumAnnounceAspectQualifier(
  aspect: string | null | undefined,
): ReticulumAnnounceAspectQualifier {
  const key = (aspect ?? '').trim().toLowerCase();
  if (!key || key === 'unknown') return 'unknown';
  return KNOWN_ASPECT_QUALIFIERS.get(key) ?? 'unknown';
}

/**
 * Display label for an aspect. Known aspects use `peerDetailModal.aspect.*`;
 * unknown non-empty aspects show the raw wire string; empty/`unknown` use Unknown.
 */
export function reticulumAnnounceAspectLabel(
  aspect: string | null | undefined,
  t: (key: string) => string,
): string {
  const raw = (aspect ?? '').trim();
  switch (reticulumAnnounceAspectQualifier(raw)) {
    case 'chat':
      return t('peerDetailModal.aspect.chat');
    case 'voice':
      return t('peerDetailModal.aspect.voice');
    case 'nomad':
      return t('peerDetailModal.aspect.nomad');
    case 'rrc':
      return t('peerDetailModal.aspect.rrc');
    case 'propagation':
      return t('peerDetailModal.aspect.propagation');
    case 'unknown':
      if (raw && raw.toLowerCase() !== 'unknown') return raw;
      return t('peerDetailModal.aspect.unknown');
  }
}
