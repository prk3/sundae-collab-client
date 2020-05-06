import jot from 'jot';
import { ServerMessage, ClientMessageData, ServerResponse } from 'sundae-collab-shared';
import Client, { Detach } from './client';
import log from './utils/log';
import { assertNotNull } from './utils/asserts';

export type SessionParticipant = { id: string, identity: any, color: number };
type Callback = () => void;

/**
 * EventTarget for session.
 */
interface SessionEmitter {
  addEventListener(type: 'participants', callback: Callback): void;
  addEventListener(type: 'value', callback: Callback): void;
  addEventListener(type: 'meta', callback: Callback): void;
  removeEventListener(type: 'participants', callback: Callback): void;
  removeEventListener(type: 'value', callback: Callback): void;
  removeEventListener(type: 'meta', callback: Callback): void;
}

/**
 * Transforms a, such that it keeps the original intention if applied after b.
 */
function rebase(a: jot.Operation, b: jot.Operation, document: jot.Document): jot.Operation {
  const newOperation = a.rebase(b);
  if (newOperation === null) {
    log.warn('MERGE CONFLICT a.rebase(b)', { a: a.toJSON(), b: b.toJSON() });
    return a.rebase(b, { document });
  }
  return newOperation;
}

/**
 * Representation of a collaboration session. Takes care of synchronizing
 * changes with the collaboration server and shares the resource data through
 * properties and events.
 */
export default class Session {
  /**
   * Emits session events.
   */
  readonly emitter: SessionEmitter;

  /**
   * Id of the session.
   */
  id: string;

  /**
   * A list of session participants.
   */
  participants: SessionParticipant[];

  /**
   * Current value of a resource.
   */
  value: jot.Document;

  /**
   * Current metadata of a resource.
   */
  meta: jot.Meta;

  /**
   * Synced version of a resource.
   */
  private syncedVersion: number;

  /**
   * Synced value of a resource.
   */
  private syncedValue: jot.Document;

  /**
   * Synced metadata of a resource.
   */
  private syncedMeta: jot.Meta;

  /**
   * Timer started on any local change to the resource.
   * number = id of a timeout (or Timeout object in node!)
   * unset = timer has not been set
   * finished = timer has finished, but was not "unset" by update response
   */
  private changeTimeout: number | 'unset' | 'finished';

  /**
   * Changes made to the synced resource version and sent to the server.
   */
  private sentChange: jot.Operation | null;

  /**
   * Changes made to the sent resource version.
   */
  private pendingChange: jot.Operation | null;

  // detach functions
  private detachAddParticipant: Detach;

  private detachRemoveParticipant: Detach;

  private detachUpdateResource: Detach;

  /**
   * Constructs a Session instance out of client and join response data.
   * Warning: You probably want to use initSession function instead.
   */
  constructor(
    private readonly client: Client,
    data: ServerResponse<'JOIN_SESSION'>,
    private throttleTime = 300,
  ) {
    this.emitter = new EventTarget();
    this.id = data.id;
    this.participants = data.participants;
    this.value = data.value;
    this.meta = data.meta;
    this.syncedValue = data.value;
    this.syncedMeta = data.meta;
    this.syncedVersion = data.version;
    this.changeTimeout = 'unset';
    this.pendingChange = null;
    this.sentChange = null;

    // listen for participant and update requests

    this.detachAddParticipant = this.client.subscribe(
      'ADD_PARTICIPANT',
      { sessionId: this.id },
      (add) => {
        log.debug('< ADD_PARTICIPANT');
        const newParticipant = {
          id: add.participantId,
          identity: add.participantIdentity,
          color: add.participantColor,
        };
        this.participants = this.participants.concat(newParticipant);
        (this.emitter as EventTarget).dispatchEvent(new CustomEvent('participants'));
        return {};
      },
    );

    this.detachRemoveParticipant = this.client.subscribe(
      'REMOVE_PARTICIPANT',
      { sessionId: this.id },
      (remove) => {
        log.debug('< REMOVE_PARTICIPANT');
        this.participants = this.participants.filter((p) => p.id !== remove.participantId);
        (this.emitter as EventTarget).dispatchEvent(new CustomEvent('participants'));
        return {};
      },
    );

    this.detachUpdateResource = this.client.subscribe(
      'UPDATE_RESOURCE',
      { sessionId: this.id },
      (update) => {
        log.debug('< UPDATE_RESOURCE');
        this.handleExternalUpdate(update);
        return {};
      },
    );
  }

  /**
   * Update resource with a jot operation. Session will take care of syncing
   * the update with the collaboration server.
   */
  update(operation: jot.Operation) {
    // start change timeout if unset
    // timeout is casted to any because setTimeout returns number/Timeout
    // depending on the environment
    if (this.changeTimeout === 'unset') {
      this.changeTimeout = setTimeout(() => {
        this.changeTimeout = 'finished';
        this.tryProcessNextBatch();
      }, this.throttleTime) as any;
    }

    // apply change to the resource
    const [newValue, newMeta] = operation.applyWithMeta(this.value, this.meta);

    if (newValue !== this.value) {
      this.value = newValue;
      (this.emitter as EventTarget).dispatchEvent(new CustomEvent('value'));
    }

    if (newMeta !== this.meta) {
      this.meta = newMeta;
      (this.emitter as EventTarget).dispatchEvent(new CustomEvent('meta'));
    }

    // add operation to pending changes
    this.pendingChange = this.pendingChange === null
      ? operation
      : new jot.LIST([this.pendingChange, operation]).simplify();
  }

  /**
   * Close the session.
   */
  stop() {
    this.detachAddParticipant();
    this.detachRemoveParticipant();
    this.detachUpdateResource();

    if (this.client.id) {
      const leaveMessage: ServerMessage<'LEAVE_SESSION'> = {
        type: 'LEAVE_SESSION',
        data: {
          sessionId: this.id,
        },
      };

      this.client.sendRequest(leaveMessage)
        .catch((err) => log.error('Could not leave session', err));
    }
  }

  /**
   * Sends pending changes update when two criteria are met:
   * 1. change timeout is finished
   * 2. server responded to the last update
   */
  private tryProcessNextBatch() {
    if (this.changeTimeout === 'finished' && this.sentChange === null) {
      this.processPending();
    }
  }

  /**
   * Sends pending changes to the server. Tries processing next batch when
   * response comes back.
   */
  private processPending() {
    assertNotNull(this.pendingChange);

    log.debug('> UPDATE_RESOURCE', { base: this.syncedVersion, operation: this.pendingChange.toJSON() });
    const updateMessage: ServerMessage<'UPDATE_RESOURCE'> = {
      type: 'UPDATE_RESOURCE',
      data: {
        sessionId: this.id,
        update: {
          base: this.syncedVersion,
          operation: this.pendingChange.toJSON(),
        },
      },
    };
    this.sentChange = this.pendingChange;
    this.pendingChange = null;
    this.changeTimeout = 'unset';

    this.client.sendRequest(updateMessage)
      .then(({ version }) => {
        assertNotNull(this.sentChange);

        const [newSyncedValue, newSyncedMeta] = this.sentChange.applyWithMeta(
          this.syncedValue,
          this.syncedMeta,
        );
        this.syncedValue = newSyncedValue;
        this.syncedMeta = newSyncedMeta;
        this.syncedVersion = version;
        this.sentChange = null;
        this.tryProcessNextBatch();
      });
  }

  /**
   * Handles update request coming from the server. Rebases update against
   * local changes and applies it to the current resource state.
   */
  private handleExternalUpdate(message: ClientMessageData<'UPDATE_RESOURCE'>) {
    const acceptedChange = jot.opFromJSON(message.update.operation);
    const [newSyncedValue, newSyncedMeta] = acceptedChange.applyWithMeta(
      this.syncedValue,
      this.syncedMeta,
    );

    // rebase pending and sent changes

    if (this.pendingChange !== null) {
      const [sentValue] = this.sentChange
        ? this.sentChange.applyWithMeta(this.syncedValue, this.syncedMeta)
        : [this.syncedValue, this.syncedMeta];

      this.pendingChange = rebase(this.pendingChange, acceptedChange, sentValue);
    }

    if (this.sentChange !== null) {
      this.sentChange = rebase(this.sentChange, acceptedChange, this.syncedValue);
    }

    let [newValue, newMeta] = [newSyncedValue, newSyncedMeta];

    if (this.sentChange !== null) {
      [newValue, newMeta] = this.sentChange.applyWithMeta(newValue, newMeta);
    }
    if (this.pendingChange !== null) {
      [newValue, newMeta] = this.pendingChange.applyWithMeta(newValue, newMeta);
    }

    if (newValue !== this.value) {
      this.value = newValue;
      (this.emitter as EventTarget).dispatchEvent(new CustomEvent('value'));
    }

    if (newMeta !== this.meta) {
      this.meta = newMeta;
      (this.emitter as EventTarget).dispatchEvent(new CustomEvent('meta'));
    }

    this.syncedVersion = message.update.version;
    this.syncedValue = newSyncedValue;
    this.syncedMeta = newSyncedMeta;
  }
}

/**
 * Establishes a session given a client and initial resource value.
 * Starts a session if it does not exist. Joins the session if already
 * started.
 */
export function initSession(
  client: Client,
  resourceType: string,
  resourceId: string,
  resourceValue: jot.Document,
  throttleTime = 300,
) {
  let makeJoinPromise: () => Promise<Session>;

  const makeStartPromise = () => {
    log.debug('> START_SESSION');
    const startMessage: ServerMessage<'START_SESSION'> = {
      type: 'START_SESSION',
      data: {
        resourceType,
        resourceId,
        resourceValue,
      },
    };
    return client.sendRequest(startMessage)
      .then((res) => {
        const initData = {
          ...res,
          value: resourceValue,
          participants: res.participants,
        };
        return new Session(client, initData);
      })
      .catch((err) => {
        if ((err.name as string).match(/AlreadyExists/i)) {
          return makeJoinPromise();
        }
        throw err;
      });
  };

  makeJoinPromise = () => {
    log.debug('> JOIN_SESSION');
    const joinMessage: ServerMessage<'JOIN_SESSION'> = {
      type: 'JOIN_SESSION',
      data: {
        resourceType,
        resourceId,
      },
    };
    return client.sendRequest(joinMessage)
      .then((res) => new Session(client, res, throttleTime))
      .catch((err) => {
        if ((err.name as string).match(/NotFound/i)) {
          return makeStartPromise();
        }
        throw err;
      });
  };

  return makeJoinPromise();
}
