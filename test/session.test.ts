import { nanoid } from 'nanoid';
import jot from 'jot';
import WebSocketMock from './utils/ws-mock';
import Client from '../src/client';
import { initSession } from '../src/session';
import './utils/polyfill';

async function delay(millis: number) {
  return new Promise((res) => setTimeout(res, millis));
}

async function makeAuthenticatedClient(socket: WebSocketMock) {
  const client = new Client(socket as any, { name: 'alice' });
  await delay(0);

  const authId = JSON.parse(socket.send.mock.calls[0][0]).uid;
  socket.mockMessage(JSON.stringify({
    responseTo: authId,
    data: {
      id: nanoid(),
    },
  }));
  await delay(0);

  socket.send.mockClear();
  return client;
}

async function makeSession(socket: WebSocketMock, client: Client, document: any) {
  const initialize = initSession(client, 'fake_type', 'fake_id', document);

  const startPacket = JSON.parse(socket.send.mock.calls[0][0]);

  const sessionId = nanoid();
  socket.mockMessage(JSON.stringify({
    responseTo: startPacket.uid,
    data: {
      id: sessionId,
      version: 0,
      value: 'hello',
      meta: {},
      participants: [{
        id: client.id,
        identity: client.identity,
        color: 0,
      }],
    },
  }));
  await delay(0);

  socket.send.mockClear();
  return initialize;
}

describe('session', () => {
  it('can be joined', async () => {
    const socket = new WebSocketMock();
    const client = await makeAuthenticatedClient(socket);

    const initialize = initSession(client, 'fake_type', 'fake_id', 'hello');

    expect(socket.send).toHaveBeenCalledTimes(1);
    const joinPacket = JSON.parse(socket.send.mock.calls[0][0]);
    expect(joinPacket).toMatchObject({
      uid: expect.any(String),
      message: {
        type: 'JOIN_SESSION',
        data: {
          resourceType: 'fake_type',
          resourceId: 'fake_id',
        },
      },
    });

    const sessionId = nanoid();
    socket.mockMessage(JSON.stringify({
      responseTo: joinPacket.uid,
      data: {
        id: sessionId,
        version: 0,
        value: 'hello',
        meta: {},
        participants: [{
          id: client.id,
          identity: client.identity,
          color: 0,
        }],
      },
    }));
    await delay(0);

    const session = await initialize;
    expect(session).toHaveProperty('id', sessionId);
    expect(session).toHaveProperty('value', 'hello');
    expect(session).toHaveProperty('meta', {});
    expect(session).toHaveProperty('participants', [{
      id: client.id,
      identity: client.identity,
      color: 0,
    }]);
  });

  it('can be started', async () => {
    const socket = new WebSocketMock();
    const client = await makeAuthenticatedClient(socket);

    const initialize = initSession(client, 'fake_type', 'fake_id', 'hello');

    const joinPacket = JSON.parse(socket.send.mock.calls[0][0]);
    socket.send.mockClear();
    socket.mockMessage(JSON.stringify({
      responseTo: joinPacket.uid,
      data: {
        error: {
          name: 'SessionNotFound',
          message: '',
        },
      },
    }));
    await delay(0);

    expect(socket.send).toHaveBeenCalledTimes(1);
    const startPacket = JSON.parse(socket.send.mock.calls[0][0]);
    expect(startPacket).toMatchObject({
      uid: expect.any(String),
      message: {
        type: 'START_SESSION',
        data: {
          resourceType: 'fake_type',
          resourceId: 'fake_id',
          resourceValue: 'hello',
        },
      },
    });

    const sessionId = nanoid();
    socket.mockMessage(JSON.stringify({
      responseTo: startPacket.uid,
      data: {
        id: sessionId,
        version: 0,
        meta: {},
        participants: [{
          id: client.id,
          identity: client.identity,
          color: 0,
        }],
      },
    }));
    await delay(0);

    const session = await initialize;
    expect(session).toHaveProperty('id', sessionId);
    expect(session).toHaveProperty('value', 'hello');
    expect(session).toHaveProperty('meta', {});
    expect(session).toHaveProperty('participants', [{
      id: client.id,
      identity: client.identity,
      color: 0,
    }]);
  });

  it('notifies about participant changes', async () => {
    const socket = new WebSocketMock();
    const client = await makeAuthenticatedClient(socket);
    const session = await makeSession(socket, client, 'hello');

    const detector = jest.fn(() => {});
    session.emitter.addEventListener('participants', detector);

    const addPacket = {
      uid: nanoid(),
      message: {
        type: 'ADD_PARTICIPANT',
        data: {
          sessionId: session.id,
          participantId: '012345678901234567890',
          participantIdentity: { name: 'bob' },
          participantColor: 1,
        },
      },
    };
    socket.mockMessage(JSON.stringify(addPacket));
    await delay(0);

    expect(detector).toHaveBeenCalledTimes(1);
    expect(session.participants).toContainEqual({
      id: '012345678901234567890',
      identity: { name: 'bob' },
      color: 1,
    });

    session.emitter.removeEventListener('participants', detector);
    session.emitter.addEventListener('participants', detector);
    detector.mockClear();

    const removePacket = {
      uid: nanoid(),
      message: {
        type: 'REMOVE_PARTICIPANT',
        data: {
          sessionId: session.id,
          participantId: '012345678901234567890',
        },
      },
    };
    socket.mockMessage(JSON.stringify(removePacket));
    await delay(0);

    expect(detector).toHaveBeenCalledTimes(1);
    expect(session.participants).not.toContainEqual({
      id: '012345678901234567890',
      identity: { name: 'bob' },
      color: 1,
    });
  });

  it('notifies about value changes', async () => {
    const socket = new WebSocketMock();
    const client = await makeAuthenticatedClient(socket);
    const session = await makeSession(socket, client, 'hello');

    const detector = jest.fn(() => {});
    session.emitter.addEventListener('value', detector);
    session.emitter.addEventListener('meta', detector);

    const updatePacket = {
      uid: nanoid(),
      message: {
        type: 'UPDATE_RESOURCE',
        data: {
          sessionId: session.id,
          participantId: nanoid(),
          update: {
            version: 1,
            operation: new jot.SPLICE(5, 0, ' world').toJSON(),
          },
        },
      },
    };
    socket.mockMessage(JSON.stringify(updatePacket));
    await delay(0);

    expect(detector).toHaveBeenCalledTimes(2);
    expect(session.value).toEqual('hello world');
  });
});
