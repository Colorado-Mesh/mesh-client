/**
 * Sanitized chat markdown subset: bold / italic / strike / inline code / links.
 * No raw HTML — angle brackets and unknown constructs stay as text nodes.
 */
import type { ReactNode } from 'react';
import { createElement, Fragment } from 'react';

import { isSafeChatUrl } from './chatMentionSegments';

export type ChatMarkdownNode =
  | { type: 'text'; value: string }
  | { type: 'bold'; children: ChatMarkdownNode[] }
  | { type: 'italic'; children: ChatMarkdownNode[] }
  | { type: 'strike'; children: ChatMarkdownNode[] }
  | { type: 'code'; value: string }
  | { type: 'link'; href: string; children: ChatMarkdownNode[] };

const ESCAPE_HTML_RE = /[&<>"']/g;
const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escape characters that could form HTML if ever concatenated into markup. */
export function escapeChatHtmlText(text: string): string {
  return text.replace(ESCAPE_HTML_RE, (ch) => ESCAPE_MAP[ch] ?? ch);
}

/**
 * Parse a restricted markdown subset. Raw HTML tags are treated as plain text
 * (never interpreted as DOM).
 */
export function parseChatMarkdown(input: string): ChatMarkdownNode[] {
  return parseInline(input);
}

function parseInline(input: string): ChatMarkdownNode[] {
  const nodes: ChatMarkdownNode[] = [];
  let i = 0;
  let textBuf = '';

  const flushText = () => {
    if (!textBuf) return;
    nodes.push({ type: 'text', value: textBuf });
    textBuf = '';
  };

  while (i < input.length) {
    if (input[i] === '`') {
      const end = input.indexOf('`', i + 1);
      if (end !== -1) {
        flushText();
        nodes.push({ type: 'code', value: input.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    if (input[i] === '[') {
      const labelEnd = input.indexOf(']', i + 1);
      if (labelEnd !== -1 && input[labelEnd + 1] === '(') {
        const urlEnd = input.indexOf(')', labelEnd + 2);
        if (urlEnd !== -1) {
          const label = input.slice(i + 1, labelEnd);
          const href = input.slice(labelEnd + 2, urlEnd).trim();
          if (isSafeChatUrl(href)) {
            flushText();
            nodes.push({ type: 'link', href, children: parseInline(label) });
            i = urlEnd + 1;
            continue;
          }
        }
      }
    }

    if ((input.startsWith('**', i) || input.startsWith('__', i)) && input.length > i + 2) {
      const marker = input.slice(i, i + 2);
      const end = input.indexOf(marker, i + 2);
      if (end !== -1) {
        flushText();
        nodes.push({ type: 'bold', children: parseInline(input.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }

    if (input.startsWith('~~', i) && input.length > i + 2) {
      const end = input.indexOf('~~', i + 2);
      if (end !== -1) {
        flushText();
        nodes.push({ type: 'strike', children: parseInline(input.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }

    if (
      (input[i] === '*' || input[i] === '_') &&
      input[i + 1] !== input[i] &&
      input.length > i + 1
    ) {
      const marker = input[i];
      const end = input.indexOf(marker, i + 1);
      if (end !== -1 && input[end + 1] !== marker) {
        flushText();
        nodes.push({ type: 'italic', children: parseInline(input.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }

    textBuf += input[i];
    i += 1;
  }

  flushText();
  return nodes;
}

export type ChatMarkdownTextRenderer = (text: string, key: string) => ReactNode;

/** Render parsed markdown to React nodes (text is never injected as HTML). */
export function renderChatMarkdownNodes(
  nodes: ChatMarkdownNode[],
  keyPrefix = 'md',
  renderText?: ChatMarkdownTextRenderer,
): ReactNode {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}-${index}`;
    switch (node.type) {
      case 'text':
        return createElement(
          Fragment,
          { key },
          renderText ? renderText(node.value, key) : node.value,
        );
      case 'bold':
        return createElement(
          'strong',
          { key },
          renderChatMarkdownNodes(node.children, key, renderText),
        );
      case 'italic':
        return createElement(
          'em',
          { key },
          renderChatMarkdownNodes(node.children, key, renderText),
        );
      case 'strike':
        return createElement('s', { key }, renderChatMarkdownNodes(node.children, key, renderText));
      case 'code':
        return createElement(
          'code',
          { key, className: 'bg-ink-800 rounded px-1 font-mono text-[0.9em]' },
          renderText ? renderText(node.value, key) : node.value,
        );
      case 'link':
        return createElement(
          'a',
          {
            key,
            href: node.href,
            target: '_blank',
            rel: 'noopener noreferrer',
            className: 'text-bright-green underline',
          },
          renderChatMarkdownNodes(node.children, key, renderText),
        );
      default: {
        const _exhaustive: never = node;
        return _exhaustive;
      }
    }
  });
}

/** Wrap the current selection (or caret) in markdown markers inside a composer value. */
export function wrapSelectionWithMarkdown(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  before: string,
  after: string = before,
): { next: string; selectionStart: number; selectionEnd: number } {
  const start = Math.max(0, Math.min(selectionStart, value.length));
  const end = Math.max(start, Math.min(selectionEnd, value.length));
  const selected = value.slice(start, end);
  const next = value.slice(0, start) + before + selected + after + value.slice(end);
  if (selected.length === 0) {
    const caret = start + before.length;
    return { next, selectionStart: caret, selectionEnd: caret };
  }
  return {
    next,
    selectionStart: start,
    selectionEnd: start + before.length + selected.length + after.length,
  };
}
