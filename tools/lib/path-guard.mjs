import fs from 'node:fs';
import path from 'node:path';

export function isInside(candidate, root) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}

export function rejectLinks(candidate) {
  let current = path.resolve(candidate);
  while (true) {
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Link/junction is not permitted: ${current}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

export function assertWritableTarget(candidate, allowedRoot, protectedPaths = []) {
  const absolute = path.resolve(candidate);
  if (!isInside(absolute, allowedRoot) || path.relative(path.resolve(allowedRoot), absolute) === '') {
    throw new Error(`Write must target a child of ${allowedRoot}`);
  }
  rejectLinks(absolute);
  for (const protectedPath of protectedPaths) {
    if (isInside(absolute, protectedPath) || isInside(protectedPath, absolute)) {
      throw new Error(`Protected path overlap: ${absolute}`);
    }
  }
  return absolute;
}
