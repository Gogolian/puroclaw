'use strict';

function normalizeMessages(messages, input, systemPrompt) {
  const normalized = [];
  if (systemPrompt) normalized.push({ role: 'system', content: systemPrompt });
  normalized.push(...messages);
  normalized.push({ role: 'user', content: input });
  return normalized;
}

async function callAgent(input, options) {
  const { config, messages = [], fetchImpl = globalThis.fetch, env = process.env } = options;
  const provider = config.provider || {};

  if (provider.type === 'echo') {
    return `Echo: ${input}`;
  }

  if (typeof fetchImpl !== 'function') {
    throw new Error('Native fetch is unavailable. Use Node.js 18 or newer.');
  }

  const apiKey = provider.apiKeyEnv ? env[provider.apiKeyEnv] : undefined;
  if (!apiKey) {
    return 'No provider API key found. Configure provider credentials or run a local skill such as /echo.';
  }

  if (provider.type === 'anthropic') {
    return callAnthropic(provider, input, messages, fetchImpl, apiKey);
  }

  return callOpenAI(provider, input, messages, fetchImpl, apiKey);
}

async function callOpenAI(provider, input, messages, fetchImpl, apiKey) {
  const response = await fetchImpl(provider.baseUrl, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: provider.model,
      messages: normalizeMessages(messages, input, provider.systemPrompt)
    })
  });

  const body = await readResponse(response);
  const content = body && body.choices && body.choices[0] && body.choices[0].message && body.choices[0].message.content;
  if (!content) throw new Error('Provider response did not include a chat message.');
  return content.trim();
}

async function callAnthropic(provider, input, messages, fetchImpl, apiKey) {
  const response = await fetchImpl(provider.baseUrl || 'https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': provider.version || '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: provider.model,
      max_tokens: provider.maxTokens || 1024,
      system: provider.systemPrompt,
      messages: [...messages, { role: 'user', content: input }].filter((message) => message.role !== 'system')
    })
  });

  const body = await readResponse(response);
  const text = body && body.content && body.content.find((item) => item.type === 'text');
  if (!text || !text.text) throw new Error('Provider response did not include text content.');
  return text.text.trim();
}

async function readResponse(response) {
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch (error) {
    throw new Error(`Provider returned invalid JSON: ${text.slice(0, 120)}`);
  }

  if (!response.ok) {
    const message = body.error && (body.error.message || body.error.type);
    throw new Error(`Provider request failed (${response.status}): ${message || text.slice(0, 120)}`);
  }

  return body;
}

module.exports = {
  callAgent,
  normalizeMessages
};
