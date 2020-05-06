import { nanoid } from 'nanoid';
import jot from 'jot';
import WebSocketMock from './utils/ws-mock';
import Client from '../src/client';
import { initSession } from '../src/session';
import './utils/polyfill';

async function delay(millis: number) {
  return new Promise((res) => setTimeout(res, millis));
}

async function makeBaseScenario() {
  const socket = new WebSocketMock();

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

  const sessionPromise = initSession(client, 'fake_type', 'fake_id', 'hello', 20);
  const joinId = JSON.parse(socket.send.mock.calls[1][0]).uid;
  socket.mockMessage(JSON.stringify({
    responseTo: joinId,
    data: {
      id: nanoid(),
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

  const session = await sessionPromise;
  socket.send.mockClear();
  return { socket, client, session };
}

describe('synchronization', () => {
  it('update emits events', async () => {
    const { session } = await makeBaseScenario();

    const valueListener = jest.fn(() => session.value);
    const metaListener = jest.fn(() => session.meta);
    session.emitter.addEventListener('value', valueListener);
    session.emitter.addEventListener('meta', metaListener);

    session.update(new jot.SPLICE(5, 0, ' '));
    await delay(0);
    expect(valueListener).toHaveLastReturnedWith('hello ');

    session.update(new jot.SELECT('alice', { start: 6, end: 6 }));
    await delay(0);
    expect(metaListener).toHaveLastReturnedWith(expect.objectContaining({
      selections: { '': { alice: { start: 6, end: 6 } } },
    }));
  });

  it('update sends throttled requests', async () => {
    const { socket, session } = await makeBaseScenario();

    const valueListener = jest.fn(() => session.value);
    const metaListener = jest.fn(() => session.meta);
    session.emitter.addEventListener('value', valueListener);
    session.emitter.addEventListener('meta', metaListener);

    session.update(new jot.SPLICE(5, 0, ' '));
    session.update(new jot.SELECT('alice', { start: 6, end: 6 }));
    session.update(new jot.SPLICE(6, 0, 'w'));
    session.update(new jot.SELECT('alice', { start: 7, end: 7 }));
    session.update(new jot.SPLICE(7, 0, 'o'));
    session.update(new jot.SELECT('alice', { start: 8, end: 8 }));

    await delay(0);
    expect(socket.send).toHaveBeenCalledTimes(0);

    await delay(25);
    expect(socket.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(socket.send.mock.calls[0][0])).toMatchObject({
      uid: expect.any(String),
      message: {
        type: 'UPDATE_RESOURCE',
        data: {
          sessionId: session.id,
          update: {
            base: 0,
            operation: new jot.LIST([
              new jot.SPLICE(5, 0, ' wo'),
              new jot.SELECT('alice', { start: 8, end: 8 }),
            ]).simplify().toJSON(),
          },
        },
      },
    });
  });

  it('resolves conflicts with sent', async () => {
    const { socket, session } = await makeBaseScenario();

    const valueListener = jest.fn(() => session.value);
    const metaListener = jest.fn(() => session.meta);
    session.emitter.addEventListener('value', valueListener);
    session.emitter.addEventListener('meta', metaListener);

    session.update(new jot.LIST([
      new jot.SPLICE(5, 0, ' world'),
      new jot.SELECT('alice', { start: 11, end: 11 }),
    ]));
    await delay(0);

    expect(valueListener).toHaveBeenCalledTimes(1);
    expect(valueListener).toHaveReturnedWith('hello world');

    expect(metaListener).toHaveBeenCalledTimes(1);
    expect(metaListener.mock.results[0].value).toMatchObject({
      selections: {
        '': {
          alice: { start: 11, end: 11 },
        },
      },
    });
    valueListener.mockClear();
    metaListener.mockClear();

    await delay(25);
    expect(socket.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(socket.send.mock.calls[0][0])).toMatchObject({
      message: {
        data: {
          update: {
            base: 0,
            operation: new jot.LIST([
              new jot.SPLICE(5, 0, ' world'),
              new jot.SELECT('alice', { start: 11, end: 11 }),
            ]).toJSON(),
          },
        },
      },
    });
    const updateRequest = JSON.parse(socket.send.mock.calls[0][0]);
    socket.send.mockClear();

    const externalUpdateMessage = {
      uid: nanoid(),
      message: {
        type: 'UPDATE_RESOURCE',
        data: {
          sessionId: session.id,
          update: {
            version: 1,
            operation: new jot.LIST([
              new jot.SPLICE(0, 0, 'say '),
              new jot.SELECT('bob', { start: 4, end: 4 }),
            ]),
          },
        },
      },
    };

    socket.mockMessage(JSON.stringify(externalUpdateMessage));
    await delay(0);

    expect(valueListener).toHaveBeenCalledTimes(1);
    expect(valueListener).toHaveReturnedWith('say hello world');

    expect(metaListener).toHaveBeenCalledTimes(1);
    expect(metaListener.mock.results[0].value).toMatchObject({
      selections: {
        '': {
          alice: { start: 15, end: 15 },
          bob: { start: 4, end: 4 },
        },
      },
    });

    const updateResponse = {
      responseTo: updateRequest,
      data: {
        version: 2,
      },
    };
    socket.mockMessage(JSON.stringify(updateResponse));
    await delay(0);
  });

  it('resolves conflicts with sent and pending', async () => {
    const { socket, session } = await makeBaseScenario();

    const valueListener = jest.fn(() => session.value);
    const metaListener = jest.fn(() => session.meta);
    session.emitter.addEventListener('value', valueListener);
    session.emitter.addEventListener('meta', metaListener);

    // internal update 1 (sent)
    session.update(new jot.LIST([
      new jot.SPLICE(5, 0, ' world'),
      new jot.SELECT('alice', { start: 11, end: 11 }),
    ]));
    await delay(0);

    expect(valueListener).toHaveBeenCalledTimes(1);
    expect(valueListener).toHaveReturnedWith('hello world');

    expect(metaListener).toHaveBeenCalledTimes(1);
    expect(metaListener.mock.results[0].value).toMatchObject({
      selections: {
        '': {
          alice: { start: 11, end: 11 },
        },
      },
    });
    valueListener.mockClear();
    metaListener.mockClear();

    // internal update sent to the server
    await delay(25);
    expect(socket.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(socket.send.mock.calls[0][0])).toMatchObject({
      message: {
        data: {
          update: {
            base: 0,
            operation: new jot.LIST([
              new jot.SPLICE(5, 0, ' world'),
              new jot.SELECT('alice', { start: 11, end: 11 }),
            ]).toJSON(),
          },
        },
      },
    });
    const updateRequest1 = JSON.parse(socket.send.mock.calls[0][0]);
    socket.send.mockClear();

    // internal update 2 (pending)
    session.update(new jot.LIST([
      new jot.SPLICE(11, 0, ' and foo bar'),
      new jot.SELECT('alice', { start: 23, end: 23 }),
    ]));
    await delay(0);
    expect(valueListener).toHaveBeenCalledTimes(1);
    expect(valueListener).toHaveReturnedWith('hello world and foo bar');

    expect(metaListener).toHaveBeenCalledTimes(1);
    expect(metaListener.mock.results[0].value).toMatchObject({
      selections: {
        '': {
          alice: { start: 23, end: 23 },
        },
      },
    });
    valueListener.mockClear();
    metaListener.mockClear();

    // session should not send new updates before response comes back
    await delay(25);
    expect(socket.send).toHaveBeenCalledTimes(0);
    socket.send.mockClear();

    // external update 1
    const externalUpdateMessage = {
      uid: nanoid(),
      message: {
        type: 'UPDATE_RESOURCE',
        data: {
          sessionId: session.id,
          update: {
            version: 1,
            operation: new jot.LIST([
              new jot.SPLICE(0, 0, 'say '),
              new jot.SELECT('bob', { start: 4, end: 4 }),
            ]),
          },
        },
      },
    };
    socket.mockMessage(JSON.stringify(externalUpdateMessage));
    await delay(0);

    expect(valueListener).toHaveBeenCalledTimes(1);
    expect(valueListener).toHaveReturnedWith('say hello world and foo bar');

    expect(metaListener).toHaveBeenCalledTimes(1);
    expect(metaListener.mock.results[0].value).toMatchObject({
      selections: {
        '': {
          alice: { start: 27, end: 27 },
          bob: { start: 4, end: 4 },
        },
      },
    });
    valueListener.mockClear();
    metaListener.mockClear();

    // session responds to external update
    expect(socket.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(socket.send.mock.calls[0][0])).toMatchObject({
      responseTo: externalUpdateMessage.uid,
      data: {},
    });
    socket.send.mockClear();

    // update 1 response sends pending changes
    const updateResponse1 = {
      responseTo: updateRequest1.uid,
      data: {
        version: 2,
      },
    };
    socket.mockMessage(JSON.stringify(updateResponse1));
    await delay(0);

    expect(socket.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(socket.send.mock.calls[0][0])).toMatchObject({
      message: {
        data: {
          update: {
            base: 2,
            operation: new jot.LIST([
              new jot.SPLICE(15, 0, ' and foo bar'),
              new jot.SELECT('alice', { start: 27, end: 27 }),
            ]).toJSON(),
          },
        },
      },
    });
  });
});
