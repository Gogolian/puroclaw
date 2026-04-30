'use strict';

const { callAgent } = require('./agent');
const { appendTurn, recentMessages } = require('./history');
const { runSkill } = require('./skills');

function parseSkillCommand(input) {
  const trimmed = String(input || '').trim();
  if (!trimmed.startsWith('/')) return null;
  const [name, ...rest] = trimmed.slice(1).split(/\s+/);
  if (!name) return null;
  return { name, input: rest.join(' ') };
}

async function routeMessage(input, context) {
  const command = parseSkillCommand(input);
  const historyMessages = await recentMessages(context.history);
  let output;
  let source = 'agent';

  if (command) {
    const skillOutput = await runSkill(context.cwd, context.config, command.name, command.input, context);
    if (skillOutput !== null) {
      output = skillOutput;
      source = `skill:${command.name}`;
    }
  }

  if (output === undefined) {
    output = await callAgent(input, {
      config: context.config,
      messages: historyMessages,
      fetchImpl: context.fetchImpl,
      env: context.env
    });
  }

  await appendTurn(context.history, { input, output, source });
  return { input, output, source };
}

module.exports = {
  parseSkillCommand,
  routeMessage
};
