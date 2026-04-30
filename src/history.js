'use strict';

const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Store } = require('./store');

function historyPath(cwd, config) {
  return path.join(cwd, config.dataDir, config.historyFile);
}

function createHistory(cwd, config) {
  return new Store(historyPath(cwd, config), []);
}

async function appendTurn(history, turn) {
  const entry = {
    id: randomUUID(),
    at: new Date().toISOString(),
    ...turn
  };

  await history.update((items) => [...items, entry]);
  return entry;
}

async function recentMessages(history, limit = 12) {
  const items = await history.read();
  return items
    .slice(-limit)
    .flatMap((item) => [
      { role: 'user', content: item.input },
      { role: 'assistant', content: item.output }
    ])
    .filter((message) => message.content);
}

module.exports = {
  appendTurn,
  createHistory,
  historyPath,
  recentMessages
};
