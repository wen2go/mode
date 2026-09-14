'use strict';

// Executes the browser environment JavaScript from the working tree without
// rebuilding Node. The running Mode binary supplies only the native
// `document.all` binding; `lib/internal/browser_env.js` is loaded from disk.
//
// Run with a previously built Mode binary:
//   mode --expose-internals tools/browser-env-source-runner.js \
//     js_reverse_cache/.../first_412.html --deterministic
// Add --trace only when inspecting DOM calls. Add --read-trace to identify
// environment-property reads. Both modes use Proxy instrumentation and are
// deliberately not part of the production-equivalent default execution.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { internalBinding, primordials } = require('internal/test/binding');
const nodeProcess = process;

const [htmlPath, ...arguments_] = nodeProcess.argv.slice(2);
const flags = new Set();
const runtimeOptions = {
  outJsPath: undefined,
  platform: 'Win32',
  ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
    + '(KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
  url: 'https://etax.qingdao.chinatax.gov.cn:8443/',
  windowMetrics: {
    innerHeight: 1080,
    innerWidth: 1920,
    outerHeight: 1080,
    outerWidth: 1920,
    screenLeft: 0,
    screenTop: 0,
    screenX: 0,
    screenY: 0,
  },
};

function readOptionValue(index, name) {
  const value = arguments_[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function parseWindowMetrics(value) {
  const values = value.split(',').map((part) => Number(part));
  if (values.length !== 4 || values.some((item) => !Number.isFinite(item))) {
    throw new Error('--window-metrics must be innerWidth,innerHeight,outerWidth,outerHeight');
  }
  return {
    ...runtimeOptions.windowMetrics,
    innerWidth: values[0],
    innerHeight: values[1],
    outerWidth: values[2],
    outerHeight: values[3],
  };
}

for (let index = 0; index < arguments_.length; index++) {
  const argument = arguments_[index];
  if (argument === '--deterministic' || argument === '--trace' || argument === '--read-trace' ||
      argument === '--without-buffer' || argument === '--without-mark-resource-timing') {
    flags.add(argument);
    continue;
  }
  if (argument === '--url') {
    runtimeOptions.url = readOptionValue(index, argument);
    index++;
    continue;
  }
  if (argument === '--ua') {
    runtimeOptions.ua = readOptionValue(index, argument);
    index++;
    continue;
  }
  if (argument === '--platform') {
    runtimeOptions.platform = readOptionValue(index, argument);
    index++;
    continue;
  }
  if (argument === '--out-js') {
    runtimeOptions.outJsPath = readOptionValue(index, argument);
    index++;
    continue;
  }
  if (argument === '--window-metrics') {
    runtimeOptions.windowMetrics = parseWindowMetrics(readOptionValue(index, argument));
    index++;
    continue;
  }
  throw new Error(`unknown option: ${argument}`);
}

if (!htmlPath) {
  throw new Error('usage: mode --expose-internals tools/browser-env-source-runner.js <challenge.html> [--deterministic] [--trace] [--read-trace] [--without-buffer] [--without-mark-resource-timing] [--url URL] [--ua USER_AGENT] [--platform PLATFORM] [--window-metrics innerWidth,innerHeight,outerWidth,outerHeight] [--out-js PATH]');
}

const root = path.resolve(__dirname, '..');
const { platform, ua, url, windowMetrics } = runtimeOptions;
const html = fs.readFileSync(htmlPath, 'utf8');

function loadBrowserEnvironmentFromSource() {
  const sourcePath = path.join(root, 'lib', 'internal', 'browser_env.js');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const module = { exports: {} };
  const factory = vm.runInThisContext(
    `(function(exports, module, require, primordials, internalBinding) {\n${source}\n})`,
    { filename: sourcePath },
  );
  factory(module.exports, module, require, primordials, internalBinding);
  return module.exports;
}

function parseAttributes(source) {
  const attributes = {};
  const matcher = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;
  while ((match = matcher.exec(source)) !== null) {
    attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? '';
  }
  return attributes;
}

function parseChallenge(source) {
  const metas = Array.from(source.matchAll(/<meta\b([^>]*)>/gi), (match) => parseAttributes(match[1]));
  const scripts = Array.from(source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi), (match) => ({
    attributes: parseAttributes(match[1]),
    content: match[2],
  }));
  const meta = metas.find((tag) => tag.r === 'm');
  const inline = scripts.find((tag) => tag.attributes.r === 'm' && !tag.attributes.src && tag.content.includes('$_'));
  const external = scripts.find((tag) => tag.attributes.r === 'm' && tag.attributes.src);
  if (!meta || !inline || !external) throw new Error('missing r=m challenge parts');
  return { external: external.attributes.src, inline: inline.content };
}

function deterministicPrelude() {
  if (!flags.has('--deterministic')) return '';
  return `
    var __modeSeed = 0x13579bdf;
    Math.random = function random() {
      __modeSeed = (__modeSeed * 1664525 + 1013904223) >>> 0;
      return __modeSeed / 0x100000000;
    };
    var __modeRealDate = Date;
    var __modeTime = 1700000000000;
    Date = function Date() {
      if (!new.target) return __modeRealDate();
      return arguments.length ? Reflect.construct(__modeRealDate, arguments) : new __modeRealDate(__modeTime++);
    };
    Date.now = function now() { return __modeTime++; };
    Date.parse = __modeRealDate.parse;
    Date.UTC = __modeRealDate.UTC;
    Date.prototype = __modeRealDate.prototype;
  `;
}

function environmentOverridePrelude() {
  let source = '';
  if (flags.has('--without-buffer')) source += 'delete globalThis.Buffer;\n';
  if (flags.has('--without-mark-resource-timing')) {
    source += `
      for (var __modePerformancePrototype = performance;
           __modePerformancePrototype;
           __modePerformancePrototype = Object.getPrototypeOf(__modePerformancePrototype)) {
        var __modeMarkResourceTimingDescriptor =
          Object.getOwnPropertyDescriptor(__modePerformancePrototype, 'markResourceTiming');
        if (__modeMarkResourceTimingDescriptor) {
          if (__modeMarkResourceTimingDescriptor.configurable) {
            delete __modePerformancePrototype.markResourceTiming;
          }
          break;
        }
      }
    `;
  }
  return source;
}

function cookieSummary(cookieHeader) {
  return String(cookieHeader).split(';').flatMap((part) => {
    const separator = part.indexOf('=');
    if (separator <= 0) return [];
    const value = part.slice(separator + 1).trim();
    let hash = 2166136261;
    for (let index = 0; index < value.length; index++) {
      hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
    }
    return [{
      name: part.slice(0, separator).trim(),
      valueHash: (hash >>> 0).toString(16),
      valueLength: value.length,
    }];
  });
}

const traceEnabled = flags.has('--trace');
const readTraceEnabled = flags.has('--read-trace');
const hook = traceEnabled ?
  fs.readFileSync(path.join(root, 'js_reverse_cache', 'compare_browser_env_hook.js'), 'utf8') : '';
const readTracer = readTraceEnabled ? `
  var __modeReadTrace = (function() {
    var reads = [];
    var roots = {};
    ['window', 'document', 'navigator', 'location', 'screen', 'Math', 'crypto',
      'performance', 'history', 'localStorage', 'sessionStorage', 'indexedDB']
      .forEach(function(name) { roots[name] = globalThis[name]; });
    var proxies = new WeakMap();
    function rootName(value) {
      for (var name in roots) if (roots[name] === value) return name;
      return null;
    }
    function traceRoot(target, name) {
      if (!target || (typeof target !== 'object' && typeof target !== 'function')) return target;
      var existing = proxies.get(target);
      if (existing) return existing;
      var proxy;
      proxy = new Proxy(target, {
        get: function(target, key) {
          if (key === '__modeTraceRaw') return target;
          if (typeof key !== 'symbol') reads.push(name + '.' + String(key));
          var value = Reflect.get(target, key, target);
          var nestedName = rootName(value);
          if (nestedName) return traceRoot(value, nestedName);
          if (name === 'document' && key === 'getElementById' && typeof value === 'function') {
            return function() {
              var result = Reflect.apply(value, target, arguments);
              return traceRoot(result, name + '.getElementById(' + String(arguments[0]) + ')');
            };
          }
          if (key === 'removeChild' && typeof value === 'function') {
            return function(child) {
              return Reflect.apply(value, target, [child && child.__modeTraceRaw || child]);
            };
          }
          if (key === 'parentNode') return traceRoot(value, name + '.parentNode');
          return value;
        },
        has: function(target, key) {
          if (typeof key !== 'symbol') reads.push(name + '.has:' + String(key));
          return Reflect.has(target, key);
        },
      });
      proxies.set(target, proxy);
      return proxy;
    }
    function replaceGlobal(name) {
      Object.defineProperty(globalThis, name, {
        configurable: true,
        enumerable: true,
        value: traceRoot(globalThis[name], name),
        writable: true,
      });
    }
    Object.keys(roots).forEach(replaceGlobal);
    return { dump: function() { return reads; } };
  })();
` : '';
const challenge = parseChallenge(html);
const fileName = path.basename(new URL(challenge.external, url).pathname);
const outJsPath = runtimeOptions.outJsPath ?? path.join(root, 'rs_mode_server', 'out_js', fileName);
const outJs = fs.readFileSync(outJsPath, 'utf8');
const { install } = loadBrowserEnvironmentFromSource();

install({
  url,
  html,
  hideNodeGlobals: true,
  navigator: {
    appName: 'Netscape',
    appVersion: ua.replace(/^Mozilla\//, ''),
    language: 'zh-CN',
    languages: ['zh-CN', 'zh'],
    maxTouchPoints: 0,
    platform,
    userAgent: ua,
    vendor: 'Google Inc.',
    webdriver: false,
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
      ...windowMetrics,
    },
  },
  document: { properties: { visibilityState: 'hidden' } },
});

const originalConsole = globalThis.console;
globalThis.console = { debug() {}, error() {}, info() {}, log() {}, warn() {} };
try {
  const result = new Function(`${deterministicPrelude()}\n${environmentOverridePrelude()}\n${hook}\n${readTracer}\n${challenge.inline}\n${outJs}
    const result = {
      label: 'source',
      source: 'lib/internal/browser_env.js',
      traceEnabled: ${traceEnabled},
      runtimeProfile: {
        platform: ${JSON.stringify(platform)},
        url: ${JSON.stringify(url)},
        userAgent: ${JSON.stringify(ua)},
      },
      nodeGlobals: {
      Buffer: typeof Buffer,
      clearImmediate: typeof clearImmediate,
      exports: typeof exports,
      global: typeof global,
      module: typeof module,
      process: typeof process,
      require: typeof require,
      setImmediate: typeof setImmediate,
      },
      browserSurface: {
        markResourceTiming: typeof performance.markResourceTiming,
      },
      cookies: (${cookieSummary.toString()})(document.cookie),
    };
    if (${traceEnabled}) Object.assign(result, __modeEnvTrace.dump('source'));
    if (${readTraceEnabled}) result.readTrace = __modeReadTrace.dump();
    return result;`)();
  nodeProcess.stdout.write(JSON.stringify(result), () => nodeProcess.exit(0));
} finally {
  globalThis.console = originalConsole;
}
