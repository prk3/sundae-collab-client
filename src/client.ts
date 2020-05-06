import { nanoid } from 'nanoid';
import {
  ServerMessage, responsePacketValidator, requestPacketValidator, RequestPacket, messageValidator,
  ResponsePacket, ServerMessageType, ServerResponse, Message, ClientMessageType, ClientMessageData,
  ClientMessages,
  errorDataValidator,
} from 'sundae-collab-shared';
import sendRequest from './utils/sendRequest';
import { ApplicationError } from './utils/errors';
import log from './utils/log';

export type Detach = () => void;
type Callback = () => void;

/**
 * Checks if an incoming client request matches a request filter.
 * TODO: improve this function - maybe handle nested values and regexes
 */
function matches(data: any, filter: any) {
  return Object.entries(filter).every(([key, value]) => data[key] === value);
}

/**
 * EventTarget with client events.
 */
interface ClientEmitter {
  addEventListener(type: 'id', callback: Callback): void;
  removeEventListener(type: 'id', callback: Callback): void;
}

/**
 * Collaboration client. Provides abstraction over web socket connection with
 * custom protocol. Offers request sending and subscriptions for client
 * requests.
 */
export default class Client {
  /**
   * Emits client events.
   */
  readonly emitter: ClientEmitter;

  /**
   * Identity used for client authentication.
   */
  readonly identity: any;

  /**
   * Id of the client, null if not ready.
   */
  id: string | null;

  /**
   * Web socket client.
   */
  private socket: WebSocket;

  /**
   * Indicates if the client is ready and can handle protocol messages.
   */
  private isReady: boolean;

  /**
   * A list of requests that should be sent when the client is ready.
   * resolve and reject control request promise.
   */
  private requestQueue: { message: Message, res: any, rej: any }[];

  /**
   * Map with request resolve/reject handles.
   */
  private responseHandlers: Map<string, { res: any, rej: any }>;

  /**
   * A list of active subscriptions.
   */
  private requestSubscriptions: { type: string, filter: any, handler: (data: any) => any }[];

  /**
   * Creates Client instance given WebSocket client connected to the
   * collaboration service and user identity, which will be used for
   * authentication.
   */
  constructor(socket: WebSocket, identity: any) {
    this.identity = identity;

    this.emitter = new EventTarget();
    this.id = null;
    this.isReady = false;

    this.responseHandlers = new Map();
    this.requestSubscriptions = [];
    this.requestQueue = [];

    // initialize the socket
    this.socket = socket;
    this.socket.onopen = this.handleOpen;
    this.socket.onclose = this.handleClose;
  }

  /**
   * Sends a request to the server. The returned promise resolves with server
   * response.
   */
  sendRequest<T extends ServerMessageType>(message: ServerMessage<T>): Promise<ServerResponse<T>> {
    return new Promise((res, rej) => {
      this.requestQueue.push({ message, res, rej });
      this.sendQueuedRequests();
    });
  }

  /**
   * Adds a subscription for the request type. The handler gets called when
   * an incoming client request matches type and filter. The returned function
   * cancels the subscription.
   */
  subscribe<T extends ClientMessageType>(
    type: T,
    filter: Partial<ClientMessageData<T>>,
    handler: ClientMessages[T],
  ): Detach {
    this.requestSubscriptions.push({ type, filter, handler });
    return () => {
      this.requestSubscriptions = this.requestSubscriptions.filter((s) => s.handler !== handler);
    };
  }

  /**
   * Stops the client.
   */
  stop() {
    if (this.socket) {
      this.socket.onopen = null;
      this.socket.onmessage = null;
      this.socket.onclose = null;
      this.socket.close();
    }
    this.id = null;
    this.isReady = false;
    (this.emitter as EventTarget).dispatchEvent(new CustomEvent('id'));
  }

  /**
   * Socket open listener. Authenticates the collaboration client and updates
   * internal client data.
   */
  private handleOpen = () => {
    const message: ServerMessage<'AUTHENTICATE'> = {
      type: 'AUTHENTICATE',
      data: { clientIdentity: this.identity },
    };

    log.debug('> AUTHENTICATE');
    return sendRequest(this.socket, message, {})
      .then(({ id }) => {
        this.id = id;
        this.isReady = true;
        this.socket.onmessage = this.handleMessage;
        (this.emitter as EventTarget).dispatchEvent(new CustomEvent('id'));
        this.sendQueuedRequests();
      })
      .catch((err) => {
        log.error('Could not start collaboration client.', err);
      });
  };

  /**
   * Socket close listener. Logs the event.
   */
  private handleClose = () => {
    log.error('Client socket closed.');
  };

  /**
   * Socket message listener. Parses the message and directs to
   * request/response handlers listeners.
   */
  private handleMessage = (ev: MessageEvent) => {
    if (!this.isReady) {
      return;
    }

    let json: any;
    try {
      json = JSON.parse(ev.data);
    } catch (e) {
      log.warn('Non-json message.', ev.data);
      return;
    }

    try {
      const response: ResponsePacket = responsePacketValidator.validateSync(json, { strict: true });
      this.handleResponse(response);
      return;
    } catch (e) {
      // fine, maybe it's a request
    }

    let requestPacket: RequestPacket;
    try {
      requestPacket = requestPacketValidator.validateSync(json, { strict: true });
    } catch (e) {
      log.warn('Malformed packet.', { json, e });
      return;
    }

    let message: Message;
    try {
      message = messageValidator.validateSync(requestPacket.message);
      // TODO validate server messages
    } catch (e) {
      log.warn('Malformed message.', { requestPacket, e });
      return;
    }

    this.handleRequest(requestPacket, message);
  };

  /**
   * Flushes the request queue.
   */
  private sendQueuedRequests() {
    while (this.isReady && this.requestQueue.length > 0) {
      const { requestQueue } = this; // used only for type reading
      const { message, res, rej } = this.requestQueue.shift() as typeof requestQueue[0];
      const uid = nanoid();
      const packet: RequestPacket = { uid, message };
      this.socket.send(JSON.stringify(packet));
      this.responseHandlers.set(uid, { res, rej });
    }
  }

  /**
   * Resolves/rejects a request promise with the server response.
   */
  private handleResponse(response: ResponsePacket) {
    const handler = this.responseHandlers.get(response.responseTo);
    if (handler) {
      // remove listener, a response can only be received once
      this.responseHandlers.delete(response.responseTo);

      const { res, rej } = handler;
      try {
        const errData = errorDataValidator.validateSync(response.data, { strict: true });
        rej(new ApplicationError(errData.error));
      } catch (e) {
        res(response.data);
      }
    } else {
      log.warn('Received unexpected response from server.');
    }
  }

  /**
   * Forwards request to the appropriate subscription handler.
   */
  private handleRequest(packet: RequestPacket, message: Message) {
    // TODO can many subscriptions match one request?
    const sub = this.requestSubscriptions.find((s) => s.type === message.type
      && matches(message.data, s.filter));

    if (sub) {
      const result = sub.handler(message.data);
      const responsePacket: ResponsePacket = { responseTo: packet.uid, data: result };
      if (this.isReady && this.socket) {
        this.socket.send(JSON.stringify(responsePacket));
      } else {
        log.warn('Attempted sending response to inactive client.');
      }
    } else {
      log.warn('Request ignored - no matching subscriber.');
    }
  }
}
