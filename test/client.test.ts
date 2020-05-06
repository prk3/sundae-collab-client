import { nanoid } from 'nanoid';
import WebSocketMock from './utils/ws-mock';
import Client from '../src/client';
import './utils/polyfill';

async function delay(millis: number) {
  return new Promise((res) => setTimeout(res, millis));
}

async function waitForClientId(client: Client) {
  return new Promise<string | null>((res, rej) => {
    let listener: any;
    const timeout = setTimeout(() => {
      client.emitter.removeEventListener('id', listener);
      rej(new Error('Client id event timeout.'));
    }, 3000);
    listener = () => {
      clearTimeout(timeout);
      client.emitter.removeEventListener('id', listener);
      res(client.id);
    };
    client.emitter.addEventListener('id', listener);
  });
}

async function respondToAuth(socket: WebSocketMock, clientId?: string) {
  const authId = JSON.parse(socket.send.mock.calls[0][0]).uid;
  socket.mockMessage(JSON.stringify({
    responseTo: authId,
    data: {
      id: clientId ?? nanoid(),
    },
  }));
  await delay(0); // let the client handle message
}

describe('client', () => {
  it('sends authentication request', async () => {
    const socket = new WebSocketMock();
    const client = new Client(socket as any, { name: 'alice' });
    await delay(0); // open event needs time

    expect(socket.send).toHaveBeenCalledWith(expect.any(String));
    const packet = JSON.parse(socket.send.mock.calls[0][0]);
    expect(packet).toMatchObject({
      uid: expect.any(String),
      message: {
        type: 'AUTHENTICATE',
        data: {
          clientIdentity: { name: 'alice' },
        },
      },
    });

    const returnedId = nanoid();
    socket.mockMessage(JSON.stringify({
      responseTo: packet.uid,
      data: {
        id: returnedId,
      },
    }));

    const id = await waitForClientId(client);
    expect(id).toMatch(returnedId);
  });

  it('sends requests from send method', async () => {
    const socket = new WebSocketMock();
    const client = new Client(socket as any, { name: 'alice' });
    await delay(0); // open event needs time

    await respondToAuth(socket);
    socket.send.mockClear(); // clear saved auth calls

    const request = client.sendRequest({
      type: 'JOIN_SESSION',
      data: {
        resourceType: 'fake_type',
        resourceId: 'fake_id',
      },
    });

    expect(socket.send).toHaveBeenCalledWith(expect.any(String));
    const packet = JSON.parse(socket.send.mock.calls[0][0]);
    expect(packet).toMatchObject({
      uid: expect.any(String),
      message: request,
    });

    const returnedPacket = {
      responseTo: packet.uid,
      data: {
        id: nanoid(),
        version: 0,
        value: 'hello',
        meta: {},
        participants: [{
          id: nanoid(),
          identity: { name: 'bob' },
          color: 0,
        }],
      },
    };
    socket.mockMessage(JSON.stringify(returnedPacket));

    const response = await request;
    expect(response).toMatchObject(returnedPacket.data);
  });

  it('rejects on bad response', async () => {
    const socket = new WebSocketMock();
    const client = new Client(socket as any, { name: 'alice' });
    await delay(0); // open event needs time

    await respondToAuth(socket);
    socket.send.mockClear(); // clear saved auth calls

    const request = client.sendRequest({
      type: 'JOIN_SESSION',
      data: {
        resourceType: 'fake_type',
        resourceId: 'fake_id',
      },
    });

    expect(socket.send).toHaveBeenCalledWith(expect.any(String));
    const packet = JSON.parse(socket.send.mock.calls[0][0]);
    expect(packet).toMatchObject({
      uid: expect.any(String),
      message: request,
    });

    const returnedPacket = {
      responseTo: packet.uid,
      data: {
        error: {
          name: 'TestError',
          message: 'Just for testing.',
        },
      },
    };
    socket.mockMessage(JSON.stringify(returnedPacket));

    const error = await request.then(() => null).catch((err) => err);
    expect(error instanceof Error).toBeTruthy();
    expect(error.name).toEqual(returnedPacket.data.error.name);
    expect(error.message).toEqual(returnedPacket.data.error.message);
  });

  it('handles subscriptions correctly', async () => {
    const socket = new WebSocketMock();
    const client = new Client(socket as any, { name: 'alice' });
    await delay(0); // open event needs time

    await respondToAuth(socket);
    socket.send.mockClear(); // clear saved auth calls

    const sessionId = nanoid();
    const subscriptionHandler = jest.fn(() => ({}));
    const detachSubscription = client.subscribe(
      'ADD_PARTICIPANT',
      { sessionId },
      subscriptionHandler,
    );

    const packet1 = {
      uid: nanoid(),
      message: {
        type: 'ADD_PARTICIPANT',
        data: {
          sessionId: nanoid(),
          participantId: nanoid(),
          participantIdentity: { name: 'bob' },
          participantColor: 0,
        },
      },
    };

    socket.mockMessage(JSON.stringify(packet1));
    await delay(0);

    expect(subscriptionHandler).toHaveBeenCalledTimes(0);
    expect(socket.send).toHaveBeenCalledTimes(0);

    const packet2 = {
      uid: nanoid(),
      message: {
        type: 'REMOVE_PARTICIPANT',
        data: {
          sessionId,
          participantId: nanoid(),
        },
      },
    };

    socket.mockMessage(JSON.stringify(packet2));
    await delay(0);

    expect(subscriptionHandler).toHaveBeenCalledTimes(0);
    expect(socket.send).toHaveBeenCalledTimes(0);

    const packet3 = {
      uid: nanoid(),
      message: {
        type: 'ADD_PARTICIPANT',
        data: {
          sessionId,
          participantId: nanoid(),
          participantIdentity: { name: 'chris' },
          participantColor: 1,
        },
      },
    };

    socket.mockMessage(JSON.stringify(packet3));
    await delay(0);

    expect(subscriptionHandler).toHaveBeenCalledTimes(1);
    expect(subscriptionHandler).toHaveBeenCalledWith(packet3.message.data);
    expect(socket.send).toHaveBeenCalledTimes(1);
    const packet = JSON.parse(socket.send.mock.calls[0][0]);
    expect(packet).toMatchObject({
      responseTo: packet3.uid,
      data: {},
    });

    // no let's detach subscriber and send a message that could be handled
    detachSubscription();
    subscriptionHandler.mockClear();
    socket.send.mockClear();

    socket.mockMessage(JSON.stringify(packet3));
    await delay(0);

    expect(subscriptionHandler).toHaveBeenCalledTimes(0);
    expect(socket.send).toHaveBeenCalledTimes(0);
  });
});
