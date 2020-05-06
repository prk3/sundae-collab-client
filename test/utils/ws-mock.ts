/* eslint-disable max-classes-per-file */
import './polyfill';

class MessageEvent {
  data: string;

  type: string;

  constructor(data: string) {
    this.data = data;
    this.type = 'message';
  }
}

class WebSocketMock extends globalThis.EventTarget {
  url = '';

  readyState = 1;

  protocol = '';

  onopen: ((event: any) => void) | null = null;

  onerror: ((event: any) => void) | null = null;

  onclose: ((event: any) => void) | null = null;

  onmessage: ((event: any) => void) | null = null;

  send: jest.Mock<void, [string, (error?: Error) => void]>;

  close: jest.Mock<void, []>;

  constructor() {
    super();

    this.send = jest.fn((data, callback) => {
      callback?.(undefined);
    });
    this.close = jest.fn(() => {
      this.dispatchEvent(new CustomEvent('close'));
    });

    this.addEventListener('open', (event: any) => {
      this.onopen?.(event);
    });
    this.addEventListener('error', (event: any) => {
      this.onerror?.(event);
    });
    this.addEventListener('close', (event: any) => {
      this.onclose?.(event);
    });
    this.addEventListener('message', (event: any) => {
      this.onmessage?.(event);
    });

    // delay open action so that other code can has time to attach listeners
    setTimeout(() => this.dispatchEvent(new CustomEvent('open')), 0);
  }

  mockMessage(data: string) {
    this.dispatchEvent(new MessageEvent(data) as any);
  }
}

export default WebSocketMock;
