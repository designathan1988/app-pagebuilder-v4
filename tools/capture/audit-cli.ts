import fs from 'node:fs';
import path from 'node:path';
import { auditWidth, type WidthAudit } from './audit.ts';

const sites = (JSON.parse(fs.readFileSync('tools/capture/corpus.json', 'utf8')) as { sites: { id: string; url: string }[] }).sites;
const requested = process.argv.slice(2).filter((value) => !value.startsWith('--'));
const chosen = requested.length === 0 || requested.includes('all') ? sites : sites.filter((site) => requested.includes(site.id));
if (chosen.length === 0) throw new Error('No corpus site matches the requested audit');
const widths = [1440, 1180, 834, 390];
const rows: WidthAudit[] = [];
const errors: { site: string; width: number; error: string }[] = [];
for (const site of chosen) for (const width of widths) {
  try {
    rows.push(auditWidth(site, width));
  }
  catch (error) { errors.push({ site: site.id, width, error: String(error).split('\n')[0] ?? 'unknown error' }); }
}
fs.mkdirSync('.cache/logs', { recursive: true });
const grouped = new Map<string, number>();
for (const row of rows) for (const issue of row.issues) {
  const key = `${issue.boundary}:${issue.kind}`;
  grouped.set(key, (grouped.get(key) ?? 0) + 1);
}
const summary = [...grouped].sort((a, b) => b[1] - a[1]);
const output = { generatedAt: new Date().toISOString(), sites: chosen.map((one) => one.id), widths, rows, errors, summary };
fs.writeFileSync('.cache/logs/capture-import-audit.json', `${JSON.stringify(output, null, 2)}\n`);
const markdown = [
  '# Automatic capture import audit', '',
  'This report compares live DOM, Companion package, saved project JSON and observed exported DOM. It is read-only and never changes the pixel comparator, reference, score or 98%/100% acceptance decision.', '',
  `Sites requested: ${chosen.length}; widths audited: ${rows.length}; unavailable widths: ${errors.length}.`, '',
  '| Boundary and kind | Issues |', '| --- | ---: |',
  ...summary.map(([name, count]) => `| ${name} | ${count} |`), '',
  '| Site | Width | Live stability | Export score | Nodes live/package/project/export | Issues |',
  '| --- | ---: | ---: | ---: | --- | ---: |',
  ...rows.map((row) => `| ${row.site} | ${row.width} | ${row.stability?.toFixed(1) ?? '—'}% | ${row.score?.toFixed(1) ?? '—'}% | ${[row.sourceNodes, row.packageNodes, row.projectNodes, row.exportNodes].map((one) => one ?? '—').join('/')} | ${row.issues.length} |`), '',
  ...errors.map((one) => `- ${one.site} ${one.width}px: ${one.error}`), '',
];
for (const row of rows) {
  if (row.issues.length === 0) continue;
  markdown.push(`## ${row.site} at ${row.width}px`, '', '| Boundary | Kind | Path | Expected | Actual | Confidence |', '| --- | --- | --- | --- | --- | --- |');
  for (const issue of row.issues.slice(0, 30)) markdown.push(`| ${issue.boundary} | ${issue.kind} | ${issue.path.replaceAll('|', '\\|')} | ${issue.expected.replaceAll('|', '\\|')} | ${issue.actual.replaceAll('|', '\\|')} | ${issue.confidence} |`);
  if (row.issues.length > 30) markdown.push('', `Additional ${row.issues.length - 30} issues are in [the full JSON](../.cache/logs/capture-import-audit.json).`);
  markdown.push('');
}
fs.writeFileSync('.cache/logs/capture-import-audit.md', `${markdown.join('\n')}\n`);
for (const site of chosen) {
  const siteRows = rows.filter((one) => one.site === site.id);
  if (siteRows.length === 0) continue;
  const folder = path.join('.cache', 'corpus', site.id);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'import-audit.json'), `${JSON.stringify(siteRows, null, 2)}\n`);
}
console.log(`Audited ${rows.length} widths of ${chosen.length} sites; ${errors.length} unavailable; ${rows.reduce((total, one) => total + one.issues.length, 0)} boundary issues.`);
for (const [kind, count] of summary.slice(0, 12)) console.log(`${kind}: ${count}`);
console.log('.cache/logs/capture-import-audit.md and .json');
