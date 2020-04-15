import jot from 'jot';
import { ServerMessage, ClientMessageData, ServerResponse } from 'sundae-collab-shared';
import Client, { Detach } from './client';
import log from './utils/log';
import { assertNotNull } from './utils/asserts';

export type SessionParticipant = { id: string, identity: any, color: number };
type State = { value: jot.Document, meta: jot.Meta };
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
 * Applies jot operation and state and returns a new, updated state.
 */
function applyOpOnState(op: jot.Operation, state: State): State {
  const meta = { in: state.meta, out: undefined as undefined | jot.Meta };
  const newValue = op.apply(state.value, meta);
  return { value: newValue, meta: meta.out ?? state.meta };
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
   * number = id of a timeout
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
    if (this.changeTimeout === 'unset') {
      this.changeTimeout = window.setTimeout(() => {
        this.changeTimeout = 'finished';
        this.tryProcessNextBatch();
      }, 450);
    }

    // apply change to the resource
    const newState = applyOpOnState(operation, { value: this.value, meta: this.meta });

    if (newState.value !== this.value) {
      this.value = newState.value;
      (this.emitter as EventTarget).dispatchEvent(new CustomEvent('value'));
    }

    if (newState.meta !== this.meta) {
      this.meta = newState.meta;
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

        const acceptedChange = this.sentChange;
        const oldSynced: State = { value: this.syncedValue, meta: this.syncedMeta };
        const newSynced = applyOpOnState(acceptedChange, oldSynced);
        this.syncedVersion = version;
        this.syncedValue = newSynced.value;
        this.syncedMeta = newSynced.meta;
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
    const oldSynced: State = { value: this.syncedValue, meta: this.syncedMeta };
    const newSynced = applyOpOnState(acceptedChange, oldSynced);
    this.syncedVersion = message.update.version;
    this.syncedValue = newSynced.value;
    this.syncedMeta = newSynced.meta;

    // rebase pending and sent changes

    if (this.pendingChange !== null) {
      const oldSentState = this.sentChange ? applyOpOnState(this.sentChange, oldSynced) : oldSynced;
      this.pendingChange = rebase(this.pendingChange, acceptedChange, oldSentState.value);
    }

    if (this.sentChange !== null) {
      this.sentChange = rebase(this.sentChange, acceptedChange, oldSynced.value);
    }

    let newState = newSynced;

    if (this.sentChange !== null) {
      newState = applyOpOnState(this.sentChange, newState);
    }
    if (this.pendingChange !== null) {
      newState = applyOpOnState(this.pendingChange, newState);
    }

    this.value = newState.value;
    this.meta = newState.meta;

    (this.emitter as EventTarget).dispatchEvent(new CustomEvent('value'));
    (this.emitter as EventTarget).dispatchEvent(new CustomEvent('meta'));
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
      .then((res) => new Session(client, res))
      .catch((err) => {
        if ((err.name as string).match(/NotFound/i)) {
          return makeStartPromise();
        }
        throw err;
      });
  };

  return makeJoinPromise();
}
