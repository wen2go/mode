'use strict';

const {
  ArrayIsArray,
  ArrayPrototypeIncludes,
  ArrayPrototypeJoin,
  ArrayPrototypePush,
  ArrayPrototypeSlice,
  ArrayPrototypeSort,
  DateNow,
  DateParse,
  FunctionPrototypeCall,
  MapPrototypeDelete,
  MapPrototypeEntries,
  MapPrototypeGet,
  MapPrototypeSet,
  MathFloor,
  MathMax,
  MathMin,
  Number,
  NumberIsFinite,
  NumberIsInteger,
  NumberIsNaN,
  ObjectCreate,
  ObjectDefineProperty,
  ObjectGetOwnPropertyDescriptor,
  ObjectGetOwnPropertyNames,
  ObjectGetPrototypeOf,
  ObjectKeys,
  ObjectSetPrototypeOf,
  RegExpPrototypeExec,
  SafeMap,
  SafeWeakMap,
  String,
  StringPrototypeCharAt,
  StringPrototypeEndsWith,
  StringPrototypeIndexOf,
  StringPrototypeLastIndexOf,
  StringPrototypeSlice,
  StringPrototypeSplit,
  StringPrototypeStartsWith,
  StringPrototypeTrim,
  StringPrototypeToLowerCase,
  StringPrototypeToUpperCase,
  Symbol,
  Uint8ClampedArray,
} = primordials;

const { URL } = require('internal/url');

const { createDocumentAll } = internalBinding('browser_env');

const kVoidElements = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
]);

const kDefaultNavigator = {
  appCodeName: 'Mozilla',
  appName: 'Netscape',
  appVersion: '5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
    + '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  cookieEnabled: true,
  connection: {
    downlink: 10,
    effectiveType: '4g',
    onchange: null,
    rtt: 200,
    saveData: false,
  },
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
    + '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  mimeTypes: [
    { description: 'Portable Document Format', suffixes: 'pdf', type: 'application/pdf' },
    { description: 'Portable Document Format', suffixes: 'pdf', type: 'text/pdf' },
  ],
  plugins: [
    { description: 'Portable Document Format', filename: 'internal-pdf-viewer', name: 'PDF Viewer' },
    { description: 'Portable Document Format', filename: 'internal-pdf-viewer', name: 'Chrome PDF Viewer' },
    { description: 'Portable Document Format', filename: 'internal-pdf-viewer', name: 'Chromium PDF Viewer' },
    { description: 'Portable Document Format', filename: 'internal-pdf-viewer', name: 'Microsoft Edge PDF Viewer' },
    { description: 'Portable Document Format', filename: 'internal-pdf-viewer', name: 'WebKit built-in PDF' },
  ],
  platform: 'Win32',
  language: 'en-US',
  languages: ['en-US', 'en'],
  vendor: 'Google Inc.',
  maxTouchPoints: 0,
  hardwareConcurrency: 8,
  deviceMemory: 8,
  onLine: true,
  product: 'Gecko',
  productSub: '20030107',
  vendorSub: '',
  webdriver: false,
};

const kProtectedWindowProperties = new Set([
  'window', 'self', 'top', 'parent', 'globalThis', 'document', 'location',
  'navigator', 'history', 'screen', 'Window', 'Navigator', 'Event',
  'Node', 'Element', 'HTMLElement', 'Document', 'Text', 'localStorage',
  'sessionStorage', 'addEventListener', 'removeEventListener', 'dispatchEvent',
  'History', 'Screen', 'Location', 'DOMParser', 'XMLHttpRequest',
  'MutationObserver', 'XPathExpression', 'HTMLAnchorElement', 'HTMLCanvasElement',
  'CanvasRenderingContext2D', 'HTMLFormElement', 'HTMLInputElement',
  'HTMLBodyElement', 'HTMLCollection', 'DOMStringList', 'HTMLHeadElement', 'HTMLHtmlElement',
  'HTMLDivElement', 'HTMLIFrameElement', 'HTMLMetaElement', 'HTMLScriptElement',
  'HTMLTitleElement', 'MimeType', 'MimeTypeArray', 'Storage', 'BatteryManager',
  'NetworkInformation', 'Plugin', 'PluginArray',
  'IDBDatabase', 'IDBObjectStore', 'IDBOpenDBRequest', 'IDBRequest', 'IDBTransaction',
  'Request', 'WebSocket',
  'indexedDB', 'chrome', 'clientInformation', 'msCrypto', 'name', 'open',
  'prompt', 'webkitRequestFileSystem', 'TEMPORARY',
  'global', 'process', 'Buffer', 'require', 'module', 'exports',
  'setImmediate', 'clearImmediate',
]);

const kProtectedDocumentProperties = new Set([
  'all', 'location', 'documentElement', 'head', 'body', 'cookie',
  'referrer',
  'currentScript', 'readyState',
  'createElement', 'createTextNode', 'appendChild', 'insertBefore',
  'removeChild', 'replaceChild', 'getElementById', 'getElementsByTagName',
  'getElementsByClassName', 'getElementsByName', 'querySelector',
  'querySelectorAll', 'defaultView', 'addEventListener', 'removeEventListener',
  'dispatchEvent', 'createExpression',
]);

let installed = false;
let installedEnvironment;
const kDocumentLifecycleStates = new SafeWeakMap();
const kDocumentCookieJars = new SafeWeakMap();
const kDocumentAllValues = new SafeWeakMap();
const kEventTargetListeners = new SafeWeakMap();
const kBrowserNodeStates = new SafeWeakMap();
const kBrowserElementStates = new SafeWeakMap();
const kBrowserDocumentStates = new SafeWeakMap();
const kLocationStates = new SafeWeakMap();
const kDOMStringListStates = new SafeWeakMap();
const kStorageValues = new SafeWeakMap();
const kBrowserWebSocketStates = new SafeWeakMap();
const kBrowserRequestStates = new SafeWeakMap();

function assertObject(value, name) {
  if (value === null || typeof value !== 'object') {
    throw new TypeError(`${name} must be an object`);
  }
}

function getHref(options) {
  const href = options.url ?? options.location?.href;
  if (typeof href !== 'string' || href.length === 0) {
    throw new TypeError('browser environment requires a non-empty url');
  }
  return href;
}

function defineInternal(target, name, value) {
  ObjectDefineProperty(target, name, {
    __proto__: null,
    configurable: false,
    enumerable: false,
    value,
    writable: true,
  });
}

function createBrowserTaskQueue() {
  const schedule = globalThis.setTimeout;
  let pending = 0;
  const idleWaiters = [];

  function finishTask() {
    pending--;
    if (pending !== 0) return;
    while (idleWaiters.length > 0) idleWaiters.shift()();
  }

  return {
    enqueue(callback) {
      pending++;
      schedule(() => {
        try {
          callback();
        } finally {
          finishTask();
        }
      }, 0);
    },
    waitForIdle() {
      if (pending === 0) return Promise.resolve();
      return new Promise((resolve) => ArrayPrototypePush(idleWaiters, resolve));
    },
  };
}

function markAsNativeFunction(value, name = value.name) {
  if (typeof value !== 'function') return value;
  if (value.name !== name) {
    ObjectDefineProperty(value, 'name', {
      __proto__: null,
      configurable: true,
      enumerable: false,
      value: name,
      writable: false,
    });
  }
  ObjectDefineProperty(value, 'toString', {
    __proto__: null,
    configurable: true,
    enumerable: false,
    value: function toString() { return `function ${name}() { [native code] }`; },
    writable: true,
  });
  return value;
}

function markNativePrototype(prototype) {
  for (const name of ObjectGetOwnPropertyNames(prototype)) {
    if (name === 'constructor') continue;
    const descriptor = ObjectGetOwnPropertyDescriptor(prototype, name);
    if (typeof descriptor?.value === 'function') markAsNativeFunction(descriptor.value);
    if (typeof descriptor?.get === 'function') markAsNativeFunction(descriptor.get);
    if (typeof descriptor?.set === 'function') markAsNativeFunction(descriptor.set);
  }
}

function createEventTarget(target) {
  const listeners = new Map();
  kEventTargetListeners.set(target, listeners);
  if (target instanceof BrowserNode) return target;
  for (const [name, value] of [
    ['addEventListener', eventTargetAddEventListener],
    ['removeEventListener', eventTargetRemoveEventListener],
    ['dispatchEvent', eventTargetDispatchEvent],
  ]) {
    ObjectDefineProperty(target, name, {
      __proto__: null,
      configurable: true,
      enumerable: false,
      value,
      writable: true,
    });
  }
  return target;
}

const eventTargetAddEventListener = markAsNativeFunction(function addEventListener(type, callback) {
  if (typeof callback !== 'function') return;
  const listeners = kEventTargetListeners.get(this);
  if (listeners === undefined) return;
  const key = String(type);
  let callbacks = listeners.get(key);
  if (callbacks === undefined) {
    callbacks = [];
    listeners.set(key, callbacks);
  }
  if (!ArrayPrototypeIncludes(callbacks, callback)) ArrayPrototypePush(callbacks, callback);
});

const eventTargetRemoveEventListener = markAsNativeFunction(function removeEventListener(type, callback) {
  const listeners = kEventTargetListeners.get(this);
  const callbacks = listeners?.get(String(type));
  if (callbacks === undefined) return;
  const index = callbacks.indexOf(callback);
  if (index !== -1) callbacks.splice(index, 1);
});

const eventTargetDispatchEvent = markAsNativeFunction(function dispatchEvent(event) {
  if (event === null || typeof event !== 'object' || !event.type) {
    throw new TypeError('dispatchEvent requires an event with a type');
  }
  event.target ??= this;
  event.currentTarget = this;
  const listeners = kEventTargetListeners.get(this);
  const callbacks = listeners?.get(String(event.type));
  if (callbacks !== undefined) {
    for (const callback of ArrayPrototypeSlice(callbacks)) {
      FunctionPrototypeCall(callback, this, event);
    }
  }
  const handler = this[`on${event.type}`];
  if (typeof handler === 'function') FunctionPrototypeCall(handler, this, event);
  return !event.defaultPrevented;
});

class BrowserEvent {
  constructor(type, init = {}) {
    this.type = String(type);
    this.bubbles = Boolean(init.bubbles);
    this.cancelable = Boolean(init.cancelable);
    this.defaultPrevented = false;
  }

  preventDefault() {
    if (this.cancelable) this.defaultPrevented = true;
  }
}

class BrowserNode {
  constructor(ownerDocument, nodeType, nodeName) {
    createEventTarget(this);
    kBrowserNodeStates.set(this, {
      childNodes: [],
      nodeName,
      nodeType,
      ownerDocument,
      parentNode: null,
    });
  }

  get ownerDocument() {
    return kBrowserNodeStates.get(this).ownerDocument;
  }

  set ownerDocument(value) {
    kBrowserNodeStates.get(this).ownerDocument = value;
  }

  get nodeType() {
    return kBrowserNodeStates.get(this).nodeType;
  }

  get nodeName() {
    return kBrowserNodeStates.get(this).nodeName;
  }

  get parentNode() {
    return kBrowserNodeStates.get(this).parentNode;
  }

  set parentNode(value) {
    kBrowserNodeStates.get(this).parentNode = value;
  }

  get childNodes() {
    return kBrowserNodeStates.get(this).childNodes;
  }

  get firstChild() {
    return this.childNodes[0] ?? null;
  }

  get lastChild() {
    return this.childNodes[this.childNodes.length - 1] ?? null;
  }

  get parentElement() {
    return this.parentNode?.nodeType === 1 ? this.parentNode : null;
  }

  get children() {
    return createCollection(() => this.childNodes.filter((node) => node.nodeType === 1));
  }

  appendChild(child) {
    return this.insertBefore(child, null);
  }

  insertBefore(child, referenceNode) {
    if (!(child instanceof BrowserNode)) throw new TypeError('child must be a Node');
    if (referenceNode !== null && referenceNode.parentNode !== this) {
      throw new Error('reference node is not a child of this node');
    }
    if (child.parentNode !== null) child.parentNode.removeChild(child);
    const index = referenceNode === null ? this.childNodes.length : this.childNodes.indexOf(referenceNode);
    this.childNodes.splice(index, 0, child);
    child.parentNode = this;
    return child;
  }

  removeChild(child) {
    const index = this.childNodes.indexOf(child);
    if (index === -1) throw new Error('child is not a child of this node');
    this.childNodes.splice(index, 1);
    child.parentNode = null;
    return child;
    return child;
  }

  replaceChild(child, oldChild) {
    const index = this.childNodes.indexOf(oldChild);
    if (index === -1) throw new Error('old child is not a child of this node');
    if (child.parentNode !== null) child.parentNode.removeChild(child);
    this.childNodes[index] = child;
    child.parentNode = this;
    oldChild.parentNode = null;
    return oldChild;
  }

  contains(node) {
    for (let current = node; current !== null; current = current.parentNode) {
      if (current === this) return true;
    }
    return false;
  }

  get textContent() {
    if (this.nodeType === 3) return this.data;
    return this.childNodes.map((node) => node.textContent).join('');
  }

  set textContent(value) {
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes.length = 0;
    const text = String(value);
    if (text.length > 0) this.appendChild(new BrowserText(this.ownerDocument, text));
  }

  get innerText() {
    return this.textContent;
  }

  set innerText(value) {
    this.textContent = value;
  }
}

for (const [name, value] of [
  ['addEventListener', eventTargetAddEventListener],
  ['removeEventListener', eventTargetRemoveEventListener],
  ['dispatchEvent', eventTargetDispatchEvent],
]) {
  ObjectDefineProperty(BrowserNode.prototype, name, {
    __proto__: null,
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

class BrowserText extends BrowserNode {
  constructor(ownerDocument, data) {
    super(ownerDocument, 3, '#text');
    this.data = String(data);
  }

  get textContent() {
    return this.data;
  }

  set textContent(value) {
    this.data = String(value);
  }

  get [Symbol.toStringTag]() {
    return 'Text';
  }
}

class BrowserElement extends BrowserNode {
  constructor(ownerDocument, tagName) {
    const localName = StringPrototypeToLowerCase(String(tagName));
    super(ownerDocument, 1, StringPrototypeToUpperCase(localName));
    kBrowserElementStates.set(this, {
      attributes: ObjectCreate(null),
      localName,
      style: ObjectCreate(null),
      tagName: this.nodeName,
    });
  }

  get tagName() {
    return kBrowserElementStates.get(this).tagName;
  }

  get localName() {
    return kBrowserElementStates.get(this).localName;
  }

  get attributes() {
    return kBrowserElementStates.get(this).attributes;
  }

  get style() {
    return kBrowserElementStates.get(this).style;
  }

  get [Symbol.toStringTag]() {
    switch (this.localName) {
      case 'body': return 'HTMLBodyElement';
      case 'head': return 'HTMLHeadElement';
      case 'html': return 'HTMLHtmlElement';
      case 'meta': return 'HTMLMetaElement';
      case 'script': return 'HTMLScriptElement';
      case 'title': return 'HTMLTitleElement';
      case 'iframe': return 'HTMLIFrameElement';
      default: return `HTML${this.localName[0].toUpperCase()}${this.localName.slice(1)}Element`;
    }
  }

  get id() {
    return this.getAttribute('id') ?? '';
  }

  set id(value) {
    this.setAttribute('id', value);
  }

  get className() {
    return this.getAttribute('class') ?? '';
  }

  set className(value) {
    this.setAttribute('class', value);
  }

  get name() {
    return this.getAttribute('name') ?? '';
  }

  set name(value) {
    this.setAttribute('name', value);
  }

  get value() {
    return this.getAttribute('value') ?? '';
  }

  set value(value) {
    this.setAttribute('value', value);
  }

  get type() {
    return this.getAttribute('type') ?? '';
  }

  set type(value) {
    this.setAttribute('type', value);
  }

  get src() {
    const value = this.getAttribute('src');
    return value === null ? '' : new URL(value, this.ownerDocument.location.href).href;
  }

  set src(value) {
    this.setAttribute('src', value);
  }

  get content() {
    return this.getAttribute('content') ?? '';
  }

  set content(value) {
    this.setAttribute('content', value);
  }

  get classList() {
    const element = this;
    return {
      add(...tokens) {
        const values = new Set(StringPrototypeSplit(element.className, ' ').filter(Boolean));
        for (const token of tokens) values.add(String(token));
        element.className = ArrayPrototypeJoin([...values], ' ');
      },
      remove(...tokens) {
        const values = new Set(StringPrototypeSplit(element.className, ' ').filter(Boolean));
        for (const token of tokens) values.delete(String(token));
        element.className = ArrayPrototypeJoin([...values], ' ');
      },
      contains(token) {
        return ArrayPrototypeIncludes(StringPrototypeSplit(element.className, ' '), String(token));
      },
      toggle(token, force) {
        const present = this.contains(token);
        const shouldAdd = force === undefined ? !present : Boolean(force);
        if (shouldAdd) this.add(token); else this.remove(token);
        return shouldAdd;
      },
    };
  }

  getAttribute(name) {
    const key = StringPrototypeToLowerCase(String(name));
    return Object.prototype.hasOwnProperty.call(this.attributes, key) ? this.attributes[key] : null;
  }

  hasAttribute(name) {
    return this.getAttribute(name) !== null;
  }

  setAttribute(name, value) {
    this.attributes[StringPrototypeToLowerCase(String(name))] = String(value);
  }

  removeAttribute(name) {
    delete this.attributes[StringPrototypeToLowerCase(String(name))];
  }

  get innerHTML() {
    return this.childNodes.map(serializeNode).join('');
  }

  set innerHTML(value) {
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes.length = 0;
    for (const node of parseFragment(this.ownerDocument, String(value))) this.appendChild(node);
  }

  getElementsByTagName(tagName) {
    const expected = StringPrototypeToLowerCase(String(tagName));
    return createLiveCollection(this, (element) => expected === '*' || element.localName === expected);
  }

  getElementsByClassName(className) {
    const expected = String(className);
    return createLiveCollection(this, (element) =>
      ArrayPrototypeIncludes(StringPrototypeSplit(element.className, ' '), expected));
  }

  getElementsByName(name) {
    const expected = String(name);
    return createLiveCollection(this, (element) => element.getAttribute('name') === expected);
  }

  querySelector(selector) {
    return findElements(this, selector)[0] ?? null;
  }

  querySelectorAll(selector) {
    return findElements(this, selector);
  }
}

class HTMLHtmlElement extends BrowserElement {
  constructor(ownerDocument) {
    super(ownerDocument, 'html');
  }
}

class HTMLHeadElement extends BrowserElement {
  constructor(ownerDocument) {
    super(ownerDocument, 'head');
  }
}

class HTMLBodyElement extends BrowserElement {
  constructor(ownerDocument) {
    super(ownerDocument, 'body');
  }
}

class HTMLDivElement extends BrowserElement {
  constructor(ownerDocument) {
    super(ownerDocument, 'div');
  }
}

class HTMLIFrameElement extends BrowserElement {
  constructor(ownerDocument) {
    super(ownerDocument, 'iframe');
  }

  get contentDocument() {
    return null;
  }

  get contentWindow() {
    return null;
  }
}

class HTMLMetaElement extends BrowserElement {
  constructor(ownerDocument) {
    super(ownerDocument, 'meta');
  }
}

class HTMLScriptElement extends BrowserElement {
  constructor(ownerDocument) {
    super(ownerDocument, 'script');
  }
}

class HTMLTitleElement extends BrowserElement {
  constructor(ownerDocument) {
    super(ownerDocument, 'title');
  }
}

class HTMLAnchorElement extends BrowserElement {
  constructor(ownerDocument) {
    super(ownerDocument, 'a');
  }

  get _url() {
    return new URL(this.getAttribute('href') ?? '', this.ownerDocument.location.href);
  }

  get href() {
    return this.getAttribute('href') === null ? '' : this._url.href;
  }

  set href(value) {
    this.setAttribute('href', value);
  }

  get origin() { return this.getAttribute('href') === null ? '' : this._url.origin; }
  // Chromium exposes ":" for an anchor without an href, while the rest of
  // its URL components remain empty strings.
  get protocol() { return this.getAttribute('href') === null ? ':' : this._url.protocol; }
  get host() { return this.getAttribute('href') === null ? '' : this._url.host; }
  get hostname() { return this.getAttribute('href') === null ? '' : this._url.hostname; }
  get port() { return this.getAttribute('href') === null ? '' : this._url.port; }
  get pathname() { return this.getAttribute('href') === null ? '' : this._url.pathname; }
  get search() { return this.getAttribute('href') === null ? '' : this._url.search; }
  get hash() { return this.getAttribute('href') === null ? '' : this._url.hash; }
}

function canvasDimension(value) {
  const number = Number(value);
  return NumberIsFinite(number) ? MathMax(0, MathFloor(number)) : 0;
}

function canvasColor(value) {
  switch (StringPrototypeToLowerCase(StringPrototypeTrim(String(value)))) {
    case 'red': return [255, 0, 0, 255];
    case 'transparent': return [0, 0, 0, 0];
    case 'white': return [255, 255, 255, 255];
    default: return [0, 0, 0, 255];
  }
}

function ensureCanvasPixels(context) {
  const width = canvasDimension(context.canvas.width);
  const height = canvasDimension(context.canvas.height);
  if (context._pixelWidth !== width || context._pixelHeight !== height) {
    context._pixels = new Uint8ClampedArray(width * height * 4);
    context._pixelWidth = width;
    context._pixelHeight = height;
  }
  return { height, width };
}

function paintCanvasRectangle(context, x, y, width, height, color) {
  const dimensions = ensureCanvasPixels(context);
  const startX = MathMin(dimensions.width, MathMax(0, MathFloor(Number(x))));
  const startY = MathMin(dimensions.height, MathMax(0, MathFloor(Number(y))));
  const endX = MathMin(dimensions.width, MathMax(startX, MathFloor(Number(x) + Number(width))));
  const endY = MathMin(dimensions.height, MathMax(startY, MathFloor(Number(y) + Number(height))));
  for (let row = startY; row < endY; row++) {
    for (let column = startX; column < endX; column++) {
      const offset = (row * dimensions.width + column) * 4;
      context._pixels[offset] = color[0];
      context._pixels[offset + 1] = color[1];
      context._pixels[offset + 2] = color[2];
      context._pixels[offset + 3] = color[3];
    }
  }
}

class CanvasRenderingContext2D {
  constructor(canvas) {
    this.canvas = canvas;
    this.fillStyle = '#000000';
    this.font = '10px sans-serif';
    defineInternal(this, '_pixelHeight', 0);
    defineInternal(this, '_pixelWidth', 0);
    defineInternal(this, '_pixels', undefined);
  }

  clearRect(x, y, width, height) {
    paintCanvasRectangle(this, x, y, width, height, [0, 0, 0, 0]);
  }
  fillRect(x, y, width, height) {
    paintCanvasRectangle(this, x, y, width, height, canvasColor(this.fillStyle));
  }
  fillText() {}
  drawImage() {}
  beginPath() {}
  closePath() {}
  stroke() {}
  fill() {}

  getImageData(x, y, width, height) {
    const imageWidth = canvasDimension(width);
    const imageHeight = canvasDimension(height);
    const dimensions = ensureCanvasPixels(this);
    const pixels = new Uint8ClampedArray(imageWidth * imageHeight * 4);
    const startX = MathFloor(Number(x));
    const startY = MathFloor(Number(y));
    for (let row = 0; row < imageHeight; row++) {
      for (let column = 0; column < imageWidth; column++) {
        const sourceX = startX + column;
        const sourceY = startY + row;
        if (sourceX < 0 || sourceX >= dimensions.width || sourceY < 0 || sourceY >= dimensions.height) continue;
        const sourceOffset = (sourceY * dimensions.width + sourceX) * 4;
        const targetOffset = (row * imageWidth + column) * 4;
        pixels[targetOffset] = this._pixels[sourceOffset];
        pixels[targetOffset + 1] = this._pixels[sourceOffset + 1];
        pixels[targetOffset + 2] = this._pixels[sourceOffset + 2];
        pixels[targetOffset + 3] = this._pixels[sourceOffset + 3];
      }
    }
    const imageData = { data: pixels, height: imageHeight, width: imageWidth };
    ObjectDefineProperty(imageData, Symbol.toStringTag, {
      __proto__: null,
      configurable: true,
      value: 'ImageData',
    });
    return imageData;
  }

  measureText(value) {
    return { width: String(value).length * 6 };
  }
}

class HTMLCanvasElement extends BrowserElement {
  constructor(ownerDocument) {
    super(ownerDocument, 'canvas');
    this.height = 150;
    this.width = 300;
    this._context2d = undefined;
  }

  getContext(type) {
    if (StringPrototypeToLowerCase(String(type)) !== '2d') return null;
    this._context2d ??= new CanvasRenderingContext2D(this);
    return this._context2d;
  }

  toDataURL() {
    return 'data:,';
  }
}

class HTMLFormElement extends BrowserElement {
  constructor(ownerDocument) {
    super(ownerDocument, 'form');
  }

  get elements() {
    return createLiveCollection(this, (element) =>
      element !== this && ['button', 'fieldset', 'input', 'object', 'output', 'select', 'textarea'].includes(element.localName));
  }

  get action() {
    return new URL(this.getAttribute('action') ?? '', this.ownerDocument.location.href).href;
  }

  set action(value) {
    this.setAttribute('action', value);
  }
}

class HTMLInputElement extends BrowserElement {
  constructor(ownerDocument) {
    super(ownerDocument, 'input');
  }
}

function getCookieContext(location) {
  const hostname = StringPrototypeToLowerCase(String(location.hostname));
  let pathname = String(location.pathname);
  if (!StringPrototypeStartsWith(pathname, '/')) pathname = '/';
  return {
    hostname,
    pathname,
    secure: location.protocol === 'https:',
  };
}

function defaultCookiePath(pathname) {
  const lastSlash = StringPrototypeLastIndexOf(pathname, '/');
  if (lastSlash <= 0) return '/';
  return StringPrototypeSlice(pathname, 0, lastSlash);
}

function cookieDomainMatches(hostname, domain) {
  return hostname === domain || StringPrototypeEndsWith(hostname, `.${domain}`);
}

function cookiePathMatches(pathname, path) {
  if (pathname === path) return true;
  if (!StringPrototypeStartsWith(pathname, path)) return false;
  return StringPrototypeEndsWith(path, '/') ||
    StringPrototypeCharAt(pathname, path.length) === '/';
}

class BrowserCookieJar {
  #entries = new SafeMap();
  #nextCreation = 0;

  get(location) {
    const context = getCookieContext(location);
    const now = DateNow();
    const visible = [];
    for (const [key, cookie] of MapPrototypeEntries(this.#entries)) {
      if (cookie.expires !== null && cookie.expires <= now) {
        MapPrototypeDelete(this.#entries, key);
        continue;
      }
      if ((cookie.hostOnly ? context.hostname === cookie.domain :
        cookieDomainMatches(context.hostname, cookie.domain)) &&
          cookiePathMatches(context.pathname, cookie.path) &&
          (!cookie.secure || context.secure)) {
        ArrayPrototypePush(visible, cookie);
      }
    }
    ArrayPrototypeSort(visible, (left, right) =>
      right.path.length - left.path.length || left.creation - right.creation);
    const pairs = [];
    for (const cookie of visible) ArrayPrototypePush(pairs, `${cookie.name}=${cookie.value}`);
    return ArrayPrototypeJoin(pairs, '; ');
  }

  set(value, location) {
    const parts = StringPrototypeSplit(String(value), ';');
    const pair = StringPrototypeTrim(parts[0]);
    const separator = StringPrototypeIndexOf(pair, '=');
    if (separator <= 0) return;

    const name = StringPrototypeTrim(StringPrototypeSlice(pair, 0, separator));
    const cookieValue = StringPrototypeTrim(StringPrototypeSlice(pair, separator + 1));
    const context = getCookieContext(location);
    let domain = context.hostname;
    let hostOnly = true;
    let path = defaultCookiePath(context.pathname);
    let secure = false;
    let expires = null;
    let maxAge;

    for (let index = 1; index < parts.length; index++) {
      const attribute = StringPrototypeTrim(parts[index]);
      if (attribute.length === 0) continue;
      const attributeSeparator = StringPrototypeIndexOf(attribute, '=');
      const attributeName = StringPrototypeToLowerCase(StringPrototypeTrim(
        attributeSeparator === -1 ? attribute :
          StringPrototypeSlice(attribute, 0, attributeSeparator)));
      const attributeValue = attributeSeparator === -1 ? '' : StringPrototypeTrim(
        StringPrototypeSlice(attribute, attributeSeparator + 1));
      if (attributeName === 'domain') {
        let candidate = StringPrototypeToLowerCase(attributeValue);
        if (StringPrototypeStartsWith(candidate, '.')) {
          candidate = StringPrototypeSlice(candidate, 1);
        }
        if (candidate.length === 0 || !cookieDomainMatches(context.hostname, candidate)) return;
        domain = candidate;
        hostOnly = false;
      } else if (attributeName === 'path') {
        if (StringPrototypeStartsWith(attributeValue, '/')) path = attributeValue;
      } else if (attributeName === 'secure') {
        secure = true;
      } else if (attributeName === 'max-age') {
        const parsed = Number(attributeValue);
        if (attributeValue.length > 0 && NumberIsInteger(parsed) && !NumberIsNaN(parsed)) {
          maxAge = parsed;
        }
      } else if (attributeName === 'expires') {
        const parsed = DateParse(attributeValue);
        if (!NumberIsNaN(parsed)) expires = parsed;
      }
    }

    if (secure && !context.secure) return;
    const key = `${name}\u0000${domain}\u0000${path}`;
    if (maxAge !== undefined) expires = maxAge <= 0 ? DateNow() - 1 : DateNow() + maxAge * 1000;
    if (expires !== null && expires <= DateNow()) {
      MapPrototypeDelete(this.#entries, key);
      return;
    }
    const existing = MapPrototypeGet(this.#entries, key);
    MapPrototypeSet(this.#entries, key, {
      creation: existing?.creation ?? this.#nextCreation++,
      domain,
      expires,
      hostOnly,
      name,
      path,
      secure,
      value: cookieValue,
    });
  }
}

function XPathExpression() {
  throw new TypeError('Illegal constructor');
}

ObjectDefineProperty(XPathExpression.prototype, Symbol.toStringTag, {
  __proto__: null,
  configurable: true,
  value: 'XPathExpression',
});

class BrowserDocument extends BrowserNode {
  constructor(location, lifecycleState = undefined) {
    super(null, 9, '#document');
    this.ownerDocument = this;
    kBrowserDocumentStates.set(this, {
      body: null,
      defaultView: null,
      documentElement: null,
      head: null,
      location,
      visibilityState: 'visible',
    });
    kDocumentCookieJars.set(this, new BrowserCookieJar());
    kDocumentLifecycleStates.set(this, lifecycleState ?? {
      currentScript: null,
      readyState: 'loading',
    });
    this._resetDocumentElement();
  }

  get [Symbol.toStringTag]() {
    return 'HTMLDocument';
  }

  get documentElement() {
    return kBrowserDocumentStates.get(this).documentElement;
  }

  set documentElement(value) {
    kBrowserDocumentStates.get(this).documentElement = value;
  }

  get head() {
    return kBrowserDocumentStates.get(this).head;
  }

  set head(value) {
    kBrowserDocumentStates.get(this).head = value;
  }

  get body() {
    return kBrowserDocumentStates.get(this).body;
  }

  set body(value) {
    kBrowserDocumentStates.get(this).body = value;
  }

  get currentScript() {
    return kDocumentLifecycleStates.get(this).currentScript;
  }

  get readyState() {
    return kDocumentLifecycleStates.get(this).readyState;
  }

  get characterSet() {
    return 'UTF-8';
  }

  get charset() {
    return this.characterSet;
  }

  get hidden() {
    return this.visibilityState !== 'visible';
  }

  get visibilityState() {
    return kBrowserDocumentStates.get(this).visibilityState;
  }

  _resetDocumentElement() {
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes.length = 0;
    this.documentElement = this.createElement('html');
    this.head = this.createElement('head');
    this.body = this.createElement('body');
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
    this.appendChild(this.documentElement);
  }

  get location() {
    return kBrowserDocumentStates.get(this).location;
  }

  get defaultView() {
    return kBrowserDocumentStates.get(this).defaultView;
  }

  get all() {
    return kDocumentAllValues.get(this);
  }

  get referrer() {
    return '';
  }

  get cookie() {
    return kDocumentCookieJars.get(this).get(this.location);
  }

  set cookie(value) {
    kDocumentCookieJars.get(this).set(value, this.location);
  }

  get title() {
    return this.querySelector('title')?.textContent ?? '';
  }

  set title(value) {
    let title = this.querySelector('title');
    if (title === null) {
      title = this.createElement('title');
      this.head.appendChild(title);
    }
    title.textContent = value;
  }

  get scripts() {
    return this.getElementsByTagName('script');
  }

  createElement(tagName) {
    switch (StringPrototypeToLowerCase(String(tagName))) {
      case 'a':
        return new HTMLAnchorElement(this);
      case 'body':
        return new HTMLBodyElement(this);
      case 'canvas':
        return new HTMLCanvasElement(this);
      case 'div':
        return new HTMLDivElement(this);
      case 'form':
        return new HTMLFormElement(this);
      case 'head':
        return new HTMLHeadElement(this);
      case 'html':
        return new HTMLHtmlElement(this);
      case 'input':
        return new HTMLInputElement(this);
      case 'iframe':
        return new HTMLIFrameElement(this);
      case 'meta':
        return new HTMLMetaElement(this);
      case 'script':
        return new HTMLScriptElement(this);
      case 'title':
        return new HTMLTitleElement(this);
      default:
        return new BrowserElement(this, tagName);
    }
  }

  createTextNode(data) {
    return new BrowserText(this, data);
  }

  createExpression() {
    return ObjectCreate(XPathExpression.prototype);
  }

  getElementById(id) {
    return walkElements(this, (element) => element.id === String(id))[0] ?? null;
  }

  getElementsByTagName(tagName) {
    const expected = StringPrototypeToLowerCase(String(tagName));
    return createLiveCollection(this, (element) => expected === '*' || element.localName === expected);
  }

  getElementsByClassName(className) {
    return this.documentElement.getElementsByClassName(className);
  }

  getElementsByName(name) {
    return this.documentElement.getElementsByName(name);
  }

  querySelector(selector) {
    return findElements(this, selector)[0] ?? null;
  }

  querySelectorAll(selector) {
    return findElements(this, selector);
  }

  loadHTML(html) {
    const nodes = parseFragment(this, html);
    const parsedHtml = nodes.find((node) => node instanceof BrowserElement && node.localName === 'html');
    const trailingNodes = [];
    if (parsedHtml !== undefined) {
      let afterHtml = false;
      for (const node of nodes) {
        if (afterHtml) ArrayPrototypePush(trailingNodes, node);
        if (node === parsedHtml) afterHtml = true;
      }
    }
    this._resetDocumentElement();
    if (parsedHtml !== undefined) {
      this.removeChild(this.documentElement);
      this.documentElement = parsedHtml;
      this.documentElement.parentNode = null;
      this.appendChild(this.documentElement);
      this.head = this.documentElement.childNodes.find((node) => node.localName === 'head') ?? this.createElement('head');
      this.body = this.documentElement.childNodes.find((node) => node.localName === 'body') ?? this.createElement('body');
      if (this.head.parentNode === null) this.documentElement.insertBefore(this.head, this.documentElement.firstChild);
      if (this.body.parentNode === null) this.documentElement.appendChild(this.body);
      for (const node of trailingNodes) this.body.appendChild(node);
    } else {
      for (const node of nodes) this.body.appendChild(node);
    }
  }
}

// Web IDL attributes on Document are enumerable prototype accessors. Keep
// profile initialization internal so page code cannot write a browser-readonly
// value such as document.visibilityState.
for (const name of ['defaultView', 'hidden', 'referrer', 'visibilityState']) {
  const descriptor = ObjectGetOwnPropertyDescriptor(BrowserDocument.prototype, name);
  ObjectDefineProperty(BrowserDocument.prototype, name, {
    __proto__: null,
    configurable: descriptor.configurable,
    enumerable: true,
    get: descriptor.get,
    set: descriptor.set,
  });
}

function walkElements(root, predicate) {
  const result = [];
  const visit = (node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === 1) {
        if (predicate(child)) ArrayPrototypePush(result, child);
        visit(child);
      }
    }
  };
  if (root.nodeType === 1 && predicate(root)) ArrayPrototypePush(result, root);
  visit(root);
  return result;
}

function HTMLCollection() {
  throw new TypeError('Illegal constructor');
}

ObjectDefineProperty(HTMLCollection.prototype, Symbol.toStringTag, {
  __proto__: null,
  configurable: true,
  value: 'HTMLCollection',
});

function createCollection(current) {
  const collection = ObjectCreate(HTMLCollection.prototype);
  return new Proxy(collection, {
    get(target, property, receiver) {
      if (property === 'length') return current().length;
      if (property === 'item') return (index) => current()[index] ?? null;
      if (property === 'namedItem') return (name) => current().find((element) =>
        element.id === name || element.getAttribute('name') === name) ?? null;
      if (property === Symbol.iterator) return function* iterator() { yield* current(); };
      if (typeof property === 'string' && /^\d+$/.test(property)) return current()[Number(property)];
      return Reflect.get(target, property, receiver);
    },
    ownKeys() {
      return [...current().keys()].map(String);
    },
    getOwnPropertyDescriptor(target, property) {
      if (property === 'length') {
        return {
          configurable: true,
          enumerable: false,
          value: current().length,
          writable: false,
        };
      }
      if (typeof property === 'string' && /^\d+$/.test(property)) {
        return {
          configurable: true,
          enumerable: true,
          value: current()[Number(property)],
          writable: false,
        };
      }
      return ObjectGetOwnPropertyDescriptor(target, property);
    },
  });
}

function createLiveCollection(root, predicate) {
  return createCollection(() => walkElements(root, predicate));
}

function DOMStringList() {
  throw new TypeError('Illegal constructor');
}

ObjectDefineProperty(DOMStringList.prototype, Symbol.toStringTag, {
  __proto__: null,
  configurable: true,
  value: 'DOMStringList',
});

function domStringListValues(list) {
  const current = kDOMStringListStates.get(list);
  return current === undefined ? [] : current();
}

DOMStringList.prototype.contains = markAsNativeFunction(function contains(value) {
  return ArrayPrototypeIncludes(domStringListValues(this), String(value));
});
DOMStringList.prototype.item = markAsNativeFunction(function item(index) {
  const numericIndex = Number(index);
  if (!NumberIsInteger(numericIndex) || numericIndex < 0) return null;
  return domStringListValues(this)[numericIndex] ?? null;
});

function createDOMStringList(current) {
  const list = ObjectCreate(DOMStringList.prototype);
  kDOMStringListStates.set(list, current);
  const proxy = new Proxy(list, {
    get(target, property, receiver) {
      const values = current();
      if (property === 'length') return values.length;
      if (property === Symbol.iterator) return function* iterator() { yield* current(); };
      if (typeof property === 'string' && /^\d+$/.test(property)) return values[Number(property)];
      return Reflect.get(target, property, receiver);
    },
    ownKeys() {
      return [...current().keys()].map(String);
    },
    getOwnPropertyDescriptor(target, property) {
      const values = current();
      if (property === 'length') {
        return {
          configurable: true,
          enumerable: false,
          value: values.length,
          writable: false,
        };
      }
      if (typeof property === 'string' && /^\d+$/.test(property)) {
        return {
          configurable: true,
          enumerable: true,
          value: values[Number(property)],
          writable: false,
        };
      }
      return ObjectGetOwnPropertyDescriptor(target, property);
    },
  });
  kDOMStringListStates.set(proxy, current);
  return proxy;
}

function selectorMatches(element, selector) {
  const attribute = RegExpPrototypeExec(/^\[([\w-]+)(?:=["']?([^\]"']+)["']?)?\]$/, selector);
  if (attribute !== null) {
    return element.hasAttribute(attribute[1]) &&
      (attribute[2] === undefined || element.getAttribute(attribute[1]) === attribute[2]);
  }
  const id = RegExpPrototypeExec(/^#([\w-]+)$/, selector);
  if (id !== null) return element.id === id[1];
  const className = RegExpPrototypeExec(/^\.([\w-]+)$/, selector);
  if (className !== null) return element.classList.contains(className[1]);
  const tagClass = RegExpPrototypeExec(/^([\w-]+)\.([\w-]+)$/, selector);
  if (tagClass !== null) return element.localName === tagClass[1].toLowerCase() && element.classList.contains(tagClass[2]);
  return element.localName === StringPrototypeToLowerCase(selector);
}

function findElements(root, selector) {
  const selectors = StringPrototypeSplit(String(selector).trim(), /\s+/).filter(Boolean);
  if (selectors.length === 0) return [];
  const candidates = walkElements(root, (element) => selectorMatches(element, selectors[selectors.length - 1]));
  return candidates.filter((candidate) => {
    let current = candidate.parentElement;
    for (let index = selectors.length - 2; index >= 0; index--) {
      while (current !== null && !selectorMatches(current, selectors[index])) current = current.parentElement;
      if (current === null) return false;
      current = current.parentElement;
    }
    return true;
  });
}

function parseAttributes(element, source) {
  const attributePattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;
  while ((match = attributePattern.exec(source)) !== null) {
    element.setAttribute(match[1], match[2] ?? match[3] ?? match[4] ?? '');
  }
}

function parseFragment(document, source) {
  const root = new BrowserNode(document, 11, '#document-fragment');
  const stack = [root];
  const tokenPattern = /<!--[\s\S]*?-->|<\/?([A-Za-z][\w:-]*)([^>]*)>|([^<]+)/g;
  let match;
  while ((match = tokenPattern.exec(source)) !== null) {
    if (match[0].startsWith('<!--')) {
      // Conditional comments can contain markup which is ignored by modern
      // browsers. Do not accidentally turn that hidden markup into DOM nodes.
      // Inside a script element the same sequence is JavaScript text instead.
      if (stack[stack.length - 1].localName === 'script') {
        stack[stack.length - 1].appendChild(document.createTextNode(match[0]));
      }
      continue;
    }
    if (match[3] !== undefined) {
      stack[stack.length - 1].appendChild(document.createTextNode(match[3]));
      continue;
    }
    const tagName = StringPrototypeToLowerCase(match[1]);
    if (source[match.index + 1] === '/') {
      for (let index = stack.length - 1; index > 0; index--) {
        if (stack[index].localName === tagName) {
          stack.length = index;
          break;
        }
      }
      continue;
    }
    const element = document.createElement(tagName);
    parseAttributes(element, match[2]);
    stack[stack.length - 1].appendChild(element);
    if (!kVoidElements.has(tagName) && !/\/\s*$/.test(match[2])) {
      ArrayPrototypePush(stack, element);
      if (tagName === 'script') {
        const endTag = /<\/script\s*>/ig;
        endTag.lastIndex = tokenPattern.lastIndex;
        const endMatch = RegExpPrototypeExec(endTag, source);
        if (endMatch !== null) {
          const text = StringPrototypeSlice(source, tokenPattern.lastIndex, endMatch.index);
          if (text.length > 0) element.appendChild(document.createTextNode(text));
          stack.length--;
          tokenPattern.lastIndex = endTag.lastIndex;
        }
      }
    }
  }
  return root.childNodes;
}

function serializeNode(node) {
  if (node.nodeType === 3) return node.data;
  if (node.nodeType !== 1) return '';
  const attributes = ObjectKeys(node.attributes).map((key) => ` ${key}="${node.attributes[key]}"`).join('');
  if (kVoidElements.has(node.localName)) return `<${node.localName}${attributes}>`;
  return `<${node.localName}${attributes}>${node.childNodes.map(serializeNode).join('')}</${node.localName}>`;
}

function createLocation(href, onNavigation = undefined) {
  let url;
  const replace = (value) => {
    url = new URL(String(value), url);
  };
  const notifyNavigation = (type) => {
    if (onNavigation !== undefined) {
      FunctionPrototypeCall(onNavigation, undefined, { href: url.href, type });
    }
  };
  const navigate = (value, type) => {
    replace(value);
    notifyNavigation(type);
  };
  replace(href);
  const location = {};
  for (const key of ['href', 'origin', 'protocol', 'host', 'hostname', 'port', 'pathname', 'search', 'hash']) {
    ObjectDefineProperty(location, key, {
      __proto__: null,
      configurable: false,
      enumerable: true,
      get() { return url[key]; },
      set(value) {
        if (key === 'href') navigate(value, 'href');
        else {
          url[key] = String(value);
          notifyNavigation(key);
        }
      },
    });
  }
  location.assign = markAsNativeFunction(function assign(value) { navigate(value, 'assign'); });
  location.replace = markAsNativeFunction(function replaceLocation(value) { navigate(value, 'replace'); }, 'replace');
  location.reload = markAsNativeFunction(function reload() { notifyNavigation('reload'); });
  location.toString = markAsNativeFunction(function toString() { return url.href; });
  ObjectDefineProperty(location, 'ancestorOrigins', {
    __proto__: null,
    configurable: false,
    enumerable: true,
    value: ObjectCreate(DOMStringList.prototype),
    writable: false,
  });
  ObjectDefineProperty(location.ancestorOrigins, 'length', {
    __proto__: null,
    configurable: true,
    enumerable: false,
    value: 0,
    writable: false,
  });
  ObjectDefineProperty(location.ancestorOrigins, 'item', {
    __proto__: null,
    configurable: true,
    enumerable: false,
    value: function item() { return null; },
    writable: true,
  });
  kLocationStates.set(location, { replace });
  return location;
}

function createHistory(location) {
  const setLocation = (value) => kLocationStates.get(location).replace(value);
  const entries = [location.href];
  let index = 0;
  return {
    get length() { return entries.length; },
    get state() { return null; },
    pushState(state, unused, url) {
      if (url !== undefined && url !== null) setLocation(url);
      entries.splice(index + 1);
      ArrayPrototypePush(entries, location.href);
      index = entries.length - 1;
    },
    replaceState(state, unused, url) {
      if (url !== undefined && url !== null) setLocation(url);
      entries[index] = location.href;
    },
    back() {
      if (index > 0) setLocation(entries[--index]);
    },
    forward() {
      if (index + 1 < entries.length) setLocation(entries[++index]);
    },
    go(delta = 0) {
      const next = index + Number(delta);
      if (next >= 0 && next < entries.length) {
        index = next;
        setLocation(entries[index]);
      }
    },
  };
}

function createNetworkInformation(values) {
  function NetworkInformation() {
    throw new TypeError('Illegal constructor');
  }
  const connection = ObjectCreate(NetworkInformation.prototype);
  defineInternal(connection, '_values', values);
  defineInternal(connection, '_onchange', values.onchange ?? null);
  for (const name of ['downlink', 'effectiveType', 'rtt', 'saveData']) {
    ObjectDefineProperty(NetworkInformation.prototype, name, {
      __proto__: null,
      configurable: true,
      enumerable: true,
      get() { return this._values[name]; },
    });
  }
  ObjectDefineProperty(NetworkInformation.prototype, 'onchange', {
    __proto__: null,
    configurable: true,
    enumerable: true,
    get() { return this._onchange; },
    set(value) { this._onchange = value; },
  });
  ObjectDefineProperty(NetworkInformation.prototype, Symbol.toStringTag, {
    __proto__: null,
    configurable: true,
    value: 'NetworkInformation',
  });
  markAsNativeFunction(NetworkInformation);
  markNativePrototype(NetworkInformation.prototype);
  return { NetworkInformation, connection };
}

function createDeprecatedStorageQuota() {
  const quota = {};
  ObjectDefineProperty(quota, Symbol.toStringTag, {
    __proto__: null,
    configurable: true,
    value: 'DeprecatedStorageQuota',
  });
  return quota;
}

function createBatteryManagerFactory() {
  function BatteryManager() {
    throw new TypeError('Illegal constructor');
  }
  for (const name of [
    'charging', 'chargingTime', 'dischargingTime', 'level',
    'onchargingchange', 'onchargingtimechange', 'ondischargingtimechange',
    'onlevelchange',
  ]) {
    ObjectDefineProperty(BatteryManager.prototype, name, {
      __proto__: null,
      configurable: true,
      enumerable: true,
      get() { return this._values[name]; },
      set(value) { this._values[name] = value; },
    });
  }
  ObjectDefineProperty(BatteryManager.prototype, Symbol.toStringTag, {
    __proto__: null,
    configurable: true,
    value: 'BatteryManager',
  });
  markAsNativeFunction(BatteryManager);
  markNativePrototype(BatteryManager.prototype);
  return {
    BatteryManager,
    createBattery() {
      const battery = ObjectCreate(BatteryManager.prototype);
      defineInternal(battery, '_values', {
        charging: true,
        chargingTime: Infinity,
        dischargingTime: Infinity,
        level: 0.8,
        onchargingchange: null,
        onchargingtimechange: null,
        ondischargingtimechange: null,
        onlevelchange: null,
      });
      createEventTarget(battery);
      return battery;
    },
  };
}

function createNavigator(values) {
  function Navigator() {
    throw new TypeError('Illegal constructor');
  }
  for (const [key, value] of Object.entries(values)) {
    ObjectDefineProperty(Navigator.prototype, key, {
      __proto__: null,
      configurable: true,
      enumerable: true,
      get: markAsNativeFunction(function getNavigatorValue() { return value; }, `get ${key}`),
    });
  }
  ObjectDefineProperty(Navigator.prototype, Symbol.toStringTag, {
    __proto__: null,
    configurable: true,
    value: 'Navigator',
  });
  const navigator = ObjectCreate(Navigator.prototype);
  markAsNativeFunction(Navigator);
  markNativePrototype(Navigator.prototype);
  return { Navigator, navigator };
}

function createStorage(seed) {
  const storage = ObjectCreate(Storage.prototype);
  kStorageValues.set(storage, new SafeMap(Object.entries(seed ?? {})));
  return storage;
}

function storageValues(storage) {
  return kStorageValues.get(storage);
}

function Storage() {
  throw new TypeError('Illegal constructor');
}

ObjectDefineProperty(Storage.prototype, 'length', {
  __proto__: null,
  configurable: true,
  enumerable: true,
  get() { return storageValues(this).size; },
});
Storage.prototype.key = function key(index) {
  return [...storageValues(this).keys()][index] ?? null;
};
Storage.prototype.getItem = function getItem(key) {
  return MapPrototypeGet(storageValues(this), String(key)) ?? null;
};
Storage.prototype.setItem = function setItem(key, value) {
  MapPrototypeSet(storageValues(this), String(key), String(value));
};
Storage.prototype.removeItem = function removeItem(key) {
  MapPrototypeDelete(storageValues(this), String(key));
};
Storage.prototype.clear = function clear() {
  storageValues(this).clear();
};
ObjectDefineProperty(Storage.prototype, Symbol.toStringTag, {
  __proto__: null,
  configurable: true,
  value: 'Storage',
});

function MimeType() {
  throw new TypeError('Illegal constructor');
}

function MimeTypeArray() {
  throw new TypeError('Illegal constructor');
}

ObjectDefineProperty(MimeType.prototype, Symbol.toStringTag, {
  __proto__: null,
  configurable: true,
  value: 'MimeType',
});
ObjectDefineProperty(MimeType.prototype, 'enabledPlugin', {
  __proto__: null,
  configurable: true,
  enumerable: true,
  get() { return this._enabledPlugin; },
});
ObjectDefineProperty(MimeTypeArray.prototype, Symbol.toStringTag, {
  __proto__: null,
  configurable: true,
  value: 'MimeTypeArray',
});

function Plugin() {
  throw new TypeError('Illegal constructor');
}

function PluginArray() {
  throw new TypeError('Illegal constructor');
}

for (const name of ['description', 'filename', 'name']) {
  ObjectDefineProperty(Plugin.prototype, name, {
    __proto__: null,
    configurable: true,
    enumerable: true,
    get() { return this._values[name]; },
  });
}
ObjectDefineProperty(Plugin.prototype, 'length', {
  __proto__: null,
  configurable: true,
  enumerable: true,
  get() { return this._entries.length; },
});
ObjectDefineProperty(Plugin.prototype, Symbol.toStringTag, {
  __proto__: null,
  configurable: true,
  value: 'Plugin',
});
ObjectDefineProperty(PluginArray.prototype, Symbol.toStringTag, {
  __proto__: null,
  configurable: true,
  value: 'PluginArray',
});

function createMimeTypeArray(values) {
  const entries = values.map((value) => {
    const entry = ObjectCreate(MimeType.prototype);
    defineInternal(entry, '_enabledPlugin', null);
    for (const key of ['description', 'suffixes', 'type']) {
      ObjectDefineProperty(entry, key, {
        __proto__: null,
        configurable: true,
        enumerable: true,
        value: value[key] ?? '',
        writable: false,
      });
    }
    return entry;
  });
  const mimeTypes = ObjectCreate(MimeTypeArray.prototype);
  defineInternal(mimeTypes, '_entries', entries);
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    ObjectDefineProperty(mimeTypes, index, {
      __proto__: null,
      configurable: true,
      enumerable: true,
      value: entry,
    });
    if (entry.type) {
      ObjectDefineProperty(mimeTypes, entry.type, {
        __proto__: null,
        configurable: true,
        enumerable: false,
        value: entry,
      });
    }
  }
  ObjectDefineProperty(mimeTypes, 'length', {
    __proto__: null,
    configurable: true,
    enumerable: false,
    get() { return entries.length; },
  });
  return mimeTypes;
}

function createPluginArray(values, mimeTypes) {
  const entries = values.map((value) => {
    const entry = ObjectCreate(Plugin.prototype);
    defineInternal(entry, '_entries', mimeTypes._entries);
    defineInternal(entry, '_values', {
      description: value.description ?? '',
      filename: value.filename ?? '',
      name: value.name ?? '',
    });
    for (let index = 0; index < mimeTypes._entries.length; index++) {
      const mimeType = mimeTypes._entries[index];
      ObjectDefineProperty(entry, index, {
        __proto__: null,
        configurable: true,
        enumerable: true,
        value: mimeType,
      });
      if (mimeType.type) {
        ObjectDefineProperty(entry, mimeType.type, {
          __proto__: null,
          configurable: true,
          enumerable: false,
          value: mimeType,
        });
      }
      if (mimeType._enabledPlugin === null) mimeType._enabledPlugin = entry;
    }
    return entry;
  });
  const plugins = ObjectCreate(PluginArray.prototype);
  defineInternal(plugins, '_entries', entries);
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    ObjectDefineProperty(plugins, index, {
      __proto__: null,
      configurable: true,
      enumerable: true,
      value: entry,
    });
    if (entry.name) {
      ObjectDefineProperty(plugins, entry.name, {
        __proto__: null,
        configurable: true,
        enumerable: false,
        value: entry,
      });
    }
  }
  ObjectDefineProperty(plugins, 'length', {
    __proto__: null,
    configurable: true,
    enumerable: false,
    get() { return entries.length; },
  });
  return plugins;
}

MimeTypeArray.prototype.item = function item(index) {
  return this._entries[index] ?? null;
};
MimeTypeArray.prototype.namedItem = function namedItem(name) {
  return this._entries.find((entry) => entry.type === String(name)) ?? null;
};
Plugin.prototype.item = function item(index) {
  return this._entries[index] ?? null;
};
Plugin.prototype.namedItem = function namedItem(name) {
  return this._entries.find((entry) => entry.type === String(name)) ?? null;
};
PluginArray.prototype.item = function item(index) {
  return this._entries[index] ?? null;
};
PluginArray.prototype.namedItem = function namedItem(name) {
  return this._entries.find((entry) => entry.name === String(name)) ?? null;
};

function createDOMParser(location) {
  return class DOMParser {
    parseFromString(source) {
      const lifecycleState = { currentScript: null, readyState: 'loading' };
      const document = new BrowserDocument(createLocation(location.href), lifecycleState);
      document.loadHTML(String(source));
      lifecycleState.readyState = 'complete';
      return document;
    }
  };
}

function createXMLHttpRequest(window, location) {
  function XMLHttpRequest() {
    createEventTarget(this);
    this.readyState = XMLHttpRequest.UNSENT;
    this.response = null;
    this.responseText = '';
    this.responseType = '';
    this.responseURL = '';
    this.status = 0;
    this.statusText = '';
    this.timeout = 0;
    this.withCredentials = false;
    this._headers = new Map();
    this._requestHeaders = new Map();
  }

  XMLHttpRequest.UNSENT = 0;
  XMLHttpRequest.OPENED = 1;
  XMLHttpRequest.HEADERS_RECEIVED = 2;
  XMLHttpRequest.LOADING = 3;
  XMLHttpRequest.DONE = 4;
  for (const name of ['UNSENT', 'OPENED', 'HEADERS_RECEIVED', 'LOADING', 'DONE']) {
    XMLHttpRequest.prototype[name] = XMLHttpRequest[name];
  }
  XMLHttpRequest.prototype.open = function open(method, url, async = true) {
    this.method = String(method);
    this.async = Boolean(async);
    this.url = String(url);
    this.responseURL = new URL(this.url, location.href).href;
    this.readyState = XMLHttpRequest.OPENED;
    window.encode_url = this.url;
    this.dispatchEvent(new BrowserEvent('readystatechange'));
  };
  XMLHttpRequest.prototype.setRequestHeader = function setRequestHeader(name, value) {
    if (this.readyState !== XMLHttpRequest.OPENED) throw new Error('InvalidStateError');
    this._requestHeaders.set(String(name).toLowerCase(), String(value));
  };
  XMLHttpRequest.prototype.getResponseHeader = function getResponseHeader(name) {
    return this._headers.get(String(name).toLowerCase()) ?? null;
  };
  XMLHttpRequest.prototype.getAllResponseHeaders = function getAllResponseHeaders() {
    return [...this._headers].map(([name, value]) => `${name}: ${value}`).join('\r\n');
  };
  XMLHttpRequest.prototype.send = function send(data = null) {
    if (this.readyState !== XMLHttpRequest.OPENED) throw new Error('InvalidStateError');
    this.requestBody = data;
    window.encode_data = data;
    this.readyState = XMLHttpRequest.DONE;
    this.dispatchEvent(new BrowserEvent('readystatechange'));
    this.dispatchEvent(new BrowserEvent('loadend'));
  };
  XMLHttpRequest.prototype.abort = function abort() {
    this.readyState = XMLHttpRequest.UNSENT;
    this.dispatchEvent(new BrowserEvent('abort'));
    this.dispatchEvent(new BrowserEvent('loadend'));
  };
  ObjectDefineProperty(XMLHttpRequest.prototype, Symbol.toStringTag, {
    __proto__: null,
    configurable: true,
    value: 'XMLHttpRequest',
  });
  return XMLHttpRequest;
}

function createMutationObserver() {
  return class MutationObserver {
    constructor(callback) {
      if (typeof callback !== 'function') throw new TypeError('MutationObserver callback must be a function');
      this.callback = callback;
      this.records = [];
    }

    observe(target, options) {
      this.target = target;
      this.options = options;
    }

    disconnect() {
      this.target = undefined;
      this.records.length = 0;
    }

    takeRecords() {
      const records = ArrayPrototypeSlice(this.records);
      this.records.length = 0;
      return records;
    }
  };
}

function IDBOpenDBRequest() {
  throw new TypeError('Illegal constructor');
}

function IDBRequest() {
  throw new TypeError('Illegal constructor');
}

function IDBDatabase() {
  throw new TypeError('Illegal constructor');
}

function IDBTransaction() {
  throw new TypeError('Illegal constructor');
}

function IDBObjectStore() {
  throw new TypeError('Illegal constructor');
}

ObjectDefineProperty(IDBOpenDBRequest.prototype, Symbol.toStringTag, {
  __proto__: null,
  configurable: true,
  value: 'IDBOpenDBRequest',
});
ObjectDefineProperty(IDBRequest.prototype, Symbol.toStringTag, {
  __proto__: null,
  configurable: true,
  value: 'IDBRequest',
});
ObjectDefineProperty(IDBDatabase.prototype, Symbol.toStringTag, {
  __proto__: null,
  configurable: true,
  value: 'IDBDatabase',
});
ObjectDefineProperty(IDBTransaction.prototype, Symbol.toStringTag, {
  __proto__: null,
  configurable: true,
  value: 'IDBTransaction',
});
ObjectDefineProperty(IDBObjectStore.prototype, Symbol.toStringTag, {
  __proto__: null,
  configurable: true,
  value: 'IDBObjectStore',
});

function dispatchRequestEvent(request, type) {
  request.dispatchEvent(new BrowserEvent(type));
}

function createIDBRequest(database, source, transaction, execute) {
  const request = ObjectCreate(IDBRequest.prototype);
  createEventTarget(request);
  request.error = null;
  request.onerror = null;
  request.onsuccess = null;
  request.readyState = 'pending';
  request.result = undefined;
  request.source = source;
  request.transaction = transaction;
  database._enqueue(() => {
    request.result = execute();
    request.readyState = 'done';
    dispatchRequestEvent(request, 'success');
  });
  return request;
}

function createIDBObjectStore(database, transaction, state) {
  const store = ObjectCreate(IDBObjectStore.prototype);
  defineInternal(store, '_database', database);
  defineInternal(store, '_state', state);
  defineInternal(store, '_transaction', transaction);
  ObjectDefineProperty(store, 'keyPath', {
    __proto__: null,
    configurable: true,
    enumerable: true,
    value: state.keyPath,
    writable: false,
  });
  ObjectDefineProperty(store, 'name', {
    __proto__: null,
    configurable: true,
    enumerable: true,
    value: state.name,
    writable: false,
  });
  ObjectDefineProperty(store, 'transaction', {
    __proto__: null,
    configurable: true,
    enumerable: true,
    value: transaction,
    writable: false,
  });
  return store;
}

function createIDBTransaction(database, storeNames, mode = 'readonly') {
  const transaction = ObjectCreate(IDBTransaction.prototype);
  const names = ArrayIsArray(storeNames) ? ArrayPrototypeSlice(storeNames) : [storeNames];
  defineInternal(transaction, '_database', database);
  defineInternal(transaction, '_storeNames', names.map(String));
  ObjectDefineProperty(transaction, 'db', {
    __proto__: null,
    configurable: true,
    enumerable: true,
    value: database,
    writable: false,
  });
  ObjectDefineProperty(transaction, 'mode', {
    __proto__: null,
    configurable: true,
    enumerable: true,
    value: String(mode),
    writable: false,
  });
  ObjectDefineProperty(transaction, 'objectStoreNames', {
    __proto__: null,
    configurable: true,
    enumerable: true,
    value: createDOMStringList(() => transaction._storeNames),
    writable: false,
  });
  return transaction;
}

IDBDatabase.prototype.close = function close() {};
IDBDatabase.prototype.createObjectStore = function createObjectStore(name, options = {}) {
  const state = {
    keyPath: options.keyPath ?? null,
    name: String(name),
    records: new SafeMap(),
  };
  MapPrototypeSet(this._stores, state.name, state);
  return createIDBObjectStore(this, null, state);
};
IDBDatabase.prototype.transaction = function transaction(storeNames, mode) {
  return createIDBTransaction(this, storeNames, mode);
};
IDBTransaction.prototype.objectStore = function objectStore(name) {
  const state = MapPrototypeGet(this._database._stores, String(name));
  if (state === undefined) throw new Error('NotFoundError');
  return createIDBObjectStore(this._database, this, state);
};
IDBObjectStore.prototype.put = function put(value, key = undefined) {
  const state = this._state;
  const recordKey = key === undefined && typeof state.keyPath === 'string' &&
    value !== null && typeof value === 'object' ? value[state.keyPath] : key;
  return createIDBRequest(this._database, this, this._transaction, () => {
    MapPrototypeSet(state.records, recordKey, value);
    return recordKey;
  });
};
IDBObjectStore.prototype.get = function get(key) {
  const state = this._state;
  return createIDBRequest(this._database, this, this._transaction,
    () => MapPrototypeGet(state.records, key));
};

function createIndexedDB(taskQueue) {
  const databases = new SafeMap();
  const enqueue = taskQueue.enqueue;

  function createDatabase(name, version) {
    const database = ObjectCreate(IDBDatabase.prototype);
    defineInternal(database, '_enqueue', enqueue);
    defineInternal(database, '_stores', new SafeMap());
    ObjectDefineProperty(database, 'name', {
      __proto__: null,
      configurable: true,
      enumerable: true,
      value: name,
      writable: false,
    });
    ObjectDefineProperty(database, 'version', {
      __proto__: null,
      configurable: true,
      enumerable: true,
      value: version,
      writable: false,
    });
    ObjectDefineProperty(database, 'objectStoreNames', {
      __proto__: null,
      configurable: true,
      enumerable: true,
      value: createDOMStringList(() => {
        const names = [];
        for (const [storeName] of MapPrototypeEntries(database._stores)) {
          ArrayPrototypePush(names, storeName);
        }
        return ArrayPrototypeSort(names);
      }),
      writable: false,
    });
    return database;
  }

  function createRequest(database, upgrade) {
    const request = ObjectCreate(IDBOpenDBRequest.prototype);
    createEventTarget(request);
    request.error = null;
    request.onblocked = null;
    request.onerror = null;
    request.onsuccess = null;
    request.onupgradeneeded = null;
    request.readyState = 'pending';
    request.result = undefined;
    request.transaction = null;
    enqueue(() => {
      request.result = database;
      if (upgrade) {
        request.transaction = createIDBTransaction(database, [], 'versionchange');
        dispatchRequestEvent(request, 'upgradeneeded');
      }
      request.readyState = 'done';
      request.transaction = null;
      dispatchRequestEvent(request, 'success');
    });
    return request;
  }

  return {
    deleteDatabase(name) {
      MapPrototypeDelete(databases, String(name));
      return createRequest(undefined, false);
    },
    open(name, version = 1) {
      const databaseName = String(name);
      let database = MapPrototypeGet(databases, databaseName);
      const upgrade = database === undefined;
      if (upgrade) {
        database = createDatabase(databaseName, Number(version));
        MapPrototypeSet(databases, databaseName, database);
      }
      return createRequest(database, upgrade);
    },
  };
}

function createChrome() {
  return {
    app: {
      InstallState: {
        DISABLED: 'disabled',
        INSTALLED: 'installed',
        NOT_INSTALLED: 'not_installed',
      },
      RunningState: {
        CANNOT_RUN: 'cannot_run',
        READY_TO_RUN: 'ready_to_run',
        RUNNING: 'running',
      },
      isInstalled: false,
    },
    csi() { return {}; },
    loadTimes() { return {}; },
  };
}

function createBrowserWebSocket() {
  const constants = [
    ['CONNECTING', 0],
    ['OPEN', 1],
    ['CLOSING', 2],
    ['CLOSED', 3],
  ];

  function browserSocketState(socket) {
    const state = kBrowserWebSocketStates.get(socket);
    if (state === undefined) throw new TypeError('Illegal invocation');
    return state;
  }

  function BrowserWebSocket(url) {
    if (new.target === undefined) {
      throw new TypeError("Failed to construct 'WebSocket': Please use the 'new' operator");
    }
    kBrowserWebSocketStates.set(this, {
      binaryType: 'blob',
      bufferedAmount: 0,
      extensions: '',
      onclose: null,
      onerror: null,
      onmessage: null,
      onopen: null,
      protocol: '',
      readyState: 0,
      url: String(url),
    });
    createEventTarget(this);
  }

  ObjectDefineProperty(BrowserWebSocket, 'name', {
    __proto__: null,
    configurable: true,
    enumerable: false,
    value: 'WebSocket',
    writable: false,
  });
  ObjectSetPrototypeOf(BrowserWebSocket.prototype, EventTarget.prototype);
  ObjectDefineProperty(BrowserWebSocket.prototype, Symbol.toStringTag, {
    __proto__: null,
    configurable: true,
    enumerable: false,
    value: 'WebSocket',
    writable: false,
  });

  for (const name of ['url', 'readyState', 'bufferedAmount', 'extensions', 'protocol']) {
    ObjectDefineProperty(BrowserWebSocket.prototype, name, {
      __proto__: null,
      configurable: true,
      enumerable: true,
      get() { return browserSocketState(this)[name]; },
    });
  }
  for (const name of ['onopen', 'onerror', 'onclose', 'onmessage']) {
    ObjectDefineProperty(BrowserWebSocket.prototype, name, {
      __proto__: null,
      configurable: true,
      enumerable: true,
      get() { return browserSocketState(this)[name]; },
      set(value) { browserSocketState(this)[name] = value; },
    });
  }
  ObjectDefineProperty(BrowserWebSocket.prototype, 'binaryType', {
    __proto__: null,
    configurable: true,
    enumerable: true,
    get() { return browserSocketState(this).binaryType; },
    set(value) {
      const binaryType = String(value);
      if (binaryType === 'blob' || binaryType === 'arraybuffer') {
        browserSocketState(this).binaryType = binaryType;
      }
    },
  });
  for (const [name, value] of constants) {
    for (const target of [BrowserWebSocket, BrowserWebSocket.prototype]) {
      ObjectDefineProperty(target, name, {
        __proto__: null,
        configurable: false,
        enumerable: true,
        value,
        writable: false,
      });
    }
  }
  ObjectDefineProperty(BrowserWebSocket.prototype, 'close', {
    __proto__: null,
    configurable: true,
    enumerable: true,
    value: function close() {
      const state = browserSocketState(this);
      if (state.readyState === 3) return;
      state.readyState = 3;
      const event = new BrowserEvent('close');
      if (typeof state.onclose === 'function') state.onclose.call(this, event);
      this.dispatchEvent(event);
    },
    writable: true,
  });
  ObjectDefineProperty(BrowserWebSocket.prototype, 'send', {
    __proto__: null,
    configurable: true,
    enumerable: true,
    value: function send() {
      if (browserSocketState(this).readyState === 0) {
        throw new Error('WebSocket is not open');
      }
    },
    writable: true,
  });

  // A Proxy keeps Function.prototype.toString from disclosing the JavaScript
  // implementation while retaining the browser constructor's normal own-key
  // surface (notably, no own `toString` property).
  const facade = new Proxy(BrowserWebSocket, {});
  ObjectDefineProperty(BrowserWebSocket.prototype, 'constructor', {
    __proto__: null,
    configurable: true,
    enumerable: false,
    value: facade,
    writable: true,
  });
  return facade;
}

function createBrowserRequest() {
  function requestState(request) {
    const state = kBrowserRequestStates.get(request);
    if (state === undefined) throw new TypeError('Illegal invocation');
    return state;
  }

  function BrowserRequest(input, init = {}) {
    if (new.target === undefined) {
      throw new TypeError("Failed to construct 'Request': Please use the 'new' operator");
    }
    const source = kBrowserRequestStates.get(input);
    const options = init ?? {};
    kBrowserRequestStates.set(this, {
      body: options.body ?? source?.body ?? null,
      bodyUsed: false,
      cache: options.cache ?? source?.cache ?? 'default',
      credentials: options.credentials ?? source?.credentials ?? 'same-origin',
      destination: '',
      duplex: options.duplex ?? source?.duplex ?? 'half',
      headers: options.headers ?? source?.headers ?? {},
      integrity: options.integrity ?? source?.integrity ?? '',
      isHistoryNavigation: false,
      isReloadNavigation: false,
      keepalive: options.keepalive ?? source?.keepalive ?? false,
      method: String(options.method ?? source?.method ?? 'GET').toUpperCase(),
      mode: options.mode ?? source?.mode ?? 'cors',
      redirect: options.redirect ?? source?.redirect ?? 'follow',
      referrer: options.referrer ?? source?.referrer ?? 'about:client',
      referrerPolicy: options.referrerPolicy ?? source?.referrerPolicy ?? '',
      signal: options.signal ?? source?.signal ?? null,
      targetAddressSpace: undefined,
      url: String(source?.url ?? input),
    });
  }

  ObjectDefineProperty(BrowserRequest, 'name', {
    __proto__: null,
    configurable: true,
    enumerable: false,
    value: 'Request',
    writable: false,
  });
  ObjectDefineProperty(BrowserRequest.prototype, Symbol.toStringTag, {
    __proto__: null,
    configurable: true,
    enumerable: false,
    value: 'Request',
    writable: false,
  });
  for (const name of [
    'method', 'url', 'headers', 'destination', 'referrer', 'referrerPolicy',
    'mode', 'credentials', 'cache', 'redirect', 'integrity', 'keepalive',
    'signal', 'duplex', 'isHistoryNavigation', 'bodyUsed',
  ]) {
    ObjectDefineProperty(BrowserRequest.prototype, name, {
      __proto__: null,
      configurable: true,
      enumerable: true,
      get() { return requestState(this)[name]; },
    });
  }
  for (const name of ['arrayBuffer', 'blob', 'formData', 'json', 'text', 'bytes']) {
    ObjectDefineProperty(BrowserRequest.prototype, name, {
      __proto__: null,
      configurable: true,
      enumerable: true,
      value: function consumeRequestBody() {
        const state = requestState(this);
        state.bodyUsed = true;
        switch (name) {
          case 'arrayBuffer': return Promise.resolve(new ArrayBuffer(0));
          case 'bytes': return Promise.resolve(new Uint8Array(0));
          case 'json': return Promise.reject(new SyntaxError('Unexpected end of JSON input'));
          case 'text': return Promise.resolve(state.body === null ? '' : String(state.body));
          default: return Promise.resolve({});
        }
      },
      writable: true,
    });
  }
  ObjectDefineProperty(BrowserRequest.prototype, 'clone', {
    __proto__: null,
    configurable: true,
    enumerable: true,
    value: function clone() { return new BrowserRequest(this); },
    writable: true,
  });
  for (const name of ['targetAddressSpace', 'isReloadNavigation', 'body', 'textStream']) {
    ObjectDefineProperty(BrowserRequest.prototype, name, {
      __proto__: null,
      configurable: true,
      enumerable: true,
      get() {
        if (name === 'textStream') return undefined;
        return requestState(this)[name];
      },
    });
  }

  const facade = new Proxy(BrowserRequest, {});
  ObjectDefineProperty(BrowserRequest.prototype, 'constructor', {
    __proto__: null,
    configurable: true,
    enumerable: false,
    value: facade,
    writable: true,
  });
  return facade;
}

function markBrowserInterfaces() {
  for (const constructor of [
    BrowserEvent,
    BrowserNode,
    BrowserText,
    BrowserElement,
    HTMLHtmlElement,
    HTMLHeadElement,
    HTMLBodyElement,
    HTMLDivElement,
    HTMLIFrameElement,
    HTMLMetaElement,
    HTMLScriptElement,
    HTMLTitleElement,
    HTMLAnchorElement,
    HTMLCanvasElement,
    CanvasRenderingContext2D,
    HTMLFormElement,
    HTMLInputElement,
    BrowserDocument,
    XPathExpression,
    HTMLCollection,
    DOMStringList,
    Storage,
    MimeType,
    MimeTypeArray,
    Plugin,
    PluginArray,
    IDBDatabase,
    IDBObjectStore,
    IDBOpenDBRequest,
    IDBRequest,
    IDBTransaction,
  ]) {
    markAsNativeFunction(constructor);
    markNativePrototype(constructor.prototype);
  }
}

function assertCustomPropertyName(name, protectedNames, targetName) {
  if (protectedNames.has(name)) {
    throw new TypeError(`${targetName}.${name} is a protected browser environment property`);
  }
}

function validateCustomProperties(source, protectedNames, targetName) {
  if (source === undefined) return;
  assertObject(source, `${targetName}.properties`);
  for (const key of ObjectKeys(source)) {
    assertCustomPropertyName(key, protectedNames, targetName);
  }
}

function applyCustomProperties(target, source, protectedNames, targetName) {
  if (source === undefined) return;
  validateCustomProperties(source, protectedNames, targetName);
  for (const key of ObjectKeys(source)) {
    ObjectDefineProperty(target, key, {
      __proto__: null,
      configurable: true,
      enumerable: true,
      value: source[key],
      writable: true,
    });
  }
}

function applyDocumentCustomProperties(target, source) {
  if (source === undefined) return;
  validateCustomProperties(source, kProtectedDocumentProperties, 'document');
  for (const key of ObjectKeys(source)) {
    if (key === 'visibilityState') {
      kBrowserDocumentStates.get(target).visibilityState = source[key];
      continue;
    }
    ObjectDefineProperty(target, key, {
      __proto__: null,
      configurable: true,
      enumerable: true,
      value: source[key],
      writable: true,
    });
  }
}

function validateCustomDescriptors(source, protectedNames, targetName) {
  if (source === undefined) return;
  assertObject(source, `${targetName}.descriptors`);
  for (const key of ObjectKeys(source)) {
    assertCustomPropertyName(key, protectedNames, targetName);
    const descriptor = source[key];
    assertObject(descriptor, `${targetName}.descriptors.${key}`);
  }
}

function applyCustomDescriptors(target, source, protectedNames, targetName) {
  if (source === undefined) return;
  validateCustomDescriptors(source, protectedNames, targetName);
  for (const key of ObjectKeys(source)) {
    const descriptor = source[key];
    ObjectDefineProperty(target, key, descriptor);
  }
}

function hideNodeGlobals() {
  for (const name of [
    'global', 'process', 'require', 'module', 'exports',
    '__dirname', '__filename', 'Buffer', 'setImmediate', 'clearImmediate',
    'internalBinding', 'primordials',
    // Node exposes its CommonJS built-ins as lazy globals. They are not
    // browser APIs, and merely reading the global key list must not reveal
    // the host runtime to a page.
    'assert', 'async_hooks', 'buffer', 'child_process', 'cluster',
    'constants', 'dgram', 'diagnostics_channel', 'dns', 'domain', 'events',
    'fs', 'http', 'http2', 'https', 'net', 'os', 'path', 'perf_hooks',
    'punycode', 'querystring', 'readline', 'repl', 'stream',
    'string_decoder', 'sys', 'timers', 'tls', 'trace_events', 'tty', 'url',
    'util', 'v8', 'vm', 'wasi', 'worker_threads', 'zlib',
    'node:sea', 'node:sqlite', 'node:test',
  ]) {
    const descriptor = ObjectGetOwnPropertyDescriptor(globalThis, name);
    if (descriptor?.configurable) delete globalThis[name];
  }
  const prepareStackTrace = ObjectGetOwnPropertyDescriptor(Error, 'prepareStackTrace');
  if (prepareStackTrace?.configurable) delete Error.prepareStackTrace;
}

function hideNodePerformanceExtensions() {
  for (
    let target = globalThis.performance;
    target !== null && target !== undefined;
    target = ObjectGetPrototypeOf(target)
  ) {
    const descriptor = ObjectGetOwnPropertyDescriptor(target, 'markResourceTiming');
    if (descriptor === undefined) continue;
    if (descriptor.configurable) delete target.markResourceTiming;
    break;
  }
}

function install(options) {
  if (installed) throw new Error('A browser environment is already installed in this Realm');
  assertObject(options, 'browser environment options');
  if (options.hideNodeGlobals !== undefined && typeof options.hideNodeGlobals !== 'boolean') {
    throw new TypeError('hideNodeGlobals must be a boolean');
  }
  if (options.browserEnvNavigationCallback !== undefined &&
      typeof options.browserEnvNavigationCallback !== 'function') {
    throw new TypeError('browserEnvNavigationCallback must be a function');
  }
  if (options.browserEnvLifecycleState !== undefined) {
    assertObject(options.browserEnvLifecycleState, 'browserEnvLifecycleState');
  }
  validateCustomProperties(options.window?.properties, kProtectedWindowProperties, 'window');
  validateCustomDescriptors(options.window?.descriptors, kProtectedWindowProperties, 'window');
  validateCustomProperties(options.document?.properties, kProtectedDocumentProperties, 'document');
  validateCustomDescriptors(options.document?.descriptors, kProtectedDocumentProperties, 'document');
  markBrowserInterfaces();

  const lifecycleState = options.browserEnvLifecycleState ?? {
    currentScript: null,
    readyState: 'loading',
  };
  lifecycleState.currentScript = null;
  lifecycleState.readyState = 'loading';
  const browserTaskQueue = createBrowserTaskQueue();
  ObjectDefineProperty(lifecycleState, 'waitForBrowserTasks', {
    __proto__: null,
    configurable: true,
    enumerable: false,
    value: browserTaskQueue.waitForIdle,
    writable: true,
  });
  const location = createLocation(getHref(options), options.browserEnvNavigationCallback);
  const document = new BrowserDocument(location, lifecycleState);
  kBrowserDocumentStates.get(document).defaultView = globalThis;
  const html = options.html ?? options.document?.html;
  if (html !== undefined) {
    if (typeof html !== 'string') throw new TypeError('html must be a string');
    document.loadHTML(html);
  }
  if (options.cookies !== undefined) {
    if (typeof options.cookies === 'string') document.cookie = options.cookies;
    else {
      assertObject(options.cookies, 'cookies');
      for (const key of ObjectKeys(options.cookies)) document.cookie = `${key}=${options.cookies[key]}`;
    }
  }

  const navigatorValues = {
    ...kDefaultNavigator,
    ...(options.navigator ?? {}),
  };
  if (!ArrayIsArray(navigatorValues.languages)) throw new TypeError('navigator.languages must be an array');
  if (options.navigator?.language === undefined) navigatorValues.language = navigatorValues.languages[0] ?? kDefaultNavigator.language;
  if (options.navigator?.appVersion === undefined) {
    navigatorValues.appVersion = String(navigatorValues.userAgent).replace(/^Mozilla\//, '');
  }
  if (ArrayIsArray(navigatorValues.mimeTypes)) navigatorValues.mimeTypes = createMimeTypeArray(navigatorValues.mimeTypes);
  if (ArrayIsArray(navigatorValues.plugins)) navigatorValues.plugins = createPluginArray(navigatorValues.plugins, navigatorValues.mimeTypes);
  assertObject(navigatorValues.connection, 'navigator.connection');
  const { NetworkInformation, connection } = createNetworkInformation(navigatorValues.connection);
  navigatorValues.connection = connection;
  const { BatteryManager, createBattery } = createBatteryManagerFactory();
  if (navigatorValues.sendBeacon === undefined) {
    navigatorValues.sendBeacon = markAsNativeFunction(function sendBeacon() { return true; });
  }
  if (navigatorValues.getBattery === undefined) {
    navigatorValues.getBattery = markAsNativeFunction(function getBattery() {
      return Promise.resolve(createBattery());
    });
  }
  if (navigatorValues.webkitPersistentStorage === undefined) {
    navigatorValues.webkitPersistentStorage = createDeprecatedStorageQuota();
  }
  const { Navigator, navigator } = createNavigator(navigatorValues);
  const screen = {
    availHeight: 1040,
    availLeft: 0,
    availTop: 0,
    availWidth: 1920,
    colorDepth: 24,
    height: 1080,
    orientation: {
      angle: 0,
      onchange: null,
      type: 'landscape-primary',
    },
    pixelDepth: 24,
    width: 1920,
    ...(options.screen ?? {}),
  };
  const history = createHistory(location);

  const allDelegate = {
    get(key) {
      const elements = walkElements(document, () => true);
      if (key === 'length') return elements.length;
      if (typeof key === 'number') return elements[key];
      if (typeof key === 'string' && /^\d+$/.test(key)) return elements[Number(key)];
      if (typeof key === 'string') return elements.find((element) =>
        element.id === key || element.getAttribute('name') === key);
      return undefined;
    },
    call(args) {
      return this.get(args[0]);
    },
  };
  kDocumentAllValues.set(document, createDocumentAll(allDelegate));

  function Window() {
    throw new TypeError('Illegal constructor');
  }
  function History() {
    throw new TypeError('Illegal constructor');
  }
  function Screen() {
    throw new TypeError('Illegal constructor');
  }
  function Location() {
    throw new TypeError('Illegal constructor');
  }
  for (const constructor of [Window, History, Screen, Location]) {
    markAsNativeFunction(constructor);
    markNativePrototype(constructor.prototype);
  }
  ObjectSetPrototypeOf(Window.prototype, ObjectGetPrototypeOf(globalThis));
  ObjectSetPrototypeOf(globalThis, Window.prototype);
  ObjectSetPrototypeOf(history, History.prototype);
  ObjectSetPrototypeOf(screen, Screen.prototype);
  ObjectSetPrototypeOf(location, Location.prototype);
  ObjectDefineProperty(Window.prototype, Symbol.toStringTag, {
    __proto__: null,
    configurable: true,
    value: 'Window',
  });
  ObjectDefineProperty(Screen.prototype, Symbol.toStringTag, {
    __proto__: null,
    configurable: true,
    value: 'Screen',
  });
  ObjectDefineProperty(Location.prototype, Symbol.toStringTag, {
    __proto__: null,
    configurable: true,
    value: 'Location',
  });

  const DOMParser = createDOMParser(location);
  const XMLHttpRequest = createXMLHttpRequest(globalThis, location);
  const MutationObserver = createMutationObserver();
  // Node exposes WebSocket through a lazy accessor. Redefining that accessor
  // initializes Undici and leaves host-only dispatcher symbols on window, so
  // remove it before installing the browser-facing constructor.
  delete globalThis.Request;
  delete globalThis.WebSocket;
  const Request = createBrowserRequest();
  const WebSocket = createBrowserWebSocket();

  ObjectDefineProperty(globalThis, 'window', { __proto__: null, configurable: true, enumerable: true, value: globalThis, writable: false });
  ObjectDefineProperty(globalThis, 'self', { __proto__: null, configurable: true, enumerable: true, value: globalThis, writable: false });
  ObjectDefineProperty(globalThis, 'top', { __proto__: null, configurable: true, enumerable: true, value: globalThis, writable: false });
  ObjectDefineProperty(globalThis, 'parent', { __proto__: null, configurable: true, enumerable: true, value: globalThis, writable: false });
  ObjectDefineProperty(globalThis, 'Window', { __proto__: null, configurable: true, enumerable: false, value: Window, writable: true });
  ObjectDefineProperty(globalThis, 'History', { __proto__: null, configurable: true, enumerable: false, value: History, writable: true });
  ObjectDefineProperty(globalThis, 'Screen', { __proto__: null, configurable: true, enumerable: false, value: Screen, writable: true });
  ObjectDefineProperty(globalThis, 'Location', { __proto__: null, configurable: true, enumerable: false, value: Location, writable: true });
  ObjectDefineProperty(globalThis, 'Navigator', { __proto__: null, configurable: true, enumerable: false, value: Navigator, writable: true });
  ObjectDefineProperty(globalThis, 'Event', { __proto__: null, configurable: true, enumerable: false, value: BrowserEvent, writable: true });
  ObjectDefineProperty(globalThis, 'Node', { __proto__: null, configurable: true, enumerable: false, value: BrowserNode, writable: true });
  ObjectDefineProperty(globalThis, 'Element', { __proto__: null, configurable: true, enumerable: false, value: BrowserElement, writable: true });
  ObjectDefineProperty(globalThis, 'HTMLElement', { __proto__: null, configurable: true, enumerable: false, value: BrowserElement, writable: true });
  ObjectDefineProperty(globalThis, 'Document', { __proto__: null, configurable: true, enumerable: false, value: BrowserDocument, writable: true });
  ObjectDefineProperty(globalThis, 'XPathExpression', { __proto__: null, configurable: true, enumerable: false, value: XPathExpression, writable: true });
  ObjectDefineProperty(globalThis, 'Text', { __proto__: null, configurable: true, enumerable: false, value: BrowserText, writable: true });
  ObjectDefineProperty(globalThis, 'HTMLAnchorElement', { __proto__: null, configurable: true, enumerable: false, value: HTMLAnchorElement, writable: true });
  ObjectDefineProperty(globalThis, 'HTMLBodyElement', { __proto__: null, configurable: true, enumerable: false, value: HTMLBodyElement, writable: true });
  ObjectDefineProperty(globalThis, 'HTMLCanvasElement', { __proto__: null, configurable: true, enumerable: false, value: HTMLCanvasElement, writable: true });
  ObjectDefineProperty(globalThis, 'CanvasRenderingContext2D', { __proto__: null, configurable: true, enumerable: false, value: CanvasRenderingContext2D, writable: true });
  ObjectDefineProperty(globalThis, 'HTMLCollection', { __proto__: null, configurable: true, enumerable: false, value: HTMLCollection, writable: true });
  ObjectDefineProperty(globalThis, 'DOMStringList', { __proto__: null, configurable: true, enumerable: false, value: DOMStringList, writable: true });
  ObjectDefineProperty(globalThis, 'HTMLDivElement', { __proto__: null, configurable: true, enumerable: false, value: HTMLDivElement, writable: true });
  ObjectDefineProperty(globalThis, 'HTMLFormElement', { __proto__: null, configurable: true, enumerable: false, value: HTMLFormElement, writable: true });
  ObjectDefineProperty(globalThis, 'HTMLHeadElement', { __proto__: null, configurable: true, enumerable: false, value: HTMLHeadElement, writable: true });
  ObjectDefineProperty(globalThis, 'HTMLHtmlElement', { __proto__: null, configurable: true, enumerable: false, value: HTMLHtmlElement, writable: true });
  ObjectDefineProperty(globalThis, 'HTMLIFrameElement', { __proto__: null, configurable: true, enumerable: false, value: HTMLIFrameElement, writable: true });
  ObjectDefineProperty(globalThis, 'HTMLInputElement', { __proto__: null, configurable: true, enumerable: false, value: HTMLInputElement, writable: true });
  ObjectDefineProperty(globalThis, 'HTMLMetaElement', { __proto__: null, configurable: true, enumerable: false, value: HTMLMetaElement, writable: true });
  ObjectDefineProperty(globalThis, 'HTMLScriptElement', { __proto__: null, configurable: true, enumerable: false, value: HTMLScriptElement, writable: true });
  ObjectDefineProperty(globalThis, 'HTMLTitleElement', { __proto__: null, configurable: true, enumerable: false, value: HTMLTitleElement, writable: true });
  ObjectDefineProperty(globalThis, 'MimeType', { __proto__: null, configurable: true, enumerable: false, value: MimeType, writable: true });
  ObjectDefineProperty(globalThis, 'MimeTypeArray', { __proto__: null, configurable: true, enumerable: false, value: MimeTypeArray, writable: true });
  ObjectDefineProperty(globalThis, 'Plugin', { __proto__: null, configurable: true, enumerable: false, value: Plugin, writable: true });
  ObjectDefineProperty(globalThis, 'PluginArray', { __proto__: null, configurable: true, enumerable: false, value: PluginArray, writable: true });
  ObjectDefineProperty(globalThis, 'IDBDatabase', { __proto__: null, configurable: true, enumerable: false, value: IDBDatabase, writable: true });
  ObjectDefineProperty(globalThis, 'IDBObjectStore', { __proto__: null, configurable: true, enumerable: false, value: IDBObjectStore, writable: true });
  ObjectDefineProperty(globalThis, 'IDBOpenDBRequest', { __proto__: null, configurable: true, enumerable: false, value: IDBOpenDBRequest, writable: true });
  ObjectDefineProperty(globalThis, 'IDBRequest', { __proto__: null, configurable: true, enumerable: false, value: IDBRequest, writable: true });
  ObjectDefineProperty(globalThis, 'IDBTransaction', { __proto__: null, configurable: true, enumerable: false, value: IDBTransaction, writable: true });
  ObjectDefineProperty(globalThis, 'BatteryManager', { __proto__: null, configurable: true, enumerable: false, value: BatteryManager, writable: true });
  ObjectDefineProperty(globalThis, 'NetworkInformation', { __proto__: null, configurable: true, enumerable: false, value: NetworkInformation, writable: true });
  ObjectDefineProperty(globalThis, 'Storage', { __proto__: null, configurable: true, enumerable: false, value: Storage, writable: true });
  ObjectDefineProperty(globalThis, 'DOMParser', { __proto__: null, configurable: true, enumerable: false, value: DOMParser, writable: true });
  ObjectDefineProperty(globalThis, 'XMLHttpRequest', { __proto__: null, configurable: true, enumerable: false, value: XMLHttpRequest, writable: true });
  ObjectDefineProperty(globalThis, 'MutationObserver', { __proto__: null, configurable: true, enumerable: false, value: MutationObserver, writable: true });
  ObjectDefineProperty(globalThis, 'Request', { __proto__: null, configurable: true, enumerable: false, value: Request, writable: true });
  ObjectDefineProperty(globalThis, 'WebSocket', { __proto__: null, configurable: true, enumerable: false, value: WebSocket, writable: true });
  ObjectDefineProperty(globalThis, 'document', { __proto__: null, configurable: true, enumerable: true, value: document, writable: false });
  ObjectDefineProperty(globalThis, 'navigator', { __proto__: null, configurable: true, enumerable: true, value: navigator, writable: false });
  ObjectDefineProperty(globalThis, 'clientInformation', { __proto__: null, configurable: true, enumerable: true, value: navigator, writable: false });
  ObjectDefineProperty(globalThis, 'location', {
    __proto__: null,
    configurable: true,
    enumerable: true,
    get() { return location; },
    set(value) { location.assign(value); },
  });
  ObjectDefineProperty(document, 'location', {
    __proto__: null,
    configurable: false,
    enumerable: true,
    get: markAsNativeFunction(function getLocation() { return location; }, 'get location'),
    set: markAsNativeFunction(function setLocation(value) { location.assign(value); }, 'set location'),
  });
  ObjectDefineProperty(globalThis, 'history', { __proto__: null, configurable: true, enumerable: true, value: history, writable: false });
  ObjectDefineProperty(globalThis, 'screen', { __proto__: null, configurable: true, enumerable: true, value: screen, writable: false });
  ObjectDefineProperty(globalThis, 'indexedDB', { __proto__: null, configurable: true, enumerable: true, value: createIndexedDB(browserTaskQueue), writable: false });
  ObjectDefineProperty(globalThis, 'chrome', { __proto__: null, configurable: true, enumerable: true, value: createChrome(), writable: false });
  ObjectDefineProperty(globalThis, 'TEMPORARY', { __proto__: null, configurable: true, enumerable: true, value: 0, writable: false });
  ObjectDefineProperty(globalThis, 'name', { __proto__: null, configurable: true, enumerable: true, value: '', writable: true });
  ObjectDefineProperty(globalThis, 'innerHeight', { __proto__: null, configurable: true, enumerable: true, value: 1080, writable: true });
  ObjectDefineProperty(globalThis, 'innerWidth', { __proto__: null, configurable: true, enumerable: true, value: 1920, writable: true });
  ObjectDefineProperty(globalThis, 'outerHeight', { __proto__: null, configurable: true, enumerable: true, value: 1080, writable: true });
  ObjectDefineProperty(globalThis, 'outerWidth', { __proto__: null, configurable: true, enumerable: true, value: 1920, writable: true });
  ObjectDefineProperty(globalThis, 'screenLeft', { __proto__: null, configurable: true, enumerable: true, value: 0, writable: true });
  ObjectDefineProperty(globalThis, 'screenTop', { __proto__: null, configurable: true, enumerable: true, value: 0, writable: true });
  ObjectDefineProperty(globalThis, 'screenX', { __proto__: null, configurable: true, enumerable: true, value: 0, writable: true });
  ObjectDefineProperty(globalThis, 'screenY', { __proto__: null, configurable: true, enumerable: true, value: 0, writable: true });
  ObjectDefineProperty(globalThis, 'open', {
    __proto__: null,
    configurable: true,
    enumerable: true,
    value: function open() {
      return { close() { this.closed = true; }, closed: false };
    },
    writable: true,
  });
  ObjectDefineProperty(globalThis, 'prompt', { __proto__: null, configurable: true, enumerable: true, value: function prompt() { return null; }, writable: true });
  ObjectDefineProperty(globalThis, 'webkitRequestFileSystem', { __proto__: null, configurable: true, enumerable: true, value: function webkitRequestFileSystem() { return {}; }, writable: true });
  if (globalThis.crypto !== undefined) {
    ObjectDefineProperty(globalThis, 'msCrypto', { __proto__: null, configurable: true, enumerable: true, value: globalThis.crypto, writable: false });
  }
  createEventTarget(globalThis);

  applyCustomProperties(globalThis, options.window?.properties, kProtectedWindowProperties, 'window');
  applyCustomDescriptors(globalThis, options.window?.descriptors, kProtectedWindowProperties, 'window');
  applyDocumentCustomProperties(document, options.document?.properties);
  applyCustomDescriptors(document, options.document?.descriptors, kProtectedDocumentProperties, 'document');

  ObjectDefineProperty(globalThis, 'localStorage', { __proto__: null, configurable: true, enumerable: true, value: createStorage(options.localStorage), writable: false });
  ObjectDefineProperty(globalThis, 'sessionStorage', { __proto__: null, configurable: true, enumerable: true, value: createStorage(options.sessionStorage), writable: false });

  hideNodePerformanceExtensions();
  if (options.hideNodeGlobals) {
    hideNodeGlobals();
  }
  lifecycleState.readyState = 'complete';
  installed = true;
  installedEnvironment = { window: globalThis, document, navigator, location };
  return installedEnvironment;
}

function isInstalled() {
  return installed;
}

function installFromProfile(path) {
  if (typeof path !== 'string' || path.length === 0) return;
  const { readFileSync } = require('fs');
  let profile;
  try {
    profile = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to load --browser-env-profile ${path}: ${error.message}`);
  }
  return install(profile);
}

module.exports = {
  install,
  installFromProfile,
  isInstalled,
};
