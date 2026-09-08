'use strict';

require('../common');
const assert = require('node:assert');
const { spawnSyncAndAssert } = require('../common/child_process');
const fixtures = require('../common/fixtures');

const moduleScript = `
  const assert = require('node:assert');
  const env = require('node:browser-env');
  let descriptorValue;
  assert.strictEqual(env.isInstalled(), false);
  assert.strictEqual(typeof globalThis.document, 'undefined');
  const result = env.install({
    url: 'https://example.test/start?x=1',
    html: '<html><head><title>Initial</title></head><body><div id="app" class="ready">hello</div></body></html>',
    navigator: {
      userAgent: 'TestBrowser/1.0',
      platform: 'TestOS',
      languages: ['zh-CN', 'zh'],
    },
    window: {
      properties: { customFlag: true },
    },
    document: {
      properties: { visibilityState: 'hidden' },
      descriptors: {
        challengeValue: { enumerable: true, get() { return 'challenge'; } },
        mutableValue: {
          enumerable: true,
          get() { return descriptorValue; },
          set(value) { descriptorValue = value; },
        },
      },
    },
  });
  assert.strictEqual(env.isInstalled(), true);
  assert.strictEqual(result.window, globalThis);
  assert.strictEqual(window, globalThis);
  assert.strictEqual(self, window);
  assert.strictEqual(top, window);
  assert.strictEqual(parent, window);
  assert.strictEqual(document.defaultView, window);
  assert.strictEqual(location.host, 'example.test');
  assert.strictEqual(document.title, 'Initial');
  assert.strictEqual(document.querySelector('#app').textContent, 'hello');
  assert.strictEqual(document.querySelector('.ready').id, 'app');
  assert.strictEqual(document.querySelectorAll('body #app').length, 1);
  assert.strictEqual(navigator.userAgent, 'TestBrowser/1.0');
  assert.strictEqual(navigator.platform, 'TestOS');
  assert.deepStrictEqual(navigator.languages, ['zh-CN', 'zh']);
  assert.strictEqual(window.customFlag, true);
  assert.strictEqual(document.visibilityState, 'hidden');
  assert.strictEqual(document.challengeValue, 'challenge');
  document.mutableValue = 'updated';
  assert.strictEqual(document.mutableValue, 'updated');
  const all = document.all;
  assert.strictEqual(typeof all, 'undefined');
  assert(all == null);
  assert.strictEqual(Boolean(all), false);
  assert.strictEqual(all.length, 5);
  assert.strictEqual(all.app, document.querySelector('#app'));
  assert.strictEqual(all(0), document.documentElement);
  assert.strictEqual(all('app'), document.querySelector('#app'));
  const later = document.createElement('section');
  later.id = 'later';
  document.body.appendChild(later);
  assert.strictEqual(document.all.later, later);
  assert.strictEqual(document.all.length, 6);
  history.pushState(null, '', '/next');
  assert.strictEqual(location.pathname, '/next');
  document.cookie = 'token=value; Path=/';
  assert.strictEqual(document.cookie, 'token=value');
  localStorage.setItem('key', 'value');
  assert.strictEqual(localStorage.getItem('key'), 'value');
  assert.throws(() => env.install({ url: 'https://again.test/' }), /already installed/);
`;

spawnSyncAndAssert(process.execPath, ['-e', moduleScript], { status: 0, stderr: '' });

spawnSyncAndAssert(process.execPath, [
  '-e',
  `
    const assert = require('node:assert');
    const { install } = require('node:browser-env');
    assert.throws(
      () => install({ url: 'https://example.test/', document: { properties: { all: null } } }),
      /protected browser environment property/,
    );
    assert.strictEqual(typeof globalThis.document, 'undefined');
    assert.throws(
      () => install({ url: 'https://example.test/', document: { descriptors: { createElement: { value: null } } } }),
      /protected browser environment property/,
    );
    assert.throws(
      () => install({ url: 'https://example.test/', window: { properties: { location: null } } }),
      /protected browser environment property/,
    );
  `,
], { status: 0, stderr: '' });

spawnSyncAndAssert(process.execPath, [
  '--input-type=module',
  '-e',
  `
    import assert from 'node:assert';
    import { install, isInstalled } from 'node:browser-env';
    assert.strictEqual(isInstalled(), false);
    install({ url: 'https://esm.example.test/' });
    assert.strictEqual(document.location.hostname, 'esm.example.test');
  `,
], { status: 0, stderr: '' });

const profile = fixtures.path('browser-env', 'profile.json');
spawnSyncAndAssert(process.execPath, [
  `--browser-env-profile=${profile}`,
  '-e',
  `
    const assert = require('node:assert');
    const env = require('node:browser-env');
    assert.strictEqual(env.isInstalled(), true);
    assert.throws(() => env.install({ url: 'https://again.example.test/' }), /already installed/);
    assert.strictEqual(location.hostname, 'profile.example.test');
    assert.strictEqual(document.querySelector('#app').textContent, 'ok');
    assert.strictEqual(document.visibilityState, 'hidden');
    assert.strictEqual(window.profileEnabled, true);
    assert.strictEqual(navigator.userAgent, 'ProfileBrowser/1.0');
  `,
], { status: 0, stderr: '' });

spawnSyncAndAssert(process.execPath, [
  '--browser-env-profile=/definitely/missing/profile.json',
  '-e', '',
], { status: 1, stderr: /Unable to load --browser-env-profile/ });
