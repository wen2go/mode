# Mode rs_env compatibility server

`rs_mode_server` keeps the existing local `POST /rs_env` protocol while running
challenge JavaScript in Mode's native `node:browser-env` runtime. It does not
read, append, or execute `env.js`.

## Start

From the Mode source checkout, start it with the locally built binary:

```sh
out/Release/node rs_mode_server/server.js
```

After installing a Mode release, use the release command instead:

```sh
mode rs_mode_server/server.js
```

It listens on `127.0.0.1:8080` by default. Set `RS_MODE_HOST` or `RS_JS_PORT`
before launching to change the bind address or port.

## API

`GET /health` returns:

```json
{"status":"ok"}
```

`POST /rs_env` accepts the same body used by the previous Python client:

```json
{
  "html": "<html>...</html>",
  "url": "https://example.test/page",
  "ua": "Mozilla/5.0 ..."
}
```

On success, it returns the Cookie object set by the challenge. Invalid requests,
missing challenge markers or scripts, external-script errors, and worker timeouts
return HTTP 500 with `{}`.

Each request executes in its own Worker. The Worker installs a fresh Mode browser
environment with the supplied URL, original HTML, dynamic user agent, DOM,
`document.all`, location/history, cookies, Storage, event interfaces, DOMParser,
basic XHR state transitions, base navigator values (including connection,
mimeTypes, battery, and beacon APIs), screen dimensions, window dimensions, and
hidden document visibility. The Worker also removes the Node-only global aliases
`global`, `process`, `Buffer`, `require`, `module`, `exports`, `__dirname`,
`__filename`, `setImmediate`, and `clearImmediate`; challenge code is evaluated
without a CommonJS `require` parameter. External `r="m"` scripts are cached
under `out_js/`; the cache is ignored by Git.

## Strict compatibility boundary

This service intentionally provides only the Mode browser environment. Its XHR
implementation records `open()` and `send()` arguments without making a network
request; Node's built-in `fetch` retains its normal behavior. The Canvas surface
is deterministic and has no renderer or pixel fingerprint. WebGL, site-specific
prebuilt challenge DOM, form hacks, and native `toString` spoofing are not
implemented.

## Tests

The test suite uses only local, sanitized HTML and external-JS fixtures:

```sh
out/Release/node --test rs_mode_server/test/server.test.js
```
