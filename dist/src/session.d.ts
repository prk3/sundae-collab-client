import jot from 'jot';
import { ServerResponse } from 'sundae-collab-shared';
import Client from './client';
export declare type SessionParticipant = {
    id: string;
    identity: any;
    color: number;
};
declare type Callback = () => void;
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
 * Representation of a collaboration session. Takes care of synchronizing
 * changes with the collaboration server and shares the resource data through
 * properties and events.
 */
export default class Session {
    private readonly client;
    private throttleTime;
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
    private syncedVersion;
    /**
     * Synced value of a resource.
     */
    private syncedValue;
    /**
     * Synced metadata of a resource.
     */
    private syncedMeta;
    /**
     * Timer started on any local change to the resource.
     * number = id of a timeout (or Timeout object in node!)
     * unset = timer has not been set
     * finished = timer has finished, but was not "unset" by update response
     */
    private changeTimeout;
    /**
     * Changes made to the synced resource version and sent to the server.
     */
    private sentChange;
    /**
     * Changes made to the sent resource version.
     */
    private pendingChange;
    private detachAddParticipant;
    private detachRemoveParticipant;
    private detachUpdateResource;
    /**
     * Constructs a Session instance out of client and join response data.
     * Warning: You probably want to use initSession function instead.
     */
    constructor(client: Client, data: ServerResponse<'JOIN_SESSION'>, throttleTime?: number);
    /**
     * Update resource with a jot operation. Session will take care of syncing
     * the update with the collaboration server.
     */
    update(operation: jot.Operation): void;
    /**
     * Close the session.
     */
    stop(): void;
    /**
     * Sends pending changes update when two criteria are met:
     * 1. change timeout is finished
     * 2. server responded to the last update
     */
    private tryProcessNextBatch;
    /**
     * Sends pending changes to the server. Tries processing next batch when
     * response comes back.
     */
    private processPending;
    /**
     * Handles update request coming from the server. Rebases update against
     * local changes and applies it to the current resource state.
     */
    private handleExternalUpdate;
}
/**
 * Establishes a session given a client and initial resource value.
 * Starts a session if it does not exist. Joins the session if already
 * started.
 */
export declare function initSession(client: Client, resourceType: string, resourceId: string, resourceValue: jot.Document, throttleTime?: number): Promise<Session>;
export {};
