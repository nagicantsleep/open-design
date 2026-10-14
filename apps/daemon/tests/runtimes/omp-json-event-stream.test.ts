import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createJsonEventStreamHandler } from '../../src/runtimes/json-event-stream.js';

type JsonStreamEvent = Record<string, unknown>;

function collectEvents(kind: string) {
  const events: JsonStreamEvent[] = [];
  const handler = createJsonEventStreamHandler(kind, (event) => events.push(event));
  return { events, handler };
}

test('omp json stream maps session, deltas, tools, and usage', () => {
  const { events, handler } = collectEvents('omp');

  handler.feed(
    '{"type":"session","version":3,"id":"01a1027f-85dd","cwd":"C:\\\\tmp"}\n' +
    '{"type":"agent_start"}\n' +
    '{"type":"turn_start"}\n' +
    '{"type":"message_update","assistantMessageEvent":{"type":"text_start","contentIndex":0}}\n' +
    '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","contentIndex":0,"delta":"OK"}}\n' +
    '{"type":"message_update","assistantMessageEvent":{"type":"toolcall_start","contentIndex":1}}\n' +
    '{"type":"tool_execution_start","toolCallId":"call_1","toolName":"bash","args":{"command":"ls"}}\n' +
    '{"type":"tool_execution_end","toolCallId":"call_1","toolName":"bash","result":{"content":[{"type":"text","text":"file.txt"}]}}\n' +
    '{"type":"message_update","assistantMessageEvent":{"type":"thinking_delta","contentIndex":0,"delta":"hmm"}}\n' +
    '{"type":"turn_end","message":{"role":"assistant","stopReason":"stop","usage":{"input":5949,"output":2,"cacheRead":640,"cacheWrite":0,"totalTokens":6591,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}}}}\n' +
    '{"type":"agent_end"}\n' +
    '{"type":"advisor_yielded"}\n',
  );

  assert.deepEqual(events, [
    { type: 'status', label: 'running', sessionId: '01a1027f-85dd' },
    { type: 'status', label: 'working' },
    { type: 'status', label: 'thinking' },
    { type: 'text_delta', delta: 'OK' },
    { type: 'tool_use', id: 'call_1', name: 'bash', input: { command: 'ls' } },
    { type: 'tool_result', toolUseId: 'call_1', content: 'file.txt', isError: false },
    { type: 'thinking_delta', delta: 'hmm' },
    {
      type: 'usage',
      usage: {
        input_tokens: 5949,
        output_tokens: 2,
        cached_read_tokens: 640,
        cached_write_tokens: 0,
      },
      costUsd: 0,
    },
  ]);
});

test('omp error frames surface as error events', () => {
  const { events, handler } = collectEvents('omp');

  handler.feed(
    '{"type":"turn_end","message":{"role":"assistant","stopReason":"error","errorMessage":"provider auth failed","usage":null}}\n' +
    '{"type":"message_update","assistantMessageEvent":{"type":"error","reason":"context overflow"}}\n',
  );

  assert.deepEqual(events, [
    { type: 'error', message: 'provider auth failed', raw: '{"type":"turn_end","message":{"role":"assistant","stopReason":"error","errorMessage":"provider auth failed","usage":null}}' },
    { type: 'error', message: 'context overflow', raw: '{"type":"message_update","assistantMessageEvent":{"type":"error","reason":"context overflow"}}' },
  ]);
});

test('omp message_start/end snapshots and unknown frames do not re-emit text', () => {
  const { events, handler } = collectEvents('omp');

  handler.feed(
    '{"type":"message_start","message":{"role":"assistant","content":[{"type":"text","text":"OK"}]}}\n' +
    '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"OK"}]}}\n' +
    '{"type":"something_new","payload":{}}\n',
  );

  assert.deepEqual(events, [
    { type: 'raw', line: '{"type":"something_new","payload":{}}' },
  ]);
});
