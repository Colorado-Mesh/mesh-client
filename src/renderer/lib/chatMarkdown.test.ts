/** @vitest-environment jsdom */
import { render } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';

import {
  escapeChatHtmlText,
  parseChatMarkdown,
  renderChatMarkdownNodes,
  wrapSelectionWithMarkdown,
} from './chatMarkdown';

describe('parseChatMarkdown', () => {
  it('parses bold italic strike code and safe links', () => {
    const nodes = parseChatMarkdown('**b** *i* ~~s~~ `c` [hi](https://example.com)');
    expect(nodes.map((n) => n.type)).toEqual([
      'bold',
      'text',
      'italic',
      'text',
      'strike',
      'text',
      'code',
      'text',
      'link',
    ]);
  });

  it('does not interpret raw HTML as markup', () => {
    const nodes = parseChatMarkdown('<img src=x onerror=alert(1)> **ok**');
    expect(nodes[0]).toEqual({ type: 'text', value: '<img src=x onerror=alert(1)> ' });
    expect(nodes[1].type).toBe('bold');
  });

  it('rejects javascript: and other unsafe link schemes', () => {
    const nodes = parseChatMarkdown('[x](javascript:alert(1))');
    expect(nodes.every((n) => n.type === 'text')).toBe(true);
  });
});

describe('renderChatMarkdownNodes XSS', () => {
  it('never creates an img or script element from HTML-looking text', () => {
    const nodes = parseChatMarkdown('<script>alert(1)</script><img src=x onerror=alert(1)>');
    const { container } = render(createElement('div', null, renderChatMarkdownNodes(nodes)));
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<script>alert(1)</script>');
    expect(container.querySelector('[onerror]')).toBeNull();
    expect(container.innerHTML).toContain('onerror=alert(1)'); // escaped text only
  });

  it('renders only safe https anchors', () => {
    const nodes = parseChatMarkdown('[ok](https://example.com) [bad](javascript:alert(1))');
    const { container } = render(createElement('div', null, renderChatMarkdownNodes(nodes)));
    const anchors = Array.from(container.querySelectorAll('a'));
    expect(anchors).toHaveLength(1);
    const [anchor] = anchors;
    expect(anchor.getAttribute('href')).toBe('https://example.com');
    expect(anchor.getAttribute('rel')).toContain('noopener');
  });
});

describe('escapeChatHtmlText', () => {
  it('escapes angle brackets and quotes', () => {
    expect(escapeChatHtmlText('<b>&"\'')).toBe('&lt;b&gt;&amp;&quot;&#39;');
  });
});

describe('wrapSelectionWithMarkdown', () => {
  it('wraps a selection and places caret for empty selection', () => {
    expect(wrapSelectionWithMarkdown('hello', 0, 5, '**')).toEqual({
      next: '**hello**',
      selectionStart: 0,
      selectionEnd: 9,
    });
    expect(wrapSelectionWithMarkdown('ab', 1, 1, '**')).toEqual({
      next: 'a****b',
      selectionStart: 3,
      selectionEnd: 3,
    });
  });
});
