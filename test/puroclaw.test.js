'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const test = require('node:test');
const { callAgent } = require('../src/agent');
const { parseJsonBody, readBody, runCli, serve } = require('../src/cli');
const { applyEnv, parseServerPort } = require('../src/config');
const { parseSkillCommand, routeMessage } = require('../src/router');
const { createHistory } = require('../src/history');
const pkg = require('../package.json');

async function fixtureProject() {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'puroclaw-'));
  await fs.mkdir(path.join(cwd, 'skills', 'echo'), { recursive: true });
  await fs.copyFile(
    path.join(__dirname, '..', 'skills', 'echo', 'skill.js'),
    path.join(cwd, 'skills', 'echo', 'skill.js')
  );
  return cwd;
}

function capture() {
  let output = '';
  return {
    stream: {
      write(chunk) {
        output += chunk;
      }
    },
    output() {
      return output;
    }
  };
}

test('parseSkillCommand parses slash commands', () => {
  assert.deepEqual(parseSkillCommand('/echo hello world'), {
    name: 'echo',
    input: 'hello world'
  });
  assert.equal(parseSkillCommand('hello'), null);
});

test('chat runs local skills and records history', async () => {
  const cwd = await fixtureProject();
  const out = capture();

  await runCli(['chat', '/echo', 'hello'], { cwd, stdout: out.stream });

  assert.equal(out.output(), 'hello\n');
  const history = JSON.parse(await fs.readFile(path.join(cwd, 'data', 'history.json'), 'utf8'));
  assert.equal(history.length, 1);
  assert.equal(history[0].source, 'skill:echo');
});

test('skill list shows local skills', async () => {
  const cwd = await fixtureProject();
  const out = capture();

  await runCli(['skill', 'list'], { cwd, stdout: out.stream });

  assert.match(out.output(), /echo - Replies with the text you send it\./);
});

test('agent explains missing provider credentials without making a request', async () => {
  const output = await callAgent('hello', {
    config: {
      provider: {
        type: 'openai',
        baseUrl: 'https://example.invalid',
        model: 'example',
        apiKeyEnv: 'MISSING_KEY'
      }
    },
    env: {},
    fetchImpl() {
      throw new Error('fetch should not be called');
    }
  });

  assert.match(output, /No provider API key found/);
});

test('request helpers reject invalid or oversized JSON bodies with status codes', async () => {
  assert.throws(() => parseJsonBody('{'), { statusCode: 400, code: 'invalid_json' });
  assert.throws(() => parseJsonBody('null'), { statusCode: 400, code: 'invalid_json' });
  assert.throws(() => parseJsonBody('[]'), { statusCode: 400, code: 'invalid_json' });

  await assert.rejects(
    readBody(Readable.from(['x'.repeat(1024 * 1024 + 1)])),
    { statusCode: 413, code: 'payload_too_large' }
  );
});

test('server port environment override must be a valid TCP port', () => {
  assert.equal(parseServerPort('7419'), 7419);
  assert.equal(applyEnv({ provider: {}, server: { host: '127.0.0.1', port: 1 } }, {
    PUROCLAW_PORT: '8080'
  }).server.port, 8080);
  assert.throws(() => parseServerPort('not-a-number'), /Invalid server port/);
  assert.equal(parseServerPort('0'), 0); // 0 means "any free port" for testing/embed use
  assert.throws(() => parseServerPort('-1'), /Invalid server port/);
  assert.throws(() => parseServerPort('65536'), /Invalid server port/);
});

test('version command prints the package version', async () => {
  const out = capture();
  await runCli(['version'], { stdout: out.stream });
  assert.equal(out.output().trim(), `puroclaw ${pkg.version}`);
});

test('help command prints usage instead of erroring', async () => {
  const out = capture();
  await runCli(['help'], { stdout: out.stream });
  assert.match(out.output(), /Usage:/);
});

test('init seeds config and the bundled echo skill', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'puroclaw-init-'));
  const out = capture();
  await runCli(['init'], { cwd, stdout: out.stream });
  assert.match(out.output(), /Created/);
  const config = JSON.parse(await fs.readFile(path.join(cwd, 'data', 'config.json'), 'utf8'));
  assert.equal(config.provider.type, 'openai');
  const skill = require(path.join(cwd, 'skills', 'echo', 'skill.js'));
  assert.equal(skill.name, 'echo');
  assert.equal(skill.run({ input: 'hi' }), 'hi');
});

test('unknown skill commands surface an error instead of calling the LLM', async () => {
  const cwd = await fixtureProject();
  const history = createHistory(cwd, { dataDir: 'data', historyFile: 'history.json' });
  const result = await routeMessage('/nosuch please do something', {
    cwd,
    config: { skillsDir: 'skills', dataDir: 'data', historyFile: 'history.json', provider: { type: 'echo' } },
    history,
    env: {},
    fetchImpl() {
      throw new Error('fetch must not be called for unknown skills');
    }
  });
  assert.equal(result.source, 'skill:unknown');
  assert.match(result.output, /Unknown skill "nosuch"/);
});

test('readBody honors the byte-size limit for multi-byte chunks', async () => {
  // four-byte UTF-8 emoji repeated; .length (chars) is half of bytes,
  // so the old char-based check would have under-counted size.
  const big = '😀'.repeat(300_000);
  await assert.rejects(
    readBody(Readable.from([big]), 1024 * 1024),
    { statusCode: 413, code: 'payload_too_large' }
  );
});

test('serve responds correctly to /health, /chat, and bad requests', async () => {
  const cwd = await fixtureProject();
  const out = capture();
  const env = { PUROCLAW_PORT: '0' };
  const server = await serve(cwd, { cwd, stdout: out.stream, env, logger: { error() {} } });
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual((await health.json()).ok, true);

    const wrongMethod = await fetch(`${base}/health`, { method: 'POST' });
    assert.equal(wrongMethod.status, 405);
    assert.equal(wrongMethod.headers.get('allow'), 'GET, HEAD');

    const wrongType = await fetch(`${base}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'hello'
    });
    assert.equal(wrongType.status, 415);

    const ok = await fetch(`${base}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: '/echo from-test' })
    });
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.output, 'from-test');
    assert.equal(body.source, 'skill:echo');

    const notFound = await fetch(`${base}/nope`);
    assert.equal(notFound.status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('anthropic provider builds the documented request shape', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({ content: [{ type: 'text', text: 'hi there' }] });
      }
    };
  };

  const output = await callAgent('hello', {
    config: {
      provider: {
        type: 'anthropic',
        model: 'claude-3-5-sonnet-latest',
        apiKeyEnv: 'ANTHROPIC_API_KEY',
        systemPrompt: 'be terse'
      }
    },
    env: { ANTHROPIC_API_KEY: 'secret' },
    fetchImpl
  });

  assert.equal(output, 'hi there');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.anthropic.com/v1/messages');
  assert.equal(calls[0].init.headers['x-api-key'], 'secret');
  const sent = JSON.parse(calls[0].init.body);
  assert.equal(sent.model, 'claude-3-5-sonnet-latest');
  assert.equal(sent.system, 'be terse');
  assert.deepEqual(sent.messages, [{ role: 'user', content: 'hello' }]);
});
