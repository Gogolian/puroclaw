# puroclaw

A pure, zero-dependency personal AI assistant runtime for plain Node.js.

`puroclaw` is inspired by OpenClaw and NanoClaw, but takes a stricter path:
no framework, no build step, no TypeScript requirement, no runtime dependencies,
and no Docker requirement.

PuroClaw is the tiny, pure-Node version of the personal AI assistant idea: one
readable process, file-backed local state, optional skills, and no dependencies.

## Philosophy

**Zero dependencies.**  
If Node ships it, PuroClaw can use it. Everything else should be optional.

**Plain Node.**  
No framework, compiler, container, or package manager workflow is required to
understand and change the runtime.

**Hackable core.**  
The code is intentionally small enough to read, fork, and fully understand.

## Why “puro”?

`puro` means pure. PuroClaw is the pure version of the Claw idea: plain Node,
local files, readable code, and nothing hidden behind frameworks.

## Requirements

- Node.js 18 or newer for native `fetch`
- No runtime dependencies

## Quick start

```bash
node puroclaw.js init
node puroclaw.js chat "what should I do today?"
node puroclaw.js serve
node puroclaw.js skill list
node puroclaw.js version
node puroclaw.js help
```

`init` writes `data/config.json` and seeds the bundled `echo` skill so you can
try a local skill before configuring any provider.

Use a local skill without configuring a provider:

```bash
node puroclaw.js chat "/echo hello"
```

If you invoke an unknown `/skill`, PuroClaw replies with a clear error instead
of forwarding the message to your LLM provider.

## Configuration

`node puroclaw.js init` creates `data/config.json`. Provider settings can also
be overridden with environment variables:

- `PUROCLAW_PROVIDER_TYPE`
- `PUROCLAW_PROVIDER_URL`
- `PUROCLAW_MODEL`
- `PUROCLAW_API_KEY_ENV`
- `PUROCLAW_HOST`
- `PUROCLAW_PORT`

The default provider shape is OpenAI-compatible. Anthropic-style `/v1/messages`
requests are available by setting `provider.type` to `anthropic`.

## Skills

Skills are local JavaScript files at `skills/<name>/skill.js`:

```js
module.exports = {
  name: 'echo',
  description: 'Replies with the text you send it.',
  run({ input }) {
    return input;
  }
};
```

Run a skill from chat with `/skill-name input`.

## HTTP server

Start the built-in server:

```bash
node puroclaw.js serve
```

Then send a message:

```bash
curl -X POST http://127.0.0.1:7419/chat \
  -H 'content-type: application/json' \
  -d '{"message":"/echo hello"}'
```

Endpoints:

- `GET /health` — liveness probe, returns `{ "ok": true, "version": "..." }`.
- `POST /chat` — JSON body `{ "message": "..." }`. Requests with the wrong
  method get `405 Method Not Allowed`; non-JSON content types get `415`.
- Bodies larger than 1 MiB are rejected with `413 Payload Too Large`.

Set `PUROCLAW_PORT=0` to ask the OS for an ephemeral port (useful in tests).

## Continuous integration

Tests run on Node 18, 20 and 22 via GitHub Actions (`.github/workflows/ci.yml`).

## Project shape

```text
puroclaw/
├─ puroclaw.js
├─ src/
│  ├─ agent.js
│  ├─ cli.js
│  ├─ config.js
│  ├─ history.js
│  ├─ router.js
│  ├─ skills.js
│  └─ store.js
├─ skills/
│  └─ echo/
│     └─ skill.js
├─ data/
│  └─ .gitkeep
├─ README.md
├─ package.json
└─ LICENSE
```

OpenClaw is the platform. NanoClaw is the minimal containerized assistant.
PuroClaw is the dependency-free Node core you can understand completely.
