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
missing challenge markers or scripts, external-script errors, unsupported browser
interfaces, and worker timeouts return HTTP 500 with `{}`.

Each request executes in its own Worker. The Worker installs a fresh Mode browser
environment with the supplied URL, original HTML, dynamic user agent, DOM,
`document.all`, location/history, cookies, Storage, event interfaces, base
navigator values, screen dimensions, window dimensions, and hidden document
visibility. External `r="m"` scripts are cached under `out_js/`; the cache is
ignored by Git.

## Strict compatibility boundary

This service intentionally provides only the Mode browser environment. It does
not emulate the old `env.js` fallback surface, including fake XHR/fetch responses,
Canvas/WebGL, `chrome`, `mimeTypes`, battery APIs, form hacks, or native
`toString` spoofing. A challenge that depends on one of these missing APIs fails
with the normal HTTP 500 response instead of silently mixing environments.

## Tests

The test suite uses only local, sanitized HTML and external-JS fixtures:

```sh
out/Release/node --test rs_mode_server/test/server.test.js
```
