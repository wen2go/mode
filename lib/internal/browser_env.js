'use strict';

const {
  ArrayIsArray,
  ArrayPrototypeIncludes,
  ArrayPrototypeJoin,
  ArrayPrototypePush,
  ArrayPrototypeSlice,
  FunctionPrototypeCall,
  ObjectCreate,
  ObjectDefineProperty,
  ObjectGetOwnPropertyDescriptor,
  ObjectGetPrototypeOf,
  ObjectKeys,
  ObjectSetPrototypeOf,
  RegExpPrototypeExec,
  String,
  StringPrototypeSplit,
  StringPrototypeToLowerCase,
  StringPrototypeToUpperCase,
  Symbol,
} = primordials;

const { URL } = require('internal/url');

const { createDocumentAll } = internalBinding('browser_env');

const kVoidElements = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
]);

const kDefaultNavigator = {
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
    + '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  platform: 'Win32',
  language: 'en-US',
  languages: ['en-US', 'en'],
  vendor: 'Google Inc.',
  maxTouchPoints: 0,
  hardwareConcurrency: 8,
  deviceMemory: 8,
  webdriver: false,
};

const kProtectedWindowProperties = new Set([
  'window', 'self', 'top', 'parent', 'globalThis', 'document', 'location',
  'navigator', 'history', 'screen', 'Window', 'Navigator', 'Event',
  'Node', 'Element', 'HTMLElement', 'Document', 'Text', 'localStorage',
  'sessionStorage', 'addEventListener', 'removeEventListener', 'dispatchEvent',
]);

const kProtectedDocumentProperties = new Set([
  'all', 'location', 'documentElement', 'head', 'body', 'cookie',
  'createElement', 'createTextNode', 'appendChild', 'insertBefore',
  'removeChild', 'replaceChild', 'getElementById', 'getElementsByTagName',
  'getElementsByClassName', 'getElementsByName', 'querySelector',
  'querySelectorAll', 'defaultView', 'addEventListener', 'removeEventListener',
  'dispatchEvent',
]);

let installed = false;
let installedEnvironment;

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

function createEventTarget(target) {
  const listeners = new Map();
  ObjectDefineProperty(target, '_listeners', {
    __proto__: null,
    configurable: false,
    enumerable: false,
    value: listeners,
    writable: false,
  });
  target.addEventListener = function addEventListener(type, callback) {
    if (typeof callback !== 'function') return;
    const key = String(type);
    let callbacks = listeners.get(key);
    if (callbacks === undefined) {
      callbacks = [];
      listeners.set(key, callbacks);
    }
    if (!ArrayPrototypeIncludes(callbacks, callback)) ArrayPrototypePush(callbacks, callback);
  };
  target.removeEventListener = function removeEventListener(type, callback) {
    const callbacks = listeners.get(String(type));
    if (callbacks === undefined) return;
    const index = callbacks.indexOf(callback);
    if (index !== -1) callbacks.splice(index, 1);
  };
  target.dispatchEvent = function dispatchEvent(event) {
    if (event === null || typeof event !== 'object' || !event.type) {
      throw new TypeError('dispatchEvent requires an event with a type');
    }
    event.target ??= this;
    event.currentTarget = this;
    const callbacks = listeners.get(String(event.type));
    if (callbacks !== undefined) {
      for (const callback of ArrayPrototypeSlice(callbacks)) {
        FunctionPrototypeCall(callback, this, event);
      }
    }
    const handler = this[`on${event.type}`];
    if (typeof handler === 'function') FunctionPrototypeCall(handler, this, event);
    return !event.defaultPrevented;
  };
  return target;
}

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
    this.ownerDocument = ownerDocument;
    this.nodeType = nodeType;
    this.nodeName = nodeName;
    this.parentNode = null;
    this.childNodes = [];
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
    return this.childNodes.filter((node) => node.nodeType === 1);
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
}

class BrowserElement extends BrowserNode {
  constructor(ownerDocument, tagName) {
    const localName = StringPrototypeToLowerCase(String(tagName));
    super(ownerDocument, 1, StringPrototypeToUpperCase(localName));
    this.tagName = this.nodeName;
    this.localName = localName;
    this.attributes = ObjectCreate(null);
    this.style = ObjectCreate(null);
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

class BrowserDocument extends BrowserNode {
  constructor(location) {
    super(null, 9, '#document');
    this.ownerDocument = this;
    this._location = location;
    this._cookieJar = new Map();
    this.characterSet = 'UTF-8';
    this.charset = 'UTF-8';
    this.visibilityState = 'visible';
    this._resetDocumentElement();
  }

  _resetDocumentElement() {
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes.length = 0;
    this.documentElement = new BrowserElement(this, 'html');
    this.head = new BrowserElement(this, 'head');
    this.body = new BrowserElement(this, 'body');
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
    this.appendChild(this.documentElement);
  }

  get location() {
    return this._location;
  }

  get cookie() {
    return [...this._cookieJar].map(([key, value]) => `${key}=${value}`).join('; ');
  }

  set cookie(value) {
    const entry = StringPrototypeSplit(String(value), ';')[0];
    const index = entry.indexOf('=');
    if (index !== -1) this._cookieJar.set(entry.slice(0, index).trim(), entry.slice(index + 1).trim());
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
    return new BrowserElement(this, tagName);
  }

  createTextNode(data) {
    return new BrowserText(this, data);
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
    this._resetDocumentElement();
    if (parsedHtml !== undefined) {
      this.removeChild(this.documentElement);
      this.documentElement = parsedHtml;
      this.documentElement.parentNode = null;
      this.appendChild(this.documentElement);
      this.head = this.documentElement.children.find((node) => node.localName === 'head') ?? this.createElement('head');
      this.body = this.documentElement.children.find((node) => node.localName === 'body') ?? this.createElement('body');
      if (this.head.parentNode === null) this.documentElement.insertBefore(this.head, this.documentElement.firstChild);
      if (this.body.parentNode === null) this.documentElement.appendChild(this.body);
    } else {
      for (const node of nodes) this.body.appendChild(node);
    }
  }
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

function createLiveCollection(root, predicate) {
  const current = () => walkElements(root, predicate);
  return new Proxy(ObjectCreate(null), {
    get(target, property) {
      if (property === 'length') return current().length;
      if (property === 'item') return (index) => current()[index] ?? null;
      if (property === 'namedItem') return (name) => current().find((element) =>
        element.id === name || element.getAttribute('name') === name) ?? null;
      if (property === Symbol.iterator) return function* iterator() { yield* current(); };
      if (typeof property === 'string' && /^\d+$/.test(property)) return current()[Number(property)];
      return target[property];
    },
    ownKeys() {
      return [...current().keys()].map(String).concat('length');
    },
    getOwnPropertyDescriptor(target, property) {
      if (property === 'length' || (typeof property === 'string' && /^\d+$/.test(property))) {
        return { configurable: true, enumerable: true };
      }
      return ObjectGetOwnPropertyDescriptor(target, property);
    },
  });
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
  const tokenPattern = /<\/?([A-Za-z][\w:-]*)([^>]*)>|([^<]+)/g;
  let match;
  while ((match = tokenPattern.exec(source)) !== null) {
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
    if (!kVoidElements.has(tagName) && !/\/\s*$/.test(match[2])) ArrayPrototypePush(stack, element);
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

function createLocation(href) {
  let url;
  const replace = (value) => {
    url = new URL(String(value), url);
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
        if (key === 'href') replace(value);
        else url[key] = String(value);
      },
    });
  }
  location.assign = function assign(value) { replace(value); };
  location.replace = function replaceLocation(value) { replace(value); };
  location.reload = function reload() {};
  location.toString = function toString() { return url.href; };
  return location;
}

function createHistory(location) {
  const entries = [location.href];
  let index = 0;
  return {
    get length() { return entries.length; },
    get state() { return null; },
    pushState(state, unused, url) {
      if (url !== undefined && url !== null) location.assign(url);
      entries.splice(index + 1);
      ArrayPrototypePush(entries, location.href);
      index = entries.length - 1;
    },
    replaceState(state, unused, url) {
      if (url !== undefined && url !== null) location.replace(url);
      entries[index] = location.href;
    },
    back() {
      if (index > 0) location.assign(entries[--index]);
    },
    forward() {
      if (index + 1 < entries.length) location.assign(entries[++index]);
    },
    go(delta = 0) {
      const next = index + Number(delta);
      if (next >= 0 && next < entries.length) {
        index = next;
        location.assign(entries[index]);
      }
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
      get() { return value; },
    });
  }
  ObjectDefineProperty(Navigator.prototype, Symbol.toStringTag, {
    __proto__: null,
    configurable: true,
    value: 'Navigator',
  });
  const navigator = ObjectCreate(Navigator.prototype);
  return { Navigator, navigator };
}

function createStorage(seed) {
  const values = new Map(Object.entries(seed ?? {}));
  return {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.get(String(key)) ?? null; },
    setItem(key, value) { values.set(String(key), String(value)); },
    removeItem(key) { values.delete(String(key)); },
    clear() { values.clear(); },
  };
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

function install(options) {
  if (installed) throw new Error('A browser environment is already installed in this Realm');
  assertObject(options, 'browser environment options');
  validateCustomProperties(options.window?.properties, kProtectedWindowProperties, 'window');
  validateCustomDescriptors(options.window?.descriptors, kProtectedWindowProperties, 'window');
  validateCustomProperties(options.document?.properties, kProtectedDocumentProperties, 'document');
  validateCustomDescriptors(options.document?.descriptors, kProtectedDocumentProperties, 'document');

  const location = createLocation(getHref(options));
  const document = new BrowserDocument(location);
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
  const { Navigator, navigator } = createNavigator(navigatorValues);
  const screen = {
    availHeight: 1040,
    availLeft: 0,
    availTop: 0,
    availWidth: 1920,
    colorDepth: 24,
    height: 1080,
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
      if (typeof key === 'string' && /^\\d+$/.test(key)) return elements[Number(key)];
      if (typeof key === 'string') return elements.find((element) =>
        element.id === key || element.getAttribute('name') === key);
      return undefined;
    },
    call(args) {
      return this.get(args[0]);
    },
  };
  ObjectDefineProperty(document, 'all', {
    __proto__: null,
    configurable: false,
    enumerable: true,
    value: createDocumentAll(allDelegate),
    writable: false,
  });

  function Window() {
    throw new TypeError('Illegal constructor');
  }
  ObjectSetPrototypeOf(Window.prototype, ObjectGetPrototypeOf(globalThis));
  ObjectSetPrototypeOf(globalThis, Window.prototype);

  ObjectDefineProperty(globalThis, 'window', { __proto__: null, configurable: true, enumerable: true, value: globalThis, writable: false });
  ObjectDefineProperty(globalThis, 'self', { __proto__: null, configurable: true, enumerable: true, value: globalThis, writable: false });
  ObjectDefineProperty(globalThis, 'top', { __proto__: null, configurable: true, enumerable: true, value: globalThis, writable: false });
  ObjectDefineProperty(globalThis, 'parent', { __proto__: null, configurable: true, enumerable: true, value: globalThis, writable: false });
  ObjectDefineProperty(globalThis, 'Window', { __proto__: null, configurable: true, enumerable: false, value: Window, writable: true });
  ObjectDefineProperty(globalThis, 'Navigator', { __proto__: null, configurable: true, enumerable: false, value: Navigator, writable: true });
  ObjectDefineProperty(globalThis, 'Event', { __proto__: null, configurable: true, enumerable: false, value: BrowserEvent, writable: true });
  ObjectDefineProperty(globalThis, 'document', { __proto__: null, configurable: true, enumerable: true, value: document, writable: false });
  ObjectDefineProperty(globalThis, 'navigator', { __proto__: null, configurable: true, enumerable: true, value: navigator, writable: false });
  ObjectDefineProperty(globalThis, 'location', {
    __proto__: null,
    configurable: true,
    enumerable: true,
    get() { return location; },
    set(value) { location.assign(value); },
  });
  ObjectDefineProperty(globalThis, 'history', { __proto__: null, configurable: true, enumerable: true, value: history, writable: false });
  ObjectDefineProperty(globalThis, 'screen', { __proto__: null, configurable: true, enumerable: true, value: screen, writable: false });
  ObjectDefineProperty(document, 'defaultView', { __proto__: null, configurable: false, enumerable: true, value: globalThis, writable: false });
  createEventTarget(globalThis);

  applyCustomProperties(globalThis, options.window?.properties, kProtectedWindowProperties, 'window');
  applyCustomDescriptors(globalThis, options.window?.descriptors, kProtectedWindowProperties, 'window');
  applyCustomProperties(document, options.document?.properties, kProtectedDocumentProperties, 'document');
  applyCustomDescriptors(document, options.document?.descriptors, kProtectedDocumentProperties, 'document');

  ObjectDefineProperty(globalThis, 'localStorage', { __proto__: null, configurable: true, enumerable: true, value: createStorage(options.localStorage), writable: false });
  ObjectDefineProperty(globalThis, 'sessionStorage', { __proto__: null, configurable: true, enumerable: true, value: createStorage(options.sessionStorage), writable: false });

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
