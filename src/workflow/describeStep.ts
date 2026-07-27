/**
 * Official-style local step descriptions (Claude in Chrome 1.0.81 heuristics).
 */

export type ElementSnapLike = {
  tagName: string;
  text?: string;
  attributes?: Record<string, string>;
  selector?: string;
};

function humanizeName(raw: string): string {
  return raw
    .replace(/_/g, ' ')
    .replace(/([A-Z])/g, ' $1')
    .trim()
    .toLowerCase();
}

export function describeClick(el: ElementSnapLike): string {
  const t = (el.tagName || 'div').toLowerCase();
  const n = el.text?.trim();
  const o = el.attributes || {};

  if (o['aria-label']) return `Click on "${o['aria-label']}"`;
  if (o.title && (!n || n.length <= 3)) return `Click on "${o.title}"`;

  if ((t === 'button' || t === 'a') && n && n.length > 1) {
    return `Click on "${n.length > 40 ? `${n.substring(0, 40)}...` : n}" button`;
  }
  if ((t === 'button' || t === 'a') && o.title) return `Click on "${o.title}" button`;

  if (t === 'input') {
    const type = o.type || 'text';
    const placeholder = o.placeholder;
    const name = o.name;
    if (type === 'submit' || type === 'button') {
      const label = o.value || n;
      return label ? `Click on "${label}" button` : 'Click on submit button';
    }
    if (placeholder) return `Click on "${placeholder}" field`;
    if (name) return `Click on ${humanizeName(name)} field`;
    return `Click on ${type} input`;
  }

  if (t === 'select') {
    const name = o.name;
    return name ? `Click on ${humanizeName(name)} dropdown` : 'Click on dropdown menu';
  }

  if (t === 'img') {
    const alt = o.alt;
    return alt ? `Click on "${alt}" image` : 'Click on image';
  }

  if (o.role) {
    return n
      ? `Click on "${n.length > 40 ? `${n.substring(0, 40)}...` : n}"`
      : `Click on ${o.role}`;
  }

  if (t === 'div' || t === 'span') {
    const tip = o.title || o['data-tooltip'] || o['data-tip'] || o['data-original-title'];
    if (tip && (!n || n.length <= 3)) return `Click on "${tip}"`;
    if (n) {
      const short = n.length > 50 ? `${n.substring(0, 50)}...` : n;
      if (o.class?.includes('menu') || o.class?.includes('nav')) {
        return `Click on "${short}" menu item`;
      }
      return `Click on "${short}"`;
    }
    if (tip) return `Click on "${tip}"`;
  }

  if (o.id) {
    return `Click on ${o.id.replace(/-/g, ' ').replace(/_/g, ' ').replace(/([A-Z])/g, ' $1').trim()}`;
  }

  const a =
    o.title ||
    o['data-tooltip'] ||
    o['data-tip'] ||
    o['data-original-title'] ||
    o['aria-description'];
  if (a) return `Click on "${a}"`;
  if (n) return `Click on "${n.length > 40 ? `${n.substring(0, 40)}...` : n}"`;
  return `Click on ${t} element`;
}

export function describeType(
  text: string,
  field?: { name?: string; selector?: string },
): string {
  if (text === '[password]' || (/password/i.test(field?.name || '') && text.startsWith('•'))) {
    if (field?.name && !/^password$/i.test(field.name.trim())) {
      return `Enter password in ${humanizeName(field.name)} field`;
    }
    return 'Enter password';
  }

  if (!text) {
    return field?.name
      ? `Type in ${humanizeName(field.name)} field`
      : 'Type text';
  }

  let s = `Type "${text.substring(0, 30)}${text.length > 30 ? '...' : ''}"`;
  if (text.includes('@')) s = `Enter email "${text}"`;
  else if (text.length < 20 && !text.includes(' ')) s = `Enter "${text}"`;
  else if (text.length > 50) s = `Type text: "${text.substring(0, 50)}..."`;

  if (field?.name) {
    s += ` in ${humanizeName(field.name)} field`;
  }
  return s;
}
