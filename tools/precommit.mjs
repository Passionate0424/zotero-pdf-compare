import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error || result.status !== 0) {
    if (result.stdout) process.stderr.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    throw result.error || new Error(`${command} ${args.join(' ')} failed (${result.status})`);
  }
  return result.stdout || '';
}

try {
  run('git', ['-c', 'core.whitespace=cr-at-eol', 'diff', '--cached', '--check']);
  const staged = run('git', ['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMRD']).split('\0').filter(Boolean);
  const unstaged = new Set(run('git', ['diff', '--name-only', '-z', '--diff-filter=ACMRD']).split('\0').filter(Boolean));
  const relevant = name => /^(addon|worker|tools|tests)\//.test(name) || name === 'package.json';
  const partial = staged.filter(name => relevant(name) && unstaged.has(name));
  if (partial.length) throw new Error(`Stage all changes to tested files before committing: ${partial.join(', ')}`);
  if (staged.some(name => /^(addon|worker|tools|tests)\//.test(name)) && !staged.includes('docs/WORKLOG.md')) {
    throw new Error('Stage the corresponding docs/WORKLOG.md entry with code changes.');
  }
  for (const file of staged.filter(name => /^(addon|worker|tools|tests)\/.*\.(?:js|mjs|cjs)$/.test(name) && existsSync(name))) {
    run(process.execPath, ['--check', file]);
  }
  console.log('Running unit tests (working tree; partially staged tested files are rejected)...');
  const unit = spawnSync(process.execPath, ['--test', 'tests/unit/*.test.mjs'], { stdio: 'inherit' });
  if (unit.error || unit.status !== 0) throw unit.error || new Error(`Unit tests failed (${unit.status}).`);
  console.log('Pre-commit checks passed. Native and visual checks are separate: see docs/REGRESSION.md.');
} catch (error) {
  console.error(`Pre-commit check failed: ${error.message}`);
  process.exitCode = 1;
}
