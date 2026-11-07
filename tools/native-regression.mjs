import { spawnSync } from 'node:child_process';

const scenarios = [
  ['annotations-api', 'p1-reader'],
  ['mode-lifecycle', 'p1-reader'],
  ['layout-interactions', 'p2-sync'],
  ['compare-toolbar-geometry', 'manual-import'],
  ['toolbar-height', 'manual-import'],
  ['cache-lifecycle', 'manual-import'],
  ['swap-zoom', 'manual-import'],
  ['navigation', 'p2-sync'],
];
function run(args) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
  if (result.error || result.status !== 0) throw result.error || new Error(`${args.join(' ')} failed (${result.status})`);
}
try {
  console.log('Checking the isolated Zotero instance and protected files...');
  run(['tools/dev-env.mjs', 'verify']);
  for (const [scenario, suite] of scenarios) {
    console.log(`\n=== ${suite}: ${scenario} ===`);
    run(['tools/run-suite.mjs', scenario, suite]);
  }
  console.log('\nAll selected native regression scenarios passed; review captured screenshots separately.');
} catch (error) {
  console.error(`Native regression failed: ${error.message}`);
  process.exitCode = 1;
}
