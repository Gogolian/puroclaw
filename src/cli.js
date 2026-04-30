'use strict';

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { initConfig, loadConfig } = require('./config');
const { createHistory } = require('./history');
const { routeMessage } = require('./router');
const { listSkills } = require('./skills');

function usage() {
  return [
    'Usage:',
    '  node puroclaw.js init',
    '  node puroclaw.js chat "message"',
    '  node puroclaw.js serve',
    '  node puroclaw.js skill list'
  ].join('\n');
}

async function runCli(args, options = {}) {
  const cwd = options.cwd || process.cwd();
  const [command, subcommand, ...rest] = args;

  if (!command || command === '-h' || command === '--help') {
    options.stdout ? options.stdout.write(`${usage()}\n`) : console.log(usage());
    return;
  }

  if (command === 'init') return init(cwd, options);
  if (command === 'chat') return chat([subcommand, ...rest].filter(Boolean).join(' '), cwd, options);
  if (command === 'serve') return serve(cwd, options);
  if (command === 'skill' && subcommand === 'list') return skillList(cwd, options);

  throw new Error(`Unknown command.\n${usage()}`);
}

async function init(cwd, options = {}) {
  const result = await initConfig(cwd);
  await fs.mkdir(path.join(cwd, 'skills'), { recursive: true });
  await fs.mkdir(path.join(cwd, 'data'), { recursive: true });
  await fs.writeFile(path.join(cwd, 'data', '.gitkeep'), '', { flag: 'a' });
  writeLine(options, result.created ? `Created ${result.path}` : `Already initialized at ${result.path}`);
}

async function chat(input, cwd, options = {}) {
  if (!input) throw new Error('chat requires a message.');
  const config = await loadConfig(cwd, options.env || process.env);
  const history = createHistory(cwd, config);
  const result = await routeMessage(input, {
    cwd,
    config,
    history,
    env: options.env || process.env,
    fetchImpl: options.fetchImpl
  });
  writeLine(options, result.output);
  return result;
}

async function skillList(cwd, options = {}) {
  const config = await loadConfig(cwd, options.env || process.env);
  const skills = await listSkills(cwd, config);
  if (skills.length === 0) {
    writeLine(options, 'No skills found.');
    return skills;
  }
  for (const skill of skills) {
    writeLine(options, `${skill.name}${skill.description ? ` - ${skill.description}` : ''}`);
  }
  return skills;
}

async function serve(cwd, options = {}) {
  const config = await loadConfig(cwd, options.env || process.env);
  const history = createHistory(cwd, config);
  const server = http.createServer(async (request, response) => {
    try {
      if (request.method === 'GET' && request.url === '/health') {
        return sendJson(response, 200, { ok: true });
      }

      if (request.method !== 'POST' || request.url !== '/chat') {
        return sendJson(response, 404, { error: 'not_found' });
      }

      const body = await readBody(request);
      const payload = parseJsonBody(body);
      if (!payload.message || typeof payload.message !== 'string') {
        return sendJson(response, 400, { error: 'message is required' });
      }

      const result = await routeMessage(payload.message, {
        cwd,
        config,
        history,
        env: options.env || process.env,
        fetchImpl: options.fetchImpl
      });
      return sendJson(response, 200, result);
    } catch (error) {
      if (error.statusCode) {
        return sendJson(response, error.statusCode, { error: error.code });
      }
      return sendJson(response, 500, { error: 'internal_error' });
    }
  });

  const host = config.server.host;
  const port = config.server.port;
  await new Promise((resolve) => server.listen(port, host, resolve));
  writeLine(options, `puroclaw listening on http://${host}:${port}`);
  return server;
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    let tooLarge = false;
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      if (tooLarge) return;
      if (body.length + chunk.length > 1024 * 1024) {
        tooLarge = true;
        body = '';
        return;
      }
      body += chunk;
    });
    request.on('end', () => {
      if (tooLarge) reject(httpError(413, 'payload_too_large'));
      else resolve(body);
    });
    request.on('error', reject);
  });
}

function parseJsonBody(body) {
  let payload;
  try {
    payload = JSON.parse(body || '{}');
  } catch (error) {
    throw httpError(400, 'invalid_json');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw httpError(400, 'invalid_json');
  }
  return payload;
}

function httpError(statusCode, code) {
  const error = new Error(code);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff'
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

function writeLine(options, line) {
  if (options.stdout) options.stdout.write(`${line}\n`);
  else console.log(line);
}

module.exports = {
  chat,
  httpError,
  init,
  parseJsonBody,
  readBody,
  runCli,
  serve,
  skillList,
  usage
};
