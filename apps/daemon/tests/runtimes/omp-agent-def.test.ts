import { test } from 'vitest';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { ompAgentDef, ompSessionArgs } from '../../src/runtimes/defs/omp.js';

const prevDataDir = process.env.OD_DATA_DIR;

function withDataDir(value: string | undefined, fn: () => void) {
  if (value === undefined) delete process.env.OD_DATA_DIR;
  else process.env.OD_DATA_DIR = value ?? "";
  try {
    fn();
  } finally {
    if (prevDataDir === undefined) delete process.env.OD_DATA_DIR;
    else process.env.OD_DATA_DIR = prevDataDir;
  }
}

test('omp buildArgs: json print mode with session dir, model, and thinking', () => {
  withDataDir('E:/tmp-data', () => {
    const args = ompAgentDef.buildArgs('', [], [], {
      model: '9router/deepseek-v4-flash',
      reasoning: 'high',
    }, {});
    assert.deepEqual(args, [
      '--mode', 'json',
      '-p',
      '--session-dir', join('E:/tmp-data', 'omp-sessions'),
      '--model', '9router/deepseek-v4-flash',
      '--thinking', 'high',
    ]);
  });
});

test('omp buildArgs: resume replays the captured session id', () => {
  withDataDir('E:/tmp-data', () => {
    const args = ompAgentDef.buildArgs('', [], [], {}, {
      resumeSessionId: '01a102e6-1e26',
    });
    assert.ok(args.includes('--resume'));
    assert.equal(args[args.indexOf('--resume') + 1], '01a102e6-1e26');
    // A resume turn must not be ephemeral: --no-session would defeat the
    // captured-id replay, so it must never appear.
    assert.ok(!args.includes('--no-session'));
  });
});

test('omp session args fall back to cwd when OD_DATA_DIR is unset', () => {
  delete process.env.OD_DATA_DIR;
  try {
    const args = ompSessionArgs({});
    assert.equal(args[0], '--session-dir');
    assert.ok(typeof args[1] === 'string');
    assert.match(args[1], /omp-sessions$/);
    assert.ok(!args.includes('--resume'));
  } finally {
    if (prevDataDir === undefined) delete process.env.OD_DATA_DIR;
    else process.env.OD_DATA_DIR = prevDataDir;
  }
});
