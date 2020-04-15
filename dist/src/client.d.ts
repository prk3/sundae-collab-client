import { ServerMessage, ServerMessageType, ServerResponse, ClientMessageType, ClientMessageData, ClientMessages } from 'shared';
export declare type Detach = () => void;
declare type Callback = () => void;
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
    private socket;
    /**
     * Indicates if the client is ready and can handle protocol messages.
     */
    private isReady;
    /**
     * A list of requests that should be sent when the client is ready.
     * resolve and reject control request promise.
     */
    private requestQueue;
    /**
     * Map with request resolve/reject handles.
     */
    private responseHandlers;
    /**
     * A list of active subscriptions.
     */
    private requestSubscriptions;
    /**
     * Creates Client instance given url of the collaboration service (probably
     * starting with ws:// or wss://) and client identity which will be used
     * for authentication.
     */
    constructor(url: string, identity: any);
    /**
     * Sends a request to the server. The returned promise resolves with server
     * response.
     */
    sendRequest<T extends ServerMessageType>(message: ServerMessage<T>): Promise<ServerResponse<T>>;
    /**
     * Adds a subscription for the request type. The handler gets called when
     * an incoming client request matches type and filter. The returned function
     * cancels the subscription.
     */
    subscribe<T extends ClientMessageType>(type: T, filter: Partial<ClientMessageData<T>>, handler: ClientMessages[T]): Detach;
    /**
     * Stops the client.
     */
    stop(): void;
    /**
     * Socket open listener. Authenticates the collaboration client and updates
     * internal client data.
     */
    private handleOpen;
    /**
     * Socket close listener. Logs the event.
     */
    private handleClose;
    /**
     * Socket message listener. Parses the message and directs to
     * request/response handlers listeners.
     */
    private handleMessage;
    /**
     * Flushes the request queue.
     */
    private sendQueuedRequests;
    /**
     * Resolves/rejects a request promise with the server response.
     */
    private handleResponse;
    /**
     * Forwards request to the appropriate subscription handler.
     */
    private handleRequest;
}
export {};
