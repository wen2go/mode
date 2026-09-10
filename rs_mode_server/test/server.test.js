'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createRsServer } = require('../server.js');

const fixturesDirectory = path.join(__dirname, 'fixtures');
const fixtureHtml = fs.readFileSync(path.join(fixturesDirectory, 'challenge.html'), 'utf8');
const fixtureScript = fs.readFileSync(path.join(fixturesDirectory, 'challenge.js'), 'utf8');

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function request(port, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
    const headers = payload ? {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    } : {};
    const clientRequest = http.request({
      host: '127.0.0.1',
      port,
      method,
      path: pathname,
      headers,
    }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { text += chunk; });
      response.on('end', () => resolve({ statusCode: response.statusCode, body: JSON.parse(text) }));
    });
    clientRequest.on('error', reject);
    clientRequest.end(payload);
  });
}

function challengeWith(inlineCode, outJsPath = '/challenge.js') {
  return `<!doctype html><html><head>
    <meta r="m" id="fixture-meta" content="fixture-content">
    <script r="m">${inlineCode}</script>
    <script r="m" src="${outJsPath}"></script>
  </head><body></body></html>`;
}

let cacheDirectory;
let fixtureServer;
let fixturePort;
let rsServer;
let rsPort;

test.before(async () => {
  cacheDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'mode-rs-env-'));
  fixtureServer = http.createServer((request, response) => {
    if (request.url === '/challenge.js') {
      response.writeHead(200, { 'Content-Type': 'application/javascript' });
      response.end(fixtureScript);
      return;
    }
    response.writeHead(404);
    response.end('not found');
  });
  fixturePort = await listen(fixtureServer);
  rsServer = createRsServer({ outJsDir: cacheDirectory, workerTimeout: 2_000 });
  rsPort = await listen(rsServer);
});

test.after(async () => {
  await close(rsServer);
  await close(fixtureServer);
  fs.rmSync(cacheDirectory, { recursive: true, force: true });
});

function validPayload() {
  return {
    html: fixtureHtml,
    url: `http://127.0.0.1:${fixturePort}/page`,
    ua: 'FixtureUA/1.0',
  };
}

test('health and unknown routes retain the compatibility service shape', async () => {
  assert.deepEqual(await request(rsPort, 'GET', '/health'), {
    statusCode: 200,
    body: { status: 'ok' },
  });
  assert.deepEqual(await request(rsPort, 'GET', '/unknown'), {
    statusCode: 404,
    body: {},
  });
});

test('runs local inline and external challenge scripts in Mode browser-env', async () => {
  const response = await request(rsPort, 'POST', '/rs_env', validPayload());
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, {
    external: 'ok',
    inline: 'ok',
    storage: 'fresh',
  });
});

test('cookies and storage do not leak between request workers', async () => {
  const first = await request(rsPort, 'POST', '/rs_env', validPayload());
  const second = await request(rsPort, 'POST', '/rs_env', validPayload());
  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.equal(first.body.storage, 'fresh');
  assert.equal(second.body.storage, 'fresh');
});

test('invalid input, absent challenge pieces, and failed external loads return compatibility errors', async () => {
  assert.deepEqual(await request(rsPort, 'POST', '/rs_env', '{'), {
    statusCode: 500,
    body: {},
  });
  assert.deepEqual(await request(rsPort, 'POST', '/rs_env', {}), {
    statusCode: 500,
    body: {},
  });
  assert.deepEqual(await request(rsPort, 'POST', '/rs_env', {
    ...validPayload(),
    html: challengeWith('var $_ = 1;', '/missing.js'),
  }), {
    statusCode: 500,
    body: {},
  });
});

test('the request-size limit keeps the HTTP 500 compatibility response', async () => {
  const limitedServer = createRsServer({ maxBodySize: 16, outJsDir: cacheDirectory });
  const limitedPort = await listen(limitedServer);
  try {
    assert.deepEqual(await request(limitedPort, 'POST', '/rs_env', { tooLarge: 'this request exceeds sixteen bytes' }), {
      statusCode: 500,
      body: {},
    });
  } finally {
    await close(limitedServer);
  }
});

test('unsupported browser interfaces fail instead of falling back to env.js', async () => {
  const response = await request(rsPort, 'POST', '/rs_env', {
    ...validPayload(),
    html: challengeWith('var $_ = 1; new XMLHttpRequest();'),
  });
  assert.deepEqual(response, { statusCode: 500, body: {} });
});

test('a runaway challenge is terminated by the worker timeout', async () => {
  const response = await request(rsPort, 'POST', '/rs_env', {
    ...validPayload(),
    html: challengeWith('var $_ = 1; while (true) {}'),
  });
  assert.deepEqual(response, { statusCode: 500, body: {} });
});
