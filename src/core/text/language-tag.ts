// What a language tag is (the user's real-use audit, A3.1 and A3.44): the validator, page.setSetting and the fields
// ask this one rule, which reads nothing of the document (plan I.8: page settings ask it without the validator).

const LANGUAGE_TAG = /^[A-Za-z]{1,8}(?:-[A-Za-z0-9]{1,8})*$/;
const LANGUAGE_NAMES = new Intl.DisplayNames(['en'], { type: 'language', fallback: 'none' });

// Whether a text is a language tag (the audit's A3.1): a private-use tag (x-…), or one ICU knows, so "banana" is no
// language. page.setSetting asks this same rule — the language's one owner is here, and the field only asks it (A3.44).
export function languageTagAllowed(value: string): boolean {
  if (!LANGUAGE_TAG.test(value)) return false;
  if (/^x-(?:[A-Za-z0-9]{1,8})(?:-[A-Za-z0-9]{1,8})*$/i.test(value)) return true;
  try {
    const canonical = Intl.getCanonicalLocales(value)[0];
    return canonical !== undefined && LANGUAGE_NAMES.of(canonical) !== undefined;
  } catch {
    return false;
  }
}
