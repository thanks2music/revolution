/**
 * Jest Polyfills
 *
 * This file runs BEFORE the test environment is set up.
 * It's the correct place to polyfill global APIs that need to exist
 * before any modules are loaded.
 *
 * Node.js v23+ includes TextEncoder/TextDecoder and Web Streams natively.
 * However, Jest's jsdom environment doesn't automatically expose them to globalThis.
 *
 * We must use require() instead of import to control execution order, because
 * undici needs these APIs to be available during its module initialization.
 */

// Step 1: Polyfill TextEncoder/TextDecoder
const { TextEncoder, TextDecoder } = require('util');
globalThis.TextEncoder = TextEncoder;
globalThis.TextDecoder = TextDecoder;

// Step 2: Polyfill Web Streams API
const { ReadableStream, WritableStream, TransformStream } = require('stream/web');
globalThis.ReadableStream = ReadableStream;
globalThis.WritableStream = WritableStream;
globalThis.TransformStream = TransformStream;

// Step 3: Polyfill MessageChannel/MessagePort (needed by undici)
const { MessageChannel, MessagePort } = require('worker_threads');
globalThis.MessageChannel = MessageChannel;
globalThis.MessagePort = MessagePort;

// Step 4: Now it's safe to require undici
const { fetch, Headers, Request, Response } = require('undici');

// Step 5: Polyfill fetch API
globalThis.fetch = fetch;
globalThis.Headers = Headers;
globalThis.Request = Request;
globalThis.Response = Response;
