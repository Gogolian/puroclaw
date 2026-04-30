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
      const payload = JSON.parse(body || '{}');
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
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        request.destroy(new Error('request body too large'));
      }
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

function sendJson(response, status, payload) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(`${JSON.stringify(payload)}\n`);
}

function writeLine(options, line) {
  if (options.stdout) options.stdout.write(`${line}\n`);
  else console.log(line);
}

module.exports = {
  chat,
  init,
  runCli,
  serve,
  skillList,
  usage
};
