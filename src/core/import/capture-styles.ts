interface CapturePage { readonly file: string; readonly tree?: { readonly attributes: Readonly<Record<string, unknown>> } }
/** The capture importer preserves one residual sheet per page; files remain the existing project-file owner. */
export function capturedPageStylePath(page: CapturePage): string {
  const linked = page.tree?.attributes.pageCaptureStyle;
  if (typeof linked === 'string' && linked) return linked;
  return page.file.replace(/\.html$/i, '') + '.capture.css';
}
export function capturedPageCss(document: { readonly files?: readonly { readonly path: string; readonly bytes: string }[] }, page: CapturePage): string {
  const file = document.files?.find(file => file.path === capturedPageStylePath(page));
  return file ? new TextDecoder().decode(Uint8Array.from(atob(file.bytes), char => char.charCodeAt(0))) : '';
}
/** Resolves relative sheet assets before handing the address to the existing file URL owner. */
export function captureAssetPath(page: CapturePage, address: string): string {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(address)) return address;
  const base = new URL(capturedPageStylePath(page), 'https://capture.invalid/');
  const value = new URL(address, base);
  return value.pathname.slice(1) + value.search + value.hash;
}
/** Existing class/file owners call this for residual CSS during their normal transactions. */
