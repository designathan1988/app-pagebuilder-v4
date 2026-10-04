import type { Page } from '@playwright/test';

export type AuditNode =
  | { readonly kind: 'element'; readonly tag: string; readonly namespace: string; readonly attributes: readonly { readonly name: string; readonly value: string }[]; readonly children: readonly AuditNode[] }
  | { readonly kind: 'text' | 'comment'; readonly value: string };

// One browser observation after the exported page has loaded. Keeping element, text and comment
// nodes in source order makes this usable for a structural diff without a screenshot scorer.
export async function readDomObservation(page: Page): Promise<AuditNode> {
  return page.evaluate(() => {
    const visit = (node: Node): AuditNode | null => {
      if (node.nodeType === Node.TEXT_NODE) return { kind: 'text', value: node.nodeValue ?? '' };
      if (node.nodeType === Node.COMMENT_NODE) return { kind: 'comment', value: node.nodeValue ?? '' };
      if (node.nodeType !== Node.ELEMENT_NODE) return null;
      const element = node as Element;
      return {
        kind: 'element', tag: element.localName, namespace: element.namespaceURI ?? '',
        attributes: [...element.attributes].map((one) => ({ name: one.name, value: one.value })),
        children: [...element.childNodes].map(visit).filter((one): one is AuditNode => one !== null),
      };
    };
    const root = visit(document.documentElement);
    if (root === null) throw new Error('export has no document element');
    return root;
  });
}
