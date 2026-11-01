import test from 'node:test';
import assert from 'node:assert/strict';
import { gates, validateMilestone } from '../../tools/lib/milestone-gate.mjs';

function complete() {
  return {
    milestone: 'P0', checks: Object.fromEntries(gates.P0.map(k => [k, true])),
    evidence: ['runtime/verification.json'],
    visualReview: { status: 'passed', screenshots: [{ path: 'runtime/initial-window.png' }], findings: 'Actual test window inspected.' },
  };
}

test('functional success without visual evidence cannot pass', () => {
  const report = complete();
  delete report.visualReview;
  assert.ok(validateMilestone(report, 'P0').some(s => s.includes('screenshots')));
});
test('a failed or unrun required check cannot pass', () => {
  for (const value of [false, null, 'skipped', undefined]) {
    const report = complete();
    report.checks.actualData = value;
    assert.ok(validateMilestone(report, 'P0').some(s => s.includes('actualData')));
  }
});
test('all required checks and visual evidence accept only the correct milestone', () => {
  assert.deepEqual(validateMilestone(complete(), 'P0'), []);
  assert.ok(validateMilestone(complete(), 'P1').length > 0);
});
