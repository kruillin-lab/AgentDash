'use strict';

const ANSI_REGEX = /\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[=>]/g;
const CONTROL_REGEX = /[\x00-\x08\x0b-\x1f\x7f]/g;

function stripAnsi(s) {
  return s.replace(ANSI_REGEX, '').replace(CONTROL_REGEX, '');
}

function truncate(s, n) {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}

function classify(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;

  if (/^(Tool:|▸|●|⏺)/.test(trimmed)) return 'tool';
  if (/^> /.test(trimmed)) return 'prompt';
  if (/\b(error|Error|ERROR|fail|Failed|FAILED)\b/.test(trimmed)) return 'error';
  if (/^(reading|writing|editing|running|searching|creating|deleting)\b/i.test(trimmed)) return 'action';
  if (/\b(tokens?|usage|context)\b.*\d/i.test(trimmed)) return 'usage';

  if (trimmed.length > 40 && trimmed.length < 300) return 'output';
  return null;
}

class ActivityParser {
  constructor(sessionId, onEvent) {
    this.sessionId = sessionId;
    this.onEvent = onEvent;
    this.buffer = '';
    this.lastEmit = 0;
    this.lastKind = null;
    this.lastText = null;
  }

  feed(chunk) {
    const clean = stripAnsi(chunk);
    this.buffer += clean;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() || '';
    for (const line of lines) {
      this.process(line);
    }
  }

  process(line) {
    const kind = classify(line);
    if (!kind) return;

    const text = truncate(line.trim(), 200);
    const now = Date.now();

    if (kind === this.lastKind && text === this.lastText) return;
    if (kind === 'output' && now - this.lastEmit < 1500) return;

    this.lastKind = kind;
    this.lastText = text;
    this.lastEmit = now;

    this.onEvent({
      id: `${this.sessionId}-${now}-${Math.random().toString(36).slice(2, 8)}`,
      sessionId: this.sessionId,
      ts: new Date(now).toISOString(),
      kind,
      text,
    });
  }
}

module.exports = { ActivityParser, stripAnsi };
