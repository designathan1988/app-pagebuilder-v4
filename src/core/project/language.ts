// The project's languages (spec project-language; the plan's stage 5): the language the pages are written in (the
// html lang of every page that names none of its own, and what screen readers and spell checkers read) and the
// language the exported code names its classes in (core/export/names.ts: English by default). Both are optional
// language tags kept with the project (core/export/authoring.ts projectLanguagePatches, which validates them); a tag
// that is no language tag is refused before any change. One undo step each.
import { message, registerHandler } from '../commands/registry.ts';
import { languageTagAllowed } from '../text/language-tag.ts';
import { projectLanguagePatches, type ExportDocument } from '../export/authoring.ts';

// the language the project's code is named in when none is set (core/export/names.ts)
const DEFAULT_CODE_LANGUAGE = 'en';

const refused = (value: string) => ({ kind: 'refused' as const, message: message('status.project.languageInvalid', { value }) });

export const setProjectLanguage = registerHandler('project.setLanguage', ({ state }, { language }) => {
  const typed = language.trim();
  if (!languageTagAllowed(typed)) return refused(typed);
  const document = state.document as ExportDocument;
  const patches = projectLanguagePatches(document, typed, document.codeLanguage ?? DEFAULT_CODE_LANGUAGE).filter((patch) => patch.path[0] !== 'codeLanguage');
  return { kind: 'change', patches, ...(patches.length === 0 ? {} : { message: message('status.project.languageSet', { language: typed }) }) };
});

export const setCodeLanguage = registerHandler('project.setCodeLanguage', ({ state }, { language }) => {
  const typed = language.trim();
  if (!languageTagAllowed(typed)) return refused(typed);
  const document = state.document as ExportDocument;
  const patches = projectLanguagePatches(document, document.language ?? typed, typed).filter((patch) => patch.path[0] !== 'language');
  return { kind: 'change', patches, ...(patches.length === 0 ? {} : { message: message('status.project.codeLanguageSet', { language: typed }) }) };
});
