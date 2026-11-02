import { spawnSync } from 'node:child_process';

const current = spawnSync('git', ['config', '--local', '--get', 'core.hooksPath'], { encoding: 'utf8' });
if (current.status !== 0 && current.status !== 1) throw new Error(current.stderr || 'Cannot read local Git configuration');
const existing = current.stdout.trim();
if (existing && existing !== '.githooks') throw new Error(`Existing core.hooksPath is ${existing}; refusing to replace it.`);
const install = spawnSync('git', ['config', '--local', 'core.hooksPath', '.githooks'], { stdio: 'inherit' });
if (install.status !== 0) throw install.error || new Error('Could not install project hooks');
console.log('Installed project-local Git hooks.');
