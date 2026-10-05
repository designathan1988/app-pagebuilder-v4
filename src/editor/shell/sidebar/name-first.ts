// A Layers row whose name does not fit beside its details (its tag, id or classes), or an Explorer file's row beside
// its folder and size, gives the details' room to the name:
// they leave that row, and the name ends in an ellipsis only where it does not fit the row alone (the audit of
// 2026-10-05: "Cartão Assinatura título" read "Cartão Assi…" beside "article"). The details' width is kept when they
// leave, so a row is judged the same either way and nothing flickers: they come back once the name and they fit again.
// a Layers row, and an Explorer file's main area, with the name and the details each holds
const ROWS = '.row--tree, .row__main';
const NAME = ':scope > .row__name';
const DETAILS = ':scope > .row__meta[data-region="layers-row-details"], .row__main > .row__meta';
// the sub-pixel difference between the text's width and its box
const TOLERANCE = 0.5;

export function fitNames(list: HTMLElement): void {
  for (const row of list.querySelectorAll<HTMLElement>(ROWS)) {
    const name = row.querySelector<HTMLElement>(NAME);
    const details = row.querySelector<HTMLElement>(DETAILS);
    if (name === null || details === null) {
      delete row.dataset.nameFirst;
      continue;
    }
    if (!('nameFirst' in row.dataset)) {
      if (name.scrollWidth > name.clientWidth + TOLERANCE) {
        row.dataset.detailsWidth = String(details.offsetWidth);
        row.dataset.nameFirst = '';
      }
      continue;
    }
    const room = Number(row.dataset.detailsWidth ?? '0');
    if (name.scrollWidth + room <= name.clientWidth + TOLERANCE) delete row.dataset.nameFirst;
  }
}
