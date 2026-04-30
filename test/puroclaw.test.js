'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { callAgent } = require('../src/agent');
const { runCli } = require('../src/cli');
const { parseSkillCommand } = require('../src/router');

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

test('agent explains missing provider key without making a request', async () => {
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
