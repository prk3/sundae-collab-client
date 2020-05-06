/* eslint-disable max-classes-per-file */

import WebSocket from 'ws';
import { EventEmitter } from 'events';

class EventTarget {
  private emitter: EventEmitter;

  constructor() {
    this.emitter = new EventEmitter();
  }

  addEventListener(type: string, callback: (event: any) => void) {
    this.emitter.addListener(type, callback);
  }

  removeEventListener(type: string, callback: (event: any) => void) {
    this.emitter.removeListener(type, callback);
  }

  dispatchEvent(event: any) {
    this.emitter.emit(event.type, event);
  }
}

class CustomEvent {
  readonly type: string;

  readonly detail: any;

  constructor(type: string, detail?: any) {
    this.type = type;
    this.detail = detail;
  }
}

class AbortSignal extends EventTarget {
  aborted: boolean;

  onabort: ((event: any) => void) | null;

  constructor() {
    super();
    super.addEventListener('abort', (event) => {
      this.aborted = true;
      this.onabort?.(event);
    });
    this.aborted = false;
    this.onabort = null;
  }

  addEventListener = (type: string, callback: (event: any) => void) => {
    super.addEventListener(type, (event) => {
      if (event.type === 'abort') {
        this.aborted = true;
      }
      callback(event);
    });
  };
}

class AbortController {
  readonly signal: AbortSignal;

  constructor() {
    this.signal = new AbortSignal();
  }

  abort() {
    this.signal.dispatchEvent(new CustomEvent('abort'));
  }
}

// @ts-ignore
globalThis.EventTarget = EventTarget;
// @ts-ignore
globalThis.AbortController = AbortController;
// @ts-ignore
globalThis.AbortSignal = AbortSignal;
// @ts-ignore
globalThis.CustomEvent = CustomEvent;
// @ts-ignore
globalThis.WebSocket = WebSocket;
