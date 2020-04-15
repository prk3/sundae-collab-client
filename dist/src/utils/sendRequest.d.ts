import { ServerMessageType, ServerMessage, ServerResponse } from 'shared';
export declare type SendOptions = {
    timeout?: number;
    signal?: AbortSignal;
};
/**
 * Sends a server request to the socket and returns a promise resolving with
 * response data.
 */
export default function sendRequest<T extends ServerMessageType>(socket: WebSocket, message: ServerMessage<T>, { timeout, signal, }: SendOptions): Promise<ServerResponse<T>>;
