'use strict';

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { initConfig, loadConfig } = require('./config');
const { createHistory } = require('./history');
const { routeMessage } = require('./router');
const { listSkills } = require('./skills');
const pkg = require('../package.json');

function usage() {
  return [
    'Usage:',
    '  node puroclaw.js init',
    '  node puroclaw.js chat "message"',
    '  node puroclaw.js serve',
    '  node puroclaw.js skill list',
    '  node puroclaw.js version',
    '  node puroclaw.js help'
  ].join('\n');
}

async function runCli(args, options = {}) {
  const cwd = options.cwd || process.cwd();
  const [command, subcommand, ...rest] = args;

  if (!command || command === '-h' || command === '--help' || command === 'help') {
    writeLine(options, usage());
    return;
  }

  if (command === '-v' || command === '--version' || command === 'version') {
    writeLine(options, `puroclaw ${pkg.version}`);
    return;
  }

  if (command === 'init') return init(cwd, options);
  if (command === 'chat') return chat([subcommand, ...rest].filter(Boolean).join(' '), cwd, options);
  if (command === 'serve') return serve(cwd, options);
  if (command === 'skill' && subcommand === 'list') return skillList(cwd, options);

  throw new Error(`Unknown command.\n${usage()}`);
}

const ECHO_SKILL_TEMPLATE = `'use strict';

module.exports = {
  name: 'echo',
  description: 'Replies with the text you send it.',
  run({ input }) {
    return input || '';
  }
};
`;

async function init(cwd, options = {}) {
  const result = await initConfig(cwd);
  const echoDir = path.join(cwd, 'skills', 'echo');
  await fs.mkdir(echoDir, { recursive: true });
  const echoFile = path.join(echoDir, 'skill.js');
  try {
    await fs.access(echoFile);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await fs.writeFile(echoFile, ECHO_SKILL_TEMPLATE);
  }
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
  const logger = options.logger || console;
  const server = http.createServer(async (request, response) => {
    try {
      if (request.url === '/health') {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          response.setHeader('allow', 'GET, HEAD');
          return sendJson(response, 405, { error: 'method_not_allowed' });
        }
        return sendJson(response, 200, { ok: true, version: pkg.version });
      }

      if (request.url === '/chat') {
        if (request.method !== 'POST') {
          response.setHeader('allow', 'POST');
          return sendJson(response, 405, { error: 'method_not_allowed' });
        }
        const contentType = String(request.headers['content-type'] || '').toLowerCase();
        if (contentType && !contentType.startsWith('application/json')) {
          return sendJson(response, 415, { error: 'unsupported_media_type' });
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
      }

      return sendJson(response, 404, { error: 'not_found' });
    } catch (error) {
      if (error && error.statusCode) {
        return sendJson(response, error.statusCode, { error: error.code });
      }
      logger.error && logger.error('puroclaw: request failed:', error);
      return sendJson(response, 500, { error: 'internal_error' });
    }
  });

  const host = config.server.host;
  const port = config.server.port;
  await new Promise((resolve) => server.listen(port, host, resolve));
  const address = server.address();
  const boundPort = address && typeof address === 'object' ? address.port : port;
  writeLine(options, `puroclaw listening on http://${host}:${boundPort}`);
  return server;
}

function readBody(request, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let aborted = false;

    request.on('data', (chunk) => {
      if (aborted) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buf.length;
      if (size > limit) {
        aborted = true;
        reject(httpError(413, 'payload_too_large'));
        request.destroy();
        return;
      }
      chunks.push(buf);
    });
    request.on('end', () => {
      if (aborted) return;
      resolve(Buffer.concat(chunks, size).toString('utf8'));
    });
    request.on('error', (error) => {
      if (aborted) return;
      reject(error);
    });
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
