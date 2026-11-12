type Attrs = Record<string, string | number | boolean | ((e: Event) => void) | undefined>;

/** Tiny DOM builder. Text is always set via textContent: no HTML injection possible. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, children: (Node | string | null | undefined)[] = []): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, '').toLowerCase(), v);
    else if (k === 'class') el.className = String(v);
    else if (k === 'text') el.textContent = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

/** Inline SVG from a trusted, hard-coded markup string (never user data). */
export function svg(markup: string): SVGSVGElement {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstElementChild as SVGSVGElement;
}

export const MARK_SVG =
  '<svg class="brand-mark" viewBox="0 0 64 64" aria-hidden="true"><rect x="2" y="2" width="60" height="60" rx="17" fill="#A5FA00"/><g fill="#131312" transform="translate(32 32)"><path d="M-5-25h10l-3 14h-10z"/><path d="M-5-25h10l-3 14h-10z" transform="rotate(90)"/><path d="M-5-25h10l-3 14h-10z" transform="rotate(180)"/><path d="M-5-25h10l-3 14h-10z" transform="rotate(270)"/><circle r="3.4"/></g></svg>';

export const ICONS = {
  heart: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 2h6v7h7v6h-7v7H9v-7H2V9h7z"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l8 3v6c0 5-3.4 9.4-8 11-4.6-1.6-8-6-8-11V5z"/></svg>',
  crate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="6" width="18" height="15" rx="3"/><path d="M3 11h18M12 6v15M8 3l4 3 4-3"/></svg>',
  rifle: '<svg viewBox="0 0 120 30" fill="currentColor"><path d="M4 12h30l4-4h40v3h30v4H78l-4 3H58l-3 9h-8l2-9H38l-8 6H6z"/></svg>',
  smg: '<svg viewBox="0 0 120 30" fill="currentColor"><path d="M20 10h52v-3h10v3h18v5H72l-3 3h-9v10h-7V18H40l-6 8h-8l4-8h-8l-6-3z"/></svg>',
  shotgun: '<svg viewBox="0 0 120 30" fill="currentColor"><path d="M4 14l26-4h84v4H64v4H48l-6 8h-9l4-8H30L8 22z"/><rect x="62" y="15" width="22" height="5" rx="2"/></svg>',
};
