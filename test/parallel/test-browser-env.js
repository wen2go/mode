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
  assert.strictEqual(Object.prototype.toString.call(document), '[object HTMLDocument]');
  assert.strictEqual(Object.prototype.toString.call(document.documentElement), '[object HTMLHtmlElement]');
  assert.strictEqual(Object.prototype.toString.call(document.head), '[object HTMLHeadElement]');
  assert.strictEqual(Object.prototype.toString.call(document.body), '[object HTMLBodyElement]');
  assert.deepStrictEqual(Object.keys(document.body), []);
  const divs = document.getElementsByTagName('div');
  assert.strictEqual(divs[0], document.querySelector('#app'));
  assert.strictEqual(divs[0].getAttribute('id'), 'app');
  assert.strictEqual(navigator.userAgent, 'TestBrowser/1.0');
  assert.strictEqual(navigator.platform, 'TestOS');
  assert.strictEqual(typeof performance.markResourceTiming, 'undefined');
  assert.deepStrictEqual(navigator.languages, ['zh-CN', 'zh']);
  assert.strictEqual(window.customFlag, true);
  assert.strictEqual(document.visibilityState, 'hidden');
  const visibilityStateDescriptor = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(document), 'visibilityState');
  assert.strictEqual(visibilityStateDescriptor.enumerable, true);
  assert.strictEqual(visibilityStateDescriptor.set, undefined);
  document.visibilityState = 'visible';
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
  assert.strictEqual(document._cookieJar, undefined);
  assert.deepStrictEqual(
    Object.getOwnPropertyNames(document).filter((name) => name.startsWith('_')),
    [],
  );
  assert.strictEqual(document._body, undefined);
  assert.strictEqual(document._location, undefined);
  localStorage.setItem('key', 'value');
  assert.strictEqual(localStorage.getItem('key'), 'value');
  assert.strictEqual(localStorage._values, undefined);
  assert.strictEqual(sessionStorage._values, undefined);
  assert.throws(() => env.install({ url: 'https://again.test/' }), /already installed/);
`;

spawnSyncAndAssert(process.execPath, ['-e', moduleScript], { status: 0, stderr: '' });

spawnSyncAndAssert(process.execPath, [
  '-e',
  `
    const assert = require('node:assert');
    const { install } = require('node:browser-env');
    const script = 'if (1 < 2) { window.comparison = "<ok>"; }';

    install({
      url: 'https://example.test/',
      html: '<html><head><script id="comparison">' + script + '</script></head><body></body></html>',
    });

    assert.strictEqual(document.querySelector('#comparison').textContent, script);
    assert.deepStrictEqual(Object.getOwnPropertyNames(document), ['location']);
    assert.deepStrictEqual(Object.keys(document), ['location']);
    const locationDescriptor = Object.getOwnPropertyDescriptor(document, 'location');
    assert.strictEqual(locationDescriptor.configurable, false);
    assert.strictEqual(locationDescriptor.enumerable, true);
    assert.strictEqual(typeof locationDescriptor.get, 'function');
    assert.strictEqual(typeof locationDescriptor.set, 'function');
    assert.strictEqual(document.hidden, false);
    assert.strictEqual(document.referrer, '');
    document.referrer = 'https://ignored.example.test/';
    assert.strictEqual(document.referrer, '');
  `,
], { status: 0, stderr: '' });

spawnSyncAndAssert(process.execPath, [
  '-e',
  `
    const assert = require('node:assert');
    const { install } = require('node:browser-env');

    install({
      url: 'https://sub.example.test/a/b/page',
      html: '<html><head></head><body><main id="inside-html">inside</main></body></html><script id="after-html">window.afterHtmlScript = true;</script><div id="after-html-node">tail</div>',
    });

    function cookies() {
      return document.cookie === '' ? [] : document.cookie.split('; ').sort();
    }

    function expectCookies(...expected) {
      assert.deepStrictEqual(cookies(), expected.sort());
    }

    assert.strictEqual(document.readyState, 'complete');
    assert.strictEqual(document.currentScript, null);
    assert.strictEqual(document.querySelector('#inside-html').textContent, 'inside');
    assert.strictEqual(document.querySelector('#after-html').textContent,
                       'window.afterHtmlScript = true;');
    assert.strictEqual(document.querySelector('#after-html-node').textContent, 'tail');
    assert.strictEqual(document.getElementsByTagName('script').length, 1);

    document.cookie = 'hostOnly=one; Path=/';
    document.cookie = 'domainCookie=shared; Domain=example.test; Path=/';
    expectCookies('domainCookie=shared', 'hostOnly=one');

    location.href = 'https://example.test/a/b/page';
    expectCookies('domainCookie=shared');
    location.href = 'https://sub.example.test/a/b/page';
    expectCookies('domainCookie=shared', 'hostOnly=one');

    document.cookie = 'root=root; Path=/';
    document.cookie = 'pathA=a; Path=/a';
    document.cookie = 'pathB=b; Path=/a/b';
    document.cookie = 'secureCookie=secure; Secure; Path=/';
    expectCookies(
      'domainCookie=shared',
      'hostOnly=one',
      'pathA=a',
      'pathB=b',
      'root=root',
      'secureCookie=secure',
    );

    history.pushState(null, '', '/a/other');
    expectCookies(
      'domainCookie=shared',
      'hostOnly=one',
      'pathA=a',
      'root=root',
      'secureCookie=secure',
    );
    history.pushState(null, '', '/other');
    expectCookies(
      'domainCookie=shared',
      'hostOnly=one',
      'root=root',
      'secureCookie=secure',
    );

    location.href = 'http://sub.example.test/a/b/page';
    expectCookies(
      'domainCookie=shared',
      'hostOnly=one',
      'pathA=a',
      'pathB=b',
      'root=root',
    );
    document.cookie = 'insecureSecure=ignored; Secure; Path=/';
    assert(!cookies().includes('insecureSecure=ignored'));

    location.href = 'https://sub.example.test/a/b/page';
    assert(cookies().includes('secureCookie=secure'));
    assert(!cookies().includes('insecureSecure=ignored'));

    document.cookie = 'deleteByAge=first; Path=/';
    document.cookie = 'deleteByAge=second; Path=/; Max-Age=0';
    document.cookie = 'deleteByExpiry=first; Path=/';
    document.cookie = 'deleteByExpiry=second; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT';
    document.cookie = 'maxAgeWins=first; Path=/; Max-Age=0; Expires=Wed, 31 Dec 2999 23:59:59 GMT';
    document.cookie = 'futureExpiry=live; Path=/; Expires=Wed, 31 Dec 2999 23:59:59 GMT';
    assert(!cookies().includes('deleteByAge=second'));
    assert(!cookies().includes('deleteByExpiry=second'));
    assert(!cookies().includes('maxAgeWins=first'));
    assert(cookies().includes('futureExpiry=live'));
  `,
], { status: 0, stderr: '' });

spawnSyncAndAssert(process.execPath, [
  '-e',
  `
    (async () => {
      const assert = require('node:assert');
      const { install } = require('node:browser-env');
      const lifecycleState = {};
      install({
        browserEnvLifecycleState: lifecycleState,
        url: 'https://example.test/page?x=1',
        html: '<html><head><!--[if lt IE 9]><script>hidden-script</script><![endif]--><meta id="challenge" content="initial-content"><script src="/challenge.js">initial-script</script></head><body><form id="form"><input name="token" value="initial"></form></body></html>',
        navigator: { userAgent: 'Mozilla/5.0 ModeTest' },
      });

      assert.strictEqual(window.innerWidth, 1920);
      assert.strictEqual(window.outerHeight, 1080);
      assert.strictEqual(screen.orientation.type, 'landscape-primary');
      assert.strictEqual(location.ancestorOrigins.length, 0);
      assert.strictEqual(clientInformation, navigator);
      assert.strictEqual(navigator.appName, 'Netscape');
      assert.strictEqual(navigator.appVersion, '5.0 ModeTest');
      assert.strictEqual(navigator.connection.effectiveType, '4g');
      assert(navigator.connection instanceof NetworkInformation);
      assert.strictEqual(Object.prototype.toString.call(navigator.connection), '[object NetworkInformation]');
      assert.deepStrictEqual(Object.keys(navigator.connection), []);
      assert.deepStrictEqual(Reflect.ownKeys(navigator.connection), []);
      const webdriverDescriptor = Object.getOwnPropertyDescriptor(Navigator.prototype, 'webdriver');
      assert.strictEqual(webdriverDescriptor.configurable, true);
      assert.strictEqual(webdriverDescriptor.enumerable, true);
      assert.strictEqual(webdriverDescriptor.get.name, 'get webdriver');
      assert.deepStrictEqual(Reflect.ownKeys(webdriverDescriptor.get), ['length', 'name']);
      const downlinkDescriptor = Object.getOwnPropertyDescriptor(NetworkInformation.prototype, 'downlink');
      assert.strictEqual(downlinkDescriptor.get.name, 'get downlink');
      assert.deepStrictEqual(Reflect.ownKeys(downlinkDescriptor.get), ['length', 'name']);
      assert.strictEqual(navigator.mimeTypes.length, 2);
      assert.strictEqual(navigator.mimeTypes.namedItem('application/pdf').suffixes, 'pdf');
      assert(navigator.plugins instanceof PluginArray);
      assert.strictEqual(Object.prototype.toString.call(navigator.plugins), '[object PluginArray]');
      assert.deepStrictEqual(Object.keys(navigator.plugins), ['0', '1', '2', '3', '4']);
      const pdfPlugin = navigator.plugins.namedItem('PDF Viewer');
      assert(pdfPlugin instanceof Plugin);
      assert.strictEqual(Object.prototype.toString.call(pdfPlugin), '[object Plugin]');
      assert.strictEqual(pdfPlugin.length, 2);
      assert.strictEqual(navigator.mimeTypes[0].enabledPlugin, pdfPlugin);
      assert.strictEqual(
        typeof Object.getOwnPropertyDescriptor(Navigator.prototype, 'sendBeacon').value,
        'function',
      );
      assert.strictEqual(
        typeof Object.getOwnPropertyDescriptor(Navigator.prototype, 'getBattery').value,
        'function',
      );
      assert.strictEqual(navigator.sendBeacon('/beacon', 'body'), true);
      assert.strictEqual(String(navigator.getBattery), 'function getBattery() { [native code] }');
      const battery = await navigator.getBattery();
      assert(battery instanceof BatteryManager);
      assert.strictEqual(Object.prototype.toString.call(battery), '[object BatteryManager]');
      assert.strictEqual(battery.charging, true);

      assert(document instanceof Document);
      assert(document.body instanceof HTMLElement);
      assert(document.createTextNode('text') instanceof Text);
      const inputs = document.getElementsByTagName('input');
      assert.strictEqual(Object.prototype.toString.call(inputs), '[object HTMLCollection]');
      assert(inputs instanceof HTMLCollection);
      assert.strictEqual(inputs.constructor, HTMLCollection);
      assert.deepStrictEqual(Object.keys(inputs), ['0']);
      assert.strictEqual(Object.prototype.toString.call(document), '[object HTMLDocument]');
      assert.strictEqual(Object.prototype.toString.call(document.head), '[object HTMLHeadElement]');
      assert.strictEqual(Object.prototype.toString.call(document.body), '[object HTMLBodyElement]');
      assert.deepStrictEqual(Object.keys(document), ['location']);
      assert.deepStrictEqual(Object.keys(document.body), []);
      assert.deepStrictEqual(Object.keys(navigator.mimeTypes), ['0', '1']);
      assert.strictEqual(
        Object.prototype.toString.call(navigator.webkitPersistentStorage),
        '[object DeprecatedStorageQuota]',
      );
      const expression = document.createExpression('//*', null);
      assert(expression instanceof XPathExpression);
      assert.strictEqual(expression.constructor, XPathExpression);
      assert.strictEqual(Object.prototype.toString.call(expression), '[object XPathExpression]');
      assert.deepStrictEqual(Object.getOwnPropertyNames(expression), []);
      assert.throws(() => new XPathExpression(), /Illegal constructor/);

      const anchor = document.createElement('a');
      assert.strictEqual(anchor.href, '');
      assert.strictEqual(anchor.protocol, ':');
      anchor.href = '/next?q=1#hash';
      assert(anchor instanceof HTMLAnchorElement);
      assert.strictEqual(anchor.href, 'https://example.test/next?q=1#hash');
      assert.strictEqual(anchor.host, 'example.test');

      const div = document.createElement('div');
      assert(div instanceof HTMLDivElement);
      assert.strictEqual(div.constructor, HTMLDivElement);
      assert.strictEqual(Object.prototype.toString.call(div), '[object HTMLDivElement]');
      assert.strictEqual(String(div.getAttribute), 'function getAttribute() { [native code] }');

      const iframe = document.createElement('iframe');
      assert(iframe instanceof HTMLIFrameElement);
      assert.strictEqual(iframe.constructor, HTMLIFrameElement);
      assert.strictEqual(Object.prototype.toString.call(iframe), '[object HTMLIFrameElement]');
      assert.strictEqual(iframe.contentDocument, null);
      assert.strictEqual(iframe.contentWindow, null);
      assert.strictEqual(String(location.assign), 'function assign() { [native code] }');

      const meta = document.querySelector('#challenge');
      assert(meta instanceof HTMLMetaElement);
      assert.strictEqual(Object.prototype.toString.call(meta), '[object HTMLMetaElement]');
      assert.strictEqual(meta.content, 'initial-content');
      meta.content = 'updated-content';
      assert.strictEqual(meta.getAttribute('content'), 'updated-content');
      const script = document.querySelector('script');
      assert(script instanceof HTMLScriptElement);
      assert.strictEqual(Object.prototype.toString.call(script), '[object HTMLScriptElement]');
      assert.strictEqual(script.innerText, 'initial-script');
      script.innerText = 'updated-script';
      assert.strictEqual(script.textContent, 'updated-script');
      assert.strictEqual(script.src, 'https://example.test/challenge.js');
      assert.strictEqual(document.getElementsByTagName('script').length, 1);

      const form = document.querySelector('#form');
      assert(form instanceof HTMLFormElement);
      assert.strictEqual(form.elements.namedItem('token').value, 'initial');
      assert.strictEqual(form.token, form.elements.namedItem('token'));

      const namedForm = document.createElement('form');
      const actionInput = document.createElement('input');
      actionInput.name = 'action';
      const textContentInput = document.createElement('input');
      textContentInput.name = 'textContent';
      const innerTextInput = document.createElement('input');
      innerTextInput.id = 'innerText';
      namedForm.appendChild(actionInput);
      namedForm.appendChild(textContentInput);
      namedForm.appendChild(innerTextInput);
      assert.strictEqual(namedForm.action, actionInput);
      assert.strictEqual(namedForm.textContent, textContentInput);
      assert.strictEqual(namedForm.innerText, innerTextInput);
      assert.deepStrictEqual(Object.getOwnPropertyDescriptor(namedForm, 'action'), {
        configurable: true,
        enumerable: false,
        value: actionInput,
        writable: false,
      });
      actionInput.name = 'replacement';
      assert.strictEqual(namedForm.action, 'https://example.test/page?x=1');
      assert.strictEqual(namedForm.replacement, actionInput);
      namedForm.removeChild(textContentInput);
      assert.strictEqual(namedForm.textContent, '');
      const elementsInput = document.createElement('input');
      elementsInput.name = 'elements';
      namedForm.appendChild(elementsInput);
      assert.strictEqual(namedForm.elements, elementsInput);
      elementsInput.name = 'namedElements';
      assert(namedForm.elements instanceof HTMLCollection);
      assert.strictEqual(namedForm.namedElements, elementsInput);
      const parserHost = document.createElement('div');
      parserHost.innerHTML = '<form id="clobbered"><input name="appendChild">' +
        '<input name="childNodes"><input name="afterClobber"></form>';
      const clobbered = parserHost.querySelector('#clobbered');
      assert(clobbered.appendChild instanceof HTMLInputElement);
      assert(clobbered.childNodes instanceof HTMLInputElement);
      assert.strictEqual(clobbered.afterClobber.name, 'afterClobber');
      const afterClobber = document.createElement('input');
      afterClobber.name = 'afterMutation';
      Node.prototype.appendChild.call(clobbered, afterClobber);
      assert.strictEqual(clobbered.afterMutation, afterClobber);

      const timerResult = await new Promise((resolve) => {
        const timerId = setTimeout(function callback(value) {
          resolve({ id: timerId, receiver: this, value });
        }, 0, 'timer-value');
        assert.strictEqual(typeof timerId, 'number');
        assert.strictEqual(String(setTimeout), 'function setTimeout() { [native code] }');
      });
      assert.strictEqual(timerResult.receiver, window);
      assert.strictEqual(timerResult.value, 'timer-value');
      let cancelled = false;
      const cancelledId = setTimeout(() => { cancelled = true; }, 0);
      clearTimeout(cancelledId);
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.strictEqual(cancelled, false);
      const intervalId = await new Promise((resolve) => {
        const id = setInterval(() => {
          clearInterval(id);
          resolve(id);
        }, 0);
        assert.strictEqual(typeof id, 'number');
      });
      assert.strictEqual(typeof intervalId, 'number');

      const canvas = document.createElement('canvas');
      assert(canvas instanceof HTMLCanvasElement);
      const context = canvas.getContext('2d');
      assert(context instanceof CanvasRenderingContext2D);
      context.fillStyle = 'red';
      context.fillRect(0, 0, 1, 1);
      const image = context.getImageData(0, 0, 1, 1);
      assert.deepStrictEqual([...image.data], [255, 0, 0, 255]);
      assert.strictEqual(Object.prototype.toString.call(image), '[object ImageData]');
      assert.strictEqual(canvas.toDataURL(), 'data:,');

      const parsed = new DOMParser().parseFromString('<html><body><p id="parsed">ok</p></body></html>', 'text/html');
      assert(parsed instanceof Document);
      assert.strictEqual(parsed.querySelector('#parsed').textContent, 'ok');

      const xhr = new XMLHttpRequest();
      const states = [];
      xhr.addEventListener('readystatechange', () => states.push(xhr.readyState));
      xhr.open('POST', '/challenge');
      xhr.setRequestHeader('x-test', 'yes');
      xhr.send('payload');
      assert.deepStrictEqual(states, [XMLHttpRequest.OPENED, XMLHttpRequest.DONE]);
      assert.strictEqual(xhr.status, 0);
      assert.strictEqual(xhr.responseURL, 'https://example.test/challenge');
      assert.strictEqual(window.encode_url, '/challenge');
      assert.strictEqual(window.encode_data, 'payload');

      let observed = false;
      const observer = new MutationObserver(() => { observed = true; });
      observer.observe(document.body, { childList: true });
      assert.strictEqual(observer.takeRecords().length, 0);
      observer.disconnect();
      assert.strictEqual(observed, false);
      const databaseEvents = [];
      const databaseRequest = indexedDB.open('mode-test');
      assert(databaseRequest instanceof IDBOpenDBRequest);
      assert.strictEqual(Object.prototype.toString.call(databaseRequest), '[object IDBOpenDBRequest]');
      assert.strictEqual(databaseRequest.readyState, 'pending');
      databaseEvents.push('after-open');
      let objectStoreNames;
      databaseRequest.onupgradeneeded = () => {
        databaseRequest.result.createObjectStore('later');
        databaseRequest.result.createObjectStore('first', { keyPath: 'name' });
        objectStoreNames = databaseRequest.result.objectStoreNames;
        databaseEvents.push('upgrade');
      };
      databaseRequest.onsuccess = () => databaseEvents.push('success');
      await Promise.resolve();
      databaseEvents.push('microtask');
      await lifecycleState.waitForBrowserTasks();
      assert.deepStrictEqual(databaseEvents, ['after-open', 'microtask', 'upgrade', 'success']);
      assert.strictEqual(databaseRequest.readyState, 'done');
      assert(databaseRequest.result instanceof IDBDatabase);
      assert.strictEqual(databaseRequest.result.name, 'mode-test');
      assert(objectStoreNames instanceof DOMStringList);
      assert.strictEqual(Object.prototype.toString.call(objectStoreNames), '[object DOMStringList]');
      assert.deepStrictEqual(Object.keys(objectStoreNames), ['0', '1']);
      assert.strictEqual(objectStoreNames.length, 2);
      assert.strictEqual(objectStoreNames.item(0), 'first');
      assert.strictEqual(objectStoreNames.contains('later'), true);
      assert.strictEqual(objectStoreNames.contains('missing'), false);
      const objectStore = databaseRequest.result.transaction(['first'], 'readwrite').objectStore('first');
      assert(objectStore instanceof IDBObjectStore);
      assert.strictEqual(Object.prototype.toString.call(objectStore), '[object IDBObjectStore]');
      const putRequest = objectStore.put({ name: 'key', vlaue: 'stored' });
      assert(putRequest instanceof IDBRequest);
      assert.strictEqual(Object.prototype.toString.call(putRequest), '[object IDBRequest]');
      await new Promise((resolve, reject) => {
        putRequest.onerror = () => reject(putRequest.error);
        putRequest.onsuccess = (event) => {
          assert.strictEqual(event.target, putRequest);
          resolve();
        };
      });
      const getRequest = databaseRequest.result.transaction(['first']).objectStore('first').get('key');
      const storedRecord = await new Promise((resolve, reject) => {
        getRequest.onerror = () => reject(getRequest.error);
        getRequest.onsuccess = (event) => {
          assert.strictEqual(event.target, getRequest);
          resolve(event.target.result);
        };
      });
      assert.strictEqual(storedRecord.vlaue, 'stored');
      assert.strictEqual(chrome.app.isInstalled, false);
      assert.strictEqual(typeof chrome.loadTimes, 'function');
      assert.strictEqual(msCrypto, globalThis.crypto);
      assert.strictEqual(typeof msCrypto.getRandomValues, 'function');
      assert.strictEqual(window.open('https://example.test/').closed, false);
      assert.strictEqual(window.prompt('question'), null);
      assert.strictEqual(typeof webkitRequestFileSystem, 'function');

      assert.strictEqual(document.all[0], document.documentElement);
      assert.strictEqual(document.all.form, form);
    })().catch((error) => {
      console.error(error.stack);
      process.exitCode = 1;
    });
  `,
], { status: 0, stderr: '' });

spawnSyncAndAssert(process.execPath, [
  '-e',
  `
    const assert = require('node:assert');
    const { install } = require('node:browser-env');
    const lifecycleState = {};
    install({
      browserEnvLifecycleState: lifecycleState,
      browserEnvManualTimerScheduling: true,
      url: 'https://example.test/',
    });
    const events = [];
    const cancelled = setTimeout(() => events.push('cancelled'), 0);
    clearTimeout(cancelled);
    setTimeout(() => {
      events.push('outer');
      setTimeout(() => events.push('inner'), 0);
    }, 0);
    setTimeout(() => events.push('delayed'), 1);
    assert.strictEqual(lifecycleState.runNextImmediateBrowserTimer(), true);
    assert.strictEqual(lifecycleState.runNextImmediateBrowserTimer(), true);
    assert.strictEqual(lifecycleState.runNextImmediateBrowserTimer(), false);
    assert.deepStrictEqual(events, ['outer', 'inner']);
  `,
], { status: 0, stderr: '' });

spawnSyncAndAssert(process.execPath, [
  '--expose-internals',
  '-e',
  `
    const assert = require('node:assert');
    const { install } = require('node:browser-env');
    install({ url: 'https://example.test/', hideNodeGlobals: true });
    assert.deepStrictEqual(
      new Function('return [typeof Buffer, typeof global, typeof process, typeof require, typeof module, typeof exports, typeof __dirname, typeof __filename, typeof setImmediate, typeof clearImmediate, typeof internalBinding, typeof primordials].join(\",\")')(),
      'function,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined',
    );
    assert.strictEqual(typeof Buffer, 'function');
    assert.strictEqual(Buffer.from('mode').toString(), 'mode');
    assert.strictEqual(typeof WebSocket, 'function');
    assert.deepStrictEqual(
      Object.getOwnPropertyNames(WebSocket),
      ['length', 'name', 'prototype', 'CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'],
    );
    assert.strictEqual(Object.getOwnPropertyDescriptor(WebSocket, 'toString'), undefined);
    assert.strictEqual(WebSocket.prototype.constructor, WebSocket);
    assert.deepStrictEqual(
      Object.getOwnPropertyNames(WebSocket.prototype),
      [
        'constructor', 'url', 'readyState', 'bufferedAmount', 'extensions',
        'protocol', 'onopen', 'onerror', 'onclose', 'onmessage', 'binaryType',
        'CONNECTING', 'OPEN', 'CLOSING', 'CLOSED', 'close', 'send',
      ],
    );
    assert.strictEqual(Object.prototype.toString.call(WebSocket.prototype), '[object WebSocket]');
    assert.match(Function.prototype.toString.call(WebSocket), /native code/);
    const socket = new WebSocket('wss://example.test/');
    assert.strictEqual(socket.readyState, WebSocket.CONNECTING);
    assert.throws(() => WebSocket('wss://example.test/'), /new/);
    assert.deepStrictEqual(Object.getOwnPropertyNames(Request), ['length', 'name', 'prototype']);
    assert.strictEqual(Object.getOwnPropertyDescriptor(Request, 'toString'), undefined);
    assert.strictEqual(Request.prototype.constructor, Request);
    assert.strictEqual(Object.prototype.toString.call(Request.prototype), '[object Request]');
    assert.match(Function.prototype.toString.call(Request), /native code/);
    const request = new Request('https://example.test/path', { method: 'post' });
    assert.strictEqual(request.method, 'POST');
    assert.strictEqual(request.url, 'https://example.test/path');
    assert.throws(() => Request('https://example.test/'), /new/);
    for (const name of [
      'global', 'process', 'require', 'module', 'exports',
      '__dirname', '__filename', 'setImmediate', 'clearImmediate',
      'internalBinding', 'primordials', 'assert', 'async_hooks', 'buffer',
      'child_process', 'cluster', 'constants', 'dgram',
      'diagnostics_channel', 'dns', 'domain', 'events', 'fs', 'http',
      'http2', 'https', 'net', 'os', 'path', 'perf_hooks', 'punycode',
      'querystring', 'readline', 'repl', 'stream', 'string_decoder', 'sys',
      'timers', 'tls', 'trace_events', 'tty', 'url', 'util', 'v8', 'vm',
      'wasi', 'worker_threads', 'zlib', 'node:sea', 'node:sqlite',
      'node:test',
    ]) {
      assert.strictEqual(Object.getOwnPropertyDescriptor(globalThis, name), undefined);
    }
    assert.deepStrictEqual(
      Reflect.ownKeys(globalThis).map(String).filter((name) => name.startsWith('Symbol(undici.')),
      [],
    );
  `,
], { status: 0, stderr: '' });

spawnSyncAndAssert(process.execPath, [
  '--expose-internals',
  '-e',
  `
    const nodeProcess = process;
    (async () => {
      const assert = require('node:assert');
      const { install } = require('node:browser-env');
      install({ url: 'https://example.test/', hideNodeGlobals: true });
      assert.strictEqual(typeof Buffer, 'function');
      const response = await fetch('data:text/plain,mode-probe');
      assert.strictEqual(response.status, 200);
      assert.strictEqual(await response.text(), 'mode-probe');
    })().catch((error) => {
      console.error(error.stack);
      nodeProcess.exitCode = 1;
    });
  `,
], { status: 0, stderr: '' });

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
      () => install({ url: 'https://example.test/', document: { properties: { currentScript: null } } }),
      /protected browser environment property/,
    );
    assert.throws(
      () => install({ url: 'https://example.test/', document: { descriptors: { readyState: { value: 'loading' } } } }),
      /protected browser environment property/,
    );
    assert.throws(
      () => install({ url: 'https://example.test/', window: { properties: { location: null } } }),
      /protected browser environment property/,
    );
    assert.throws(
      () => install({ url: 'https://example.test/', window: { properties: { setTimeout: null } } }),
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
