import { nanoid } from 'nanoid';
import {
  ResponsePacket, responsePacketValidator, errorDataValidator, ServerMessageType, ServerMessage,
  ServerResponse,
} from 'sundae-collab-shared';
import { ApplicationError } from './errors';

export type SendOptions = {
  timeout?: number,
  signal?: AbortSignal,
};

/**
 * Sends a server request to the socket and returns a promise resolving with
 * response data.
 */
export default function sendRequest<T extends ServerMessageType>(
  socket: WebSocket,
  message: ServerMessage<T>,
  {
    timeout = 30_000,
    signal,
  }: SendOptions,
): Promise<ServerResponse<T>> {
  const uid = nanoid();

  let timeoutId: number;
  let messageListener: (ev: MessageEvent) => void;
  let closeListener: () => void;
  let abortListener: () => void;

  // time limit, configurable through options
  const timeoutPromise = new Promise<ServerResponse<T>>((res, rej) => {
    timeoutId = window.setTimeout(() => {
      // don't need to clear timeout
      socket.removeEventListener('message', messageListener);
      socket.removeEventListener('close', closeListener);
      signal?.removeEventListener('abort', abortListener);
      rej(new Error('WS timeout. Either server did not respond or response could not be read.'));
    }, timeout);
  });

  // listen for socket events
  const responsePromise = new Promise<ServerResponse<T>>((res, rej) => {
    messageListener = ({ data }: MessageEvent) => {
      let packet: ResponsePacket;
      try {
        packet = responsePacketValidator.validateSync(JSON.parse(data), { strict: true });
      } catch (e) {
        // ignore if data is non-string, non-json or invalid response packet
        return;
      }
      if (packet.responseTo !== uid) {
        // ignore if response is for a different request
        return;
      }
      clearTimeout(timeoutId);
      socket.removeEventListener('message', messageListener);
      socket.removeEventListener('close', closeListener);
      signal?.removeEventListener('abort', abortListener);

      try {
        // reject if response data matches error response format
        const errData = errorDataValidator.validateSync(packet.data, { strict: true });
        rej(new ApplicationError(errData.error));
      } catch (e) {
        // not an error
        // the cast is necessary, but we could validate the response to be sure
        res(packet.data as ServerResponse<T>);
      }
    };
    // reject if socket closes before timeout
    closeListener = () => {
      window.clearTimeout(timeoutId);
      // don't need to clear message listener, socket will remove the handler
      signal?.removeEventListener('abort', abortListener);
      rej(new Error('Socket closed'));
    };
    socket.addEventListener('message', messageListener);
    socket.addEventListener('close', closeListener);
  });

  // request can be manually aborted
  const abortPromise = new Promise<ServerResponse<T>>((res, rej) => {
    if (signal) {
      abortListener = () => {
        window.clearTimeout(timeoutId);
        socket.removeEventListener('message', messageListener);
        socket.removeEventListener('close', closeListener);
        signal.removeEventListener('abort', abortListener);
        rej(new Error('Sending aborted'));
      };
      signal.addEventListener('abort', abortListener);
    }
  });

  // send the message
  socket.send(JSON.stringify({ uid, message }));

  return Promise.race([responsePromise, timeoutPromise, abortPromise]);
}
