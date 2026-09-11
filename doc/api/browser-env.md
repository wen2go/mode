# Browser environment

<!--introduced_in=REPLACEME-->

<!-- YAML
added: REPLACEME
-->

> Stability: 1 - Experimental

<!-- source_link=lib/browser-env.js -->

The `node:browser-env` module installs a browser-compatible global environment
in the current Realm. It provides a lightweight DOM tree, virtual navigation,
profiled `navigator` and `screen` values, in-memory storage, and a native
`document.all` implementation. It does not provide rendering, layout, Canvas,
WebGL, real page navigation, or automatic execution of scripts in HTML.

```cjs
const { install } = require('node:browser-env');

install({
  url: 'https://example.test/page',
  html: '<main id="app">Hello</main>',
  navigator: { platform: 'Win32', languages: ['zh-CN', 'zh'] },
  window: { properties: { customFlag: true } },
  document: { properties: { visibilityState: 'hidden' } },
});

console.log(document.querySelector('#app').textContent);
```

```mjs
import { install } from 'node:browser-env';

install({ url: 'https://example.test/' });
```

## `browserEnv.install(options)`

Installs the environment in the current Realm and returns
`{ window, document, navigator, location }`. It must be called before loading
code that reads browser globals. It throws if the Realm already has an
installed browser environment.

* `options` {Object}
  * `url` {string} Required initial URL. `location.href` is also accepted for
    JSON profile compatibility.
  * `html` {string} Optional initial HTML. Scripts in this HTML are not run.
  * `navigator` {Object} Optional overrides for browser identity fields such
    as `userAgent`, `platform`, `language`, and `languages`.
  * `screen` {Object} Optional screen-dimension overrides.
  * `cookies` {string|Object} Optional initial in-memory cookies.
  * `localStorage` {Object} Optional initial local storage values.
  * `sessionStorage` {Object} Optional initial session storage values.
  * `hideNodeGlobals` {boolean} When `true`, removes the configurable Node-only
    global aliases `global`, `process`, `Buffer`, `require`, `module`,
    `exports`, `__dirname`, `__filename`, `setImmediate`, and `clearImmediate`
    from this Realm after installation. Use it when browser challenge code is
    evaluated through a separate function; it is `false` by default so normal
    Mode scripts retain their Node entry points.
  * `window.properties` {Object} Optional ordinary custom global properties.
  * `window.descriptors` {Object} Optional custom property descriptors.
  * `document.properties` {Object} Optional ordinary custom document
    properties.
  * `document.descriptors` {Object} Optional custom document property
    descriptors.

Core browser-environment properties, including `document.all`, DOM methods,
`location`, `navigator`, and the `window` identity aliases cannot be replaced
through `properties` or `descriptors`.

## `browserEnv.isInstalled()`

Returns `true` when `install()` or `--browser-env-profile` has installed the
environment in the current Realm.

## `--browser-env-profile=file`

The command-line option loads the same `options` shape from a JSON file before
user code executes:

```json
{
  "url": "https://example.test/",
  "html": "<main id=\"app\"></main>",
  "navigator": { "platform": "Win32" }
}
```

The CLI profile is applied independently in each Node Realm that starts with
the option. Programmatic installation applies only to the Realm that calls
`install()`.
