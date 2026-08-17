/**
 * Source contract: outbound Direct-link backchannel must be wired so peer replies
 * that arrive on mesh-client-initiated reusable links reach Chat (not only LinkProof Ack).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { extractBalancedBlock } from '../sourceContractTestHelpers';

const REPO_ROOT = join(__dirname, '../../../..');
const LIVE = join(REPO_ROOT, 'reticulum-sidecar/src/stack/live.rs');
const OUTBOUND = join(REPO_ROOT, 'reticulum-sidecar/src/stack/lxmf_outbound.rs');
const DELIVERY = join(REPO_ROOT, 'reticulum-sidecar/src/stack/lxmf_delivery.rs');
const LXMF_LINK = join(REPO_ROOT, '.rsstack/rsLXMF/crates/lxmf-core/src/link_delivery.rs');

describe('reticulum LXMF outbound Direct backchannel contracts', () => {
  it('sidecar outbound driver exposes set_inbound_packet_sender', () => {
    const source = readFileSync(OUTBOUND, 'utf8');
    expect(source).toMatch(/pub fn set_inbound_packet_sender\s*\(/);
    expect(source).toContain('self.link_delivery.set_inbound_packet_sender(tx)');
  });

  it('live stack start installs backchannel near LxmfOutboundDriver::new', () => {
    const source = readFileSync(LIVE, 'utf8');
    expect(source).toContain('LxmfOutboundDriver::new');
    expect(source).toContain('spawn_lxmf_outbound_backchannel');
    expect(source).toMatch(/set_inbound_packet_sender\s*\(\s*spawn_lxmf_outbound_backchannel\s*\(/);
  });

  it('lxmf_delivery spawns outbound-link backchannel consumer into shared unpack path', () => {
    const source = readFileSync(DELIVERY, 'utf8');
    expect(source).toContain('fn spawn_lxmf_outbound_backchannel');
    expect(source).toContain('LXMF outbound-link backchannel packet');
    expect(source).toContain('handle_link_delivered_data');
    expect(source).toContain('OUTBOUND_BACKCHANNEL_CAPACITY');
    expect(source).toMatch(
      /mpsc::channel::<\(Vec<u8>, \[u8; 16\]\)>\(OUTBOUND_BACKCHANNEL_CAPACITY\)/,
    );
  });

  it.skipIf(!existsSync(LXMF_LINK))(
    'sibling LinkDeliveryManager Acks even when inbound_packet_tx is unset',
    () => {
      // Documents Ack-without-payload: LinkProof is staged after decrypt without
      // requiring the sender. Payload is published only after the proof TX succeeds
      // (`PublishInboundPacket`). mesh-client must still wire set_inbound_packet_sender
      // or first Direct replies are dropped.
      const source = readFileSync(LXMF_LINK, 'utf8');
      expect(source).toMatch(/pub fn set_inbound_packet_sender\s*\(/);
      expect(source).toContain('if let Some(ref tx) = self.inbound_packet_tx');
      expect(source).toContain('PacketContext::LinkProof');

      const handlerIdx = source.indexOf('fn handle_inbound_link_packet');
      expect(handlerIdx).toBeGreaterThanOrEqual(0);
      const handlerEnd = source.indexOf('\n    fn ', handlerIdx + 1);
      const handler = source.slice(
        handlerIdx,
        handlerEnd > handlerIdx ? handlerEnd : handlerIdx + 4000,
      );
      expect(handler).toContain('PacketContext::LinkProof');
      expect(handler).toContain('EndpointSendSuccess::PublishInboundPacket');
      expect(handler).not.toContain('inbound_packet_tx');

      const pollIdx = source.indexOf('fn poll_endpoint_send_results');
      expect(pollIdx).toBeGreaterThanOrEqual(0);
      const pollBrace = source.indexOf('{', pollIdx);
      expect(pollBrace).toBeGreaterThan(pollIdx);
      const poll = extractBalancedBlock(source, pollBrace);
      const armIdx = poll.indexOf('EndpointSendSuccess::PublishInboundPacket');
      expect(armIdx).toBeGreaterThanOrEqual(0);
      const armArrow = poll.indexOf('=>', armIdx);
      const armBrace = poll.indexOf('{', armArrow);
      expect(armBrace).toBeGreaterThan(armArrow);
      const arm = extractBalancedBlock(poll, armBrace);
      expect(arm).toContain('inbound_packet_tx');
      expect(arm).toMatch(/tx\.send\(\(plaintext,\s*pending\.link_id\)\)/);
    },
  );
});
