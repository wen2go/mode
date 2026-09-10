'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} = require('node:worker_threads');

const DEFAULT_HOST = process.env.RS_MODE_HOST || '127.0.0.1';
const DEFAULT_PORT = Number(process.env.RS_JS_PORT || 8080);
const DEFAULT_MAX_BODY_SIZE = 10 * 1024 * 1024;
const DEFAULT_REQUEST_TIMEOUT = 20_000;
const DEFAULT_WORKER_TIMEOUT = 40_000;
const DEFAULT_OUT_JS_DIR = path.join(__dirname, 'out_js');

function parseAttributes(text) {
  const attributes = {};
  const matcher = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;
  while ((match = matcher.exec(text)) !== null) {
    attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? '';
  }
  return attributes;
}

function parseChallengeHtml(html) {
  const metas = Array.from(html.matchAll(/<meta\b([^>]*)>/gi), (match) => ({
    attributes: parseAttributes(match[1]),
  }));
  const scripts = Array.from(html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi), (match) => ({
    attributes: parseAttributes(match[1]),
    content: match[2],
  }));

  const meta = metas.find((tag) => tag.attributes.r === 'm');
  if (!meta || !meta.attributes.id || !meta.attributes.content) {
    throw new Error('missing r=m meta challenge marker');
  }

  const inline = scripts.find(
    (tag) => tag.attributes.r === 'm' &&
      !tag.attributes.src &&
      tag.content.includes('$_'),
  );
  if (!inline) {
    throw new Error('missing inline r=m challenge script');
  }

  const external = scripts.find((tag) => tag.attributes.r === 'm' && tag.attributes.src);
  if (!external) {
    throw new Error('missing external r=m challenge script');
  }

  return {
    inlineCode: inline.content,
    outJsPath: external.attributes.src,
  };
}

function fetchText(targetUrl, ua, referer, requestTimeout, redirectCount = 0) {
  if (redirectCount > 5) {
    return Promise.reject(new Error('too many external script redirects'));
  }

  const client = targetUrl.startsWith('https:') ? https : http;
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': ua,
        Referer: referer,
      },
      timeout: requestTimeout,
    };
    if (client === https) {
      options.rejectUnauthorized = false;
      options.secureOptions = crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT;
    }

    const request = client.get(targetUrl, options, (response) => {
      const { statusCode = 0, headers } = response;
      if (statusCode >= 300 && statusCode < 400 && headers.location) {
        response.resume();
        resolve(fetchText(new URL(headers.location, targetUrl).href, ua, referer, requestTimeout, redirectCount + 1));
        return;
      }
      if (statusCode < 200 || statusCode >= 300) {
        response.resume();
        reject(new Error(`external script request failed with status ${statusCode}`));
        return;
      }

      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { text += chunk; });
      response.on('end', () => resolve(text));
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new Error('external script request timed out')));
    request.on('error', reject);
  });
}

async function loadOutJs(outJsUrl, ua, referer, { outJsDir, requestTimeout }) {
  const parsedUrl = new URL(outJsUrl);
  const fileName = path.basename(parsedUrl.pathname) || 'challenge.js';
  const cachePath = path.join(outJsDir, fileName);

  try {
    return {
      content: await fs.promises.readFile(cachePath, 'utf8'),
      fileName,
      source: 'cache',
    };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const content = await fetchText(outJsUrl, ua, referer, requestTimeout);
  await fs.promises.mkdir(outJsDir, { recursive: true });
  const temporaryPath = `${cachePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.promises.writeFile(temporaryPath, content, 'utf8');
  await fs.promises.rename(temporaryPath, cachePath);
  return { content, fileName, source: 'network' };
}

function parseCookies(cookieHeader) {
  const cookies = {};
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name) cookies[name] = value;
  }
  return cookies;
}

function installBrowserEnvironment({ html, url, ua }) {
  const { install } = require('node:browser-env');
  install({
    url,
    html,
    navigator: {
      userAgent: ua,
      platform: 'Win32',
      language: 'zh-CN',
      languages: ['zh-CN', 'zh'],
      vendor: 'Google Inc.',
      webdriver: false,
      maxTouchPoints: 0,
      appVersion: ua.replace(/^Mozilla\//, ''),
      appName: 'Netscape',
    },
    screen: {
      availHeight: 1040,
      availLeft: 0,
      availTop: 0,
      availWidth: 1920,
      colorDepth: 24,
      height: 1080,
      pixelDepth: 24,
      width: 1920,
    },
    window: {
      properties: {
        innerHeight: 1080,
        innerWidth: 1920,
        outerHeight: 1080,
        outerWidth: 1920,
        screenLeft: 0,
        screenTop: 0,
        screenX: 0,
        screenY: 0,
      },
    },
    document: {
      properties: {
        visibilityState: 'hidden',
      },
    },
  });
}

async function generateCookie(payload, options) {
  const { html, url, ua } = payload;
  if (typeof html !== 'string' || !html || typeof url !== 'string' || !url || typeof ua !== 'string' || !ua) {
    throw new Error('html, url, and ua must be non-empty strings');
  }

  const challenge = parseChallengeHtml(html);
  const outJsUrl = new URL(challenge.outJsPath, url).href;
  const outJs = await loadOutJs(outJsUrl, ua, url, options);

  installBrowserEnvironment({ html, url, ua });
  const executeChallenge = new Function('require', `${challenge.inlineCode}\n${outJs.content}`);
  const result = executeChallenge(require);
  if (result && typeof result.then === 'function') await result;

  return {
    cookies: parseCookies(document.cookie),
    outJsFile: outJs.fileName,
    outJsSource: outJs.source,
  };
}

function runWorker(payload, options) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(__filename, { workerData: { payload, options } });
    let settled = false;
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const timer = setTimeout(() => {
      settle(reject, new Error('challenge worker timed out'));
      worker.terminate().catch(() => {});
    }, options.workerTimeout);

    worker.once('message', (message) => {
      if (message.ok) settle(resolve, message.value);
      else settle(reject, new Error(message.error));
    });
    worker.once('error', (error) => settle(reject, error));
    worker.once('exit', (code) => {
      if (!settled && code !== 0) settle(reject, new Error(`challenge worker exited with code ${code}`));
    });
  });
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

function readJson(request, maxBodySize) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let body = '';
    let rejected = false;
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      if (rejected) return;
      size += Buffer.byteLength(chunk);
      if (size > maxBodySize) {
        rejected = true;
        reject(new Error('request body exceeds 10 MB limit'));
        return;
      }
      body += chunk;
    });
    request.on('end', () => {
      if (rejected) return;
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('invalid JSON body'));
      }
    });
    request.on('error', reject);
  });
}

function createRsServer(overrides = {}) {
  const options = {
    maxBodySize: overrides.maxBodySize ?? DEFAULT_MAX_BODY_SIZE,
    outJsDir: overrides.outJsDir ?? DEFAULT_OUT_JS_DIR,
    requestTimeout: overrides.requestTimeout ?? DEFAULT_REQUEST_TIMEOUT,
    workerTimeout: overrides.workerTimeout ?? DEFAULT_WORKER_TIMEOUT,
  };

  return http.createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      sendJson(response, 200, { status: 'ok' });
      return;
    }
    if (request.method !== 'POST' || request.url !== '/rs_env') {
      sendJson(response, 404, {});
      return;
    }

    try {
      const payload = await readJson(request, options.maxBodySize);
      const result = await runWorker(payload, options);
      console.log(`[out_js:${result.outJsSource}] ${result.outJsFile}`);
      sendJson(response, 200, result.cookies);
    } catch (error) {
      console.error(`[rs_mode_server] ${error.message}`);
      sendJson(response, 500, {});
    }
  });
}

function startServer() {
  const server = createRsServer();
  server.listen(DEFAULT_PORT, DEFAULT_HOST, () => {
    console.log(`Mode rs_env server listening on http://${DEFAULT_HOST}:${DEFAULT_PORT}`);
  });
  return server;
}

if (isMainThread) {
  module.exports = { createRsServer, parseChallengeHtml, startServer };
  if (require.main === module) startServer();
} else {
  generateCookie(workerData.payload, workerData.options)
    .then((value) => parentPort.postMessage({ ok: true, value }))
    .catch((error) => parentPort.postMessage({ ok: false, error: error.message }));
}
