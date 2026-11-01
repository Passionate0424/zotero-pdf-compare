import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertWritableTarget, isInside } from '../../tools/lib/path-guard.mjs';

test('rejects parent traversal and sibling-prefix confusion', () => {
  const root = path.join(os.tmpdir(), 'doubao-guard');
  assert.equal(isInside(path.join(root, 'jobs', 'a.pdf'), root), true);
  assert.equal(isInside(`${root}-other`, root), false);
  assert.throws(() => assertWritableTarget(path.join(root, '..', 'other'), root));
  assert.throws(() => assertWritableTarget(root, root));
});

test('rejects targets overlapping protected trees', () => {
  const root = path.join(os.tmpdir(), 'doubao-guard');
  assert.throws(() => assertWritableTarget(path.join(root, 'formal', 'storage'), root, [path.join(root, 'formal')]));
  assert.throws(() => assertWritableTarget(path.join(root, 'formal'), root, [path.join(root, 'formal', 'storage')]));
});

test('rejects a junction that redirects a project child outside the project', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'doubao-guard-'));
  const root = path.join(base, 'project');
  const outside = path.join(base, 'outside');
  fs.mkdirSync(root); fs.mkdirSync(outside);
  const link = path.join(root, 'redirect');
  try {
    fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => assertWritableTarget(path.join(link, 'result.pdf'), root), /Link\/junction/);
  } finally {
    if (fs.existsSync(link)) fs.unlinkSync(link);
    fs.rmdirSync(root); fs.rmdirSync(outside); fs.rmdirSync(base);
  }
});

test('allows an ordinary project-owned result path', () => {
  const root = path.join(os.tmpdir(), 'doubao-guard');
  assert.equal(assertWritableTarget(path.join(root, 'runtime', 'result.pdf'), root), path.resolve(root, 'runtime', 'result.pdf'));
});

test('on Windows a differently cased root cannot bypass the root guard', { skip: process.platform !== 'win32' }, () => {
  const root = path.join(os.tmpdir(), 'Doubao-Root-Guard');
  assert.throws(() => assertWritableTarget(root.toLowerCase(), root));
});
