// The one rule of a path of the project (a file, a folder, a page file): parts joined by "/", none of them empty, "."
// or "..", none holding a "\" or a control character. The export writes every path as an entry of the site's ZIP, so a
// part that climbs would put a file outside the folder the archive is unpacked into (the audit's FP1; the app's own
// archive reader, core/project/zip.ts, refuses such an entry as unsafe). The validator and the file commands ask it.
export function projectPathProblem(path: string): string | null {
  if (path === '' || path.startsWith('/')) return `"${path}" is not a path of the project`;
  for (const part of path.split('/')) {
    if (part === '' || part === '.' || part === '..') return `"${path}" holds the part "${part}", which names no file or folder`;
    if (part.includes('\\') || [...part].some((c) => c.charCodeAt(0) < 0x20)) return `"${path}" holds a character a path cannot hold`;
  }
  return null;
}
