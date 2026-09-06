// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { MarkdownViewer } from './MarkdownViewer';

// S11: adversarial browser-execution-path tests. Malicious README content must
// render inert. Assertions target the SECURITY PROPERTY (no executable URI,
// no script elements, no event handlers in output) rather than which of the two
// defense layers (rehype-sanitize schema vs component guards) neutralized it.

function body(container: HTMLElement): HTMLElement {
  const el = container.querySelector('.markdown-body');
  if (!el) throw new Error('markdown-body missing');
  return el as HTMLElement;
}

function dangerousUris(root: ParentNode): Element[] {
  const out: Element[] = [];
  for (const el of Array.from(root.querySelectorAll('a[href], img[src], form[action]'))) {
    const v = (el.getAttribute('href') || el.getAttribute('src') || el.getAttribute('action') || '').trim();
    if (/^(javascript|data|vbscript):/i.test(v)) out.push(el);
  }
  return out;
}

describe('S11 MarkdownViewer XSS', () => {
  it('javascript: links are inert (no executable href)', () => {
    const { container } = render(
      <MarkdownViewer content="[click me](javascript:alert(1)) [x](   JAVASCRIPT:alert(document.cookie))" />
    );
    const b = body(container);
    expect(dangerousUris(b)).toEqual([]);
    // Link text is preserved for readability.
    expect(b.textContent).toContain('click me');
  });

  it('data:/vbscript: links are inert', () => {
    const { container } = render(
      <MarkdownViewer content="[a](data:text/html;base64,PHNjcmlwdD4=) [b](vbscript:msgbox(1))" />
    );
    expect(dangerousUris(body(container))).toEqual([]);
  });

  it('javascript:/data: image sources never reach an img src', () => {
    const { container } = render(
      <MarkdownViewer content="![evil](javascript:alert(1))\n\n![svg](data:image/svg+xml;utf8,<svg onload=alert(1)>)" />
    );
    const b = body(container);
    expect(dangerousUris(b)).toEqual([]);
    for (const img of Array.from(b.querySelectorAll('img'))) {
      expect(img.getAttribute('src') || '').not.toMatch(/^\s*(javascript|data|vbscript):/i);
    }
  });

  it('raw HTML script/svg/media handlers from content render inert', () => {
    const { container } = render(
      <MarkdownViewer content={'<script>alert(1)</script>\n\n<svg onload="alert(1)"></svg>\n\n<img src="x" onerror="alert(1)" />'} />
    );
    const b = body(container);
    expect(b.querySelector('script')).toBeNull();
    // No content-derived svg: the only svg allowed would be none (component icons live outside .markdown-body).
    expect(b.querySelector('svg')).toBeNull();
    expect(b.querySelector('[onerror]')).toBeNull();
    expect(b.querySelector('[onload]')).toBeNull();
    expect(b.querySelector('[onclick]')).toBeNull();
    expect(b.querySelector('[style]')).toBeNull();
  });

  it('event-handler attributes are stripped', () => {
    const { container } = render(<MarkdownViewer content={'<a href="https://example.com" onclick="alert(1)" title="x">y</a>'} />);
    const b = body(container);
    expect(b.querySelector('[onclick]')).toBeNull();
  });

  it('legit https link keeps href with safe rel/target', () => {
    const { container } = render(<MarkdownViewer content="[ok](https://example.com/a)" />);
    const anchor = body(container).querySelector('a[href="https://example.com/a"]');
    expect(anchor).not.toBeNull();
    expect(anchor!.getAttribute('target')).toBe('_blank');
    expect(anchor!.getAttribute('rel')).toContain('noopener');
  });

  it('legit https image renders', () => {
    const { container } = render(<MarkdownViewer content="![logo](https://example.com/logo.png)" />);
    const img = body(container).querySelector('img[src="https://example.com/logo.png"]');
    expect(img).not.toBeNull();
  });

  it('code fences render as text, not elements', () => {
    const { container } = render(<MarkdownViewer content={'```html\n<script>alert(1)</script>\n```'} />);
    const b = body(container);
    expect(b.querySelector('script')).toBeNull();
    expect(b.textContent).toContain('alert(1)');
  });

  it('commit-message-like content with markup renders inert', () => {
    const { container } = render(
      <MarkdownViewer content={'Fixes #1 <img src=x onerror=alert(2)> [pwn](JaVaScRiPt:alert(3))'} />
    );
    const b = body(container);
    expect(dangerousUris(b)).toEqual([]);
    expect(b.querySelector('[onerror]')).toBeNull();
  });
});
