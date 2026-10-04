// The one rule of an address (INVENTORY.md, owners; the user's real-use audit, A3.2): every field that
// writes an address uses it — a link's href (element.setLink), a resource attribute (an image's Source, a form's
// action, a video's poster, an iframe's src: element.setAttribute), the page's own addresses (page.setSetting), a
// background image and url() in a free declaration (core/style). One rule, one reason, one normalisation.
//
// What an address may be:
//  - empty, which removes it (the caller decides; `readAddress` says ok with an empty value);
//  - a fragment of the page itself ("#inicio");
//  - a relative address inside the site ("/about", "about.html", "../img/a.png"), or a path of the project
//    ("img/logo.png");
//  - a web address ("https://example.com/a"?x=1", "http://…");
//  - an email or a phone address ("mailto:ana@example.com", "tel:+55 11 99999-0000");
//  - a domain typed without a scheme ("example.com/about"), which is normalised to https://example.com/about — the one
//    normalisation: what a person types is what a browser would open.
// Refused, each with its reason: an address that runs code (javascript:, vbscript:) or carries a document inline
// (data:, blob:) — `status.url.unsafe` — and one with a space or with a scheme the rule does not know
// (`status.url.malformed`). A space inside a mailto: or tel: body is allowed (a phone number is written with them).
import type { Message } from '../commands/registry.ts';
import { message } from '../commands/registry.ts';

// the schemes an address may carry: a web address, an email, a phone
const ALLOWED_SCHEMES = ['http:', 'https:', 'mailto:', 'tel:'];
// the schemes that run code or hand a document over inline: never an address of a page
const UNSAFE_SCHEMES = ['javascript:', 'vbscript:', 'data:', 'blob:', 'file:'];
const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
// a domain typed without a scheme: its first segment looks like one (a dot, no slash before it)
const BARE_DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$|\?|#)/i;

// A relative address that names a file: a path of folders ("img/a b.png") or a name with the extension of a file a
// site holds (an image, a medium, a font, a document, code). A top-level domain is no such extension, so "example
// .com" stays a typo.
const FILE_EXTENSION = /\.(png|jpe?g|gif|webp|avif|svg|bmp|ico|tiff?|mp4|webm|mov|m4v|ogv|mp3|wav|ogg|oga|m4a|flac|woff2?|ttf|otf|eot|pdf|txt|csv|tsv|json|xml|xlsx?|docx?|pptx?|zip|css|m?js|html?)$/i;
const filePath = (value: string): boolean => {
  const path = value.replace(/[?#].*$/, '');
  return path.includes('/') || FILE_EXTENSION.test(path);
};

export type Address =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly value: string; readonly refusal: Message };

const refused = (value: string, refusal: Message): Address => ({ ok: false, value, refusal });

export function readAddress(typed: string): Address {
  const value = typed.trim();
  if (value === '') return { ok: true, value: '' };
  if (value.startsWith('#')) return { ok: true, value };
  const scheme = SCHEME.exec(value)?.[1]?.toLowerCase();
  if (scheme !== undefined) {
    if (UNSAFE_SCHEMES.includes(`${scheme}:`)) return refused(value, message('status.url.unsafe', { url: value }));
    if (!ALLOWED_SCHEMES.includes(`${scheme}:`)) return refused(value, message('status.url.malformed', { url: value }));
    // a web address has no space anywhere; an email or a phone address may hold them
    if (scheme !== 'mailto' && scheme !== 'tel' && /\s/.test(value)) return refused(value, message('status.url.malformed', { url: value }));
    // what follows the scheme must name something: "https://" and "mailto:" name no address (the two slashes are not a host)
    if (value.slice(scheme.length + 1).replace(/^\/+/, '') === '') return refused(value, message('status.url.malformed', { url: value }));
    return { ok: true, value };
  }
  // a space names a file of the site when the address is a path of one ("img/My photo.png", "Logo final.svg"): the
  // URL parser percent-encodes it in a path (WHATWG URL, the path percent-encode set), and a file a person uploads or
  // renames keeps its own name (the audit's AD1: such a file was refused once placed). Anywhere else a space is a typo
  // ("example .com"), and a tab or a line break never belongs to an address.
  if (/\s/.test(value) && (/[^\S ]/.test(value) || !filePath(value))) return refused(value, message('status.url.malformed', { url: value }));
  if (BARE_DOMAIN.test(value)) {
    // a web address holds no space (its host and its path are typed as one: "example.com/a b" is a typo)
    if (/\s/.test(value)) return refused(value, message('status.url.malformed', { url: value }));
    const normalized = `https://${value}`;
    return { ok: true, value: normalized };
  }
  // a relative address is a path: a word alone ("nope") names no file and no page, and a browser would ask a server
  // for it — refused, as the audit's Poster case requires (a path, a file name with its extension, or a #section)
  if (!value.includes('/') && !value.includes('.')) return refused(value, message('status.url.malformed', { url: value }));
  return { ok: true, value };
}

// Whether a stored address is one this rule allows (a document that arrived from a file, a paste, an import): the
// validator's question, and the export's.
export function addressAllowed(value: string): boolean {
  return readAddress(value).ok;
}
