// What git status --porcelain=v1 -z reports outside the index: every path with a change that is not staged, or not
// tracked at all (https://git-scm.com/docs/git-status#_porcelain_format_version_1). Each entry is "XY path", NUL-ended;
// X is the index's state, Y the working tree's; a rename or a copy is followed by its original path in a second entry.

export function outsideTheIndex(porcelain: string): string[] {
  const entries = porcelain.split('\0');
  const outside: string[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index] ?? '';
    if (entry.length < 4) continue;
    const staged = entry[0] ?? ' ';
    const worktree = entry[1] ?? ' ';
    if (staged === 'R' || staged === 'C') index += 1; // the original path follows
    if (staged === '?' || worktree !== ' ') outside.push(entry.slice(3));
  }
  return outside;
}
