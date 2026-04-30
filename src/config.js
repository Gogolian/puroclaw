'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const DEFAULT_CONFIG = Object.freeze({
  dataDir: 'data',
  historyFile: 'history.json',
  skillsDir: 'skills',
  provider: {
    type: 'openai',
    baseUrl: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o-mini',
    apiKeyEnv: 'OPENAI_API_KEY',
    systemPrompt: 'You are PuroClaw, a small personal AI assistant.'
  },
  server: {
    host: '127.0.0.1',
    port: 7419
  }
});

function projectPath(cwd, ...parts) {
  return path.join(cwd, ...parts);
}

function configPath(cwd) {
  return projectPath(cwd, 'data', 'config.json');
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw new Error(`Could not read ${filePath}: ${error.message}`);
  }
}

function mergeConfig(base, override) {
  return {
    ...base,
    ...override,
    provider: {
      ...base.provider,
      ...(override.provider || {})
    },
    server: {
      ...base.server,
      ...(override.server || {})
    }
  };
}

function applyEnv(config, env = process.env) {
  return mergeConfig(config, {
    provider: {
      type: env.PUROCLAW_PROVIDER_TYPE || config.provider.type,
      baseUrl: env.PUROCLAW_PROVIDER_URL || config.provider.baseUrl,
      model: env.PUROCLAW_MODEL || config.provider.model,
      apiKeyEnv: env.PUROCLAW_API_KEY_ENV || config.provider.apiKeyEnv
    },
    server: {
      host: env.PUROCLAW_HOST || config.server.host,
      port: env.PUROCLAW_PORT ? Number(env.PUROCLAW_PORT) : config.server.port
    }
  });
}

async function loadConfig(cwd = process.cwd(), env = process.env) {
  const fileConfig = await readJson(configPath(cwd), {});
  return applyEnv(mergeConfig(DEFAULT_CONFIG, fileConfig), env);
}

async function initConfig(cwd = process.cwd()) {
  const dataDir = projectPath(cwd, DEFAULT_CONFIG.dataDir);
  await fs.mkdir(dataDir, { recursive: true });
  const file = configPath(cwd);

  try {
    await fs.access(file);
    return { created: false, path: file };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  await fs.writeFile(file, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`);
  return { created: true, path: file };
}

module.exports = {
  DEFAULT_CONFIG,
  applyEnv,
  configPath,
  initConfig,
  loadConfig,
  mergeConfig,
  projectPath,
  readJson
};
