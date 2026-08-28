/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';

import { renderNomadMicronPage } from '@/renderer/lib/nomad/micronParser';
import {
  applyMicronDivider,
  applyMicronLinePrefix,
  applyMicronLink,
  applyMicronWrap,
} from '@/renderer/lib/nomad/micronToolbar';

describe('micronToolbar', () => {
  describe('applyMicronWrap', () => {
    it('wraps the selection and keeps it selected', () => {
      const res = applyMicronWrap({ content: 'hello world', start: 6, end: 11 }, 'bold');
      expect(res.content).toBe('hello `!world`!');
      expect(res.content.slice(res.selectionStart, res.selectionEnd)).toBe('world');
    });

    it('places the caret between markers when nothing is selected', () => {
      const res = applyMicronWrap({ content: 'ab', start: 1, end: 1 }, 'italic');
      expect(res.content).toBe('a`*`*b');
      expect(res.selectionStart).toBe(3);
      expect(res.selectionEnd).toBe(3);
    });

    it('uses the underline marker', () => {
      const res = applyMicronWrap({ content: 'x', start: 0, end: 1 }, 'underline');
      expect(res.content).toBe('`_x`_');
    });

    it('normalizes a backwards selection', () => {
      const res = applyMicronWrap({ content: 'hello', start: 5, end: 0 }, 'bold');
      expect(res.content).toBe('`!hello`!');
    });
  });

  describe('applyMicronLinePrefix', () => {
    it('adds a heading prefix to the caret line', () => {
      const res = applyMicronLinePrefix({ content: 'one\ntwo', start: 5, end: 5 }, 'h2');
      expect(res.content).toBe('one\n>>two');
    });

    it('removes the prefix when re-applied', () => {
      const res = applyMicronLinePrefix({ content: '>>two', start: 3, end: 3 }, 'h2');
      expect(res.content).toBe('two');
    });

    it('replaces rather than stacks a heading of a different level', () => {
      const res = applyMicronLinePrefix({ content: '>two', start: 2, end: 2 }, 'h3');
      expect(res.content).toBe('>>>two');
    });

    it('replaces an existing alignment prefix', () => {
      const res = applyMicronLinePrefix({ content: '`lhi', start: 3, end: 3 }, 'alignCenter');
      expect(res.content).toBe('`chi');
    });

    it('does not confuse alignment and heading families', () => {
      const res = applyMicronLinePrefix({ content: '>title', start: 3, end: 3 }, 'alignRight');
      expect(res.content).toBe('`r>title');
    });
  });

  describe('applyMicronDivider', () => {
    it('inserts a divider on its own line', () => {
      const res = applyMicronDivider({ content: 'above', start: 5, end: 5 });
      expect(res.content).toBe('above\n-\n');
    });

    it('does not add a blank line when already at a line start', () => {
      const res = applyMicronDivider({ content: 'above\n', start: 6, end: 6 });
      expect(res.content).toBe('above\n-\n');
    });
  });

  describe('applyMicronLink', () => {
    it('uses the selection as the link label', () => {
      const res = applyMicronLink({ content: 'see docs', start: 4, end: 8 }, '/page/docs.mu');
      expect(res.content).toBe('see `[docs`/page/docs.mu]');
    });

    it('falls back to a placeholder label with no selection', () => {
      const res = applyMicronLink({ content: '', start: 0, end: 0 }, 'abc');
      expect(res.content).toBe('`[link`abc]');
    });

    it('prefers an explicit label over the selection', () => {
      const res = applyMicronLink({ content: 'xx', start: 0, end: 2 }, 'abc', 'Docs');
      expect(res.content).toBe('`[Docs`abc]');
    });
  });

  // The toolbar is only useful if the parser actually understands what it emits.
  it('emits markup the vendored parser renders as formatted output', () => {
    const bold = applyMicronWrap({ content: 'loud', start: 0, end: 4 }, 'bold').content;
    expect(renderNomadMicronPage(bold)).toContain('loud');
    expect(renderNomadMicronPage(bold)).toMatch(/bold|font-weight/i);

    const heading = applyMicronLinePrefix({ content: 'Title', start: 0, end: 0 }, 'h1').content;
    expect(renderNomadMicronPage(heading)).toContain('Title');

    const link = applyMicronLink({ content: '', start: 0, end: 0 }, '/page/x.mu', 'Go').content;
    const html = renderNomadMicronPage(link);
    expect(html).toContain('Go');
    expect(html).toContain('/page/x.mu');
  });
});
