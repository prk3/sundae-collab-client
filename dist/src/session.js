"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
var jot_1 = __importDefault(require("jot"));
var log_1 = __importDefault(require("./utils/log"));
var asserts_1 = require("./utils/asserts");
/**
 * Transforms a, such that it keeps the original intention if applied after b.
 */
function rebase(a, b, document) {
    var newOperation = a.rebase(b);
    if (newOperation === null) {
        log_1.default.warn('MERGE CONFLICT a.rebase(b)', { a: a.toJSON(), b: b.toJSON() });
        return a.rebase(b, { document: document });
    }
    return newOperation;
}
/**
 * Representation of a collaboration session. Takes care of synchronizing
 * changes with the collaboration server and shares the resource data through
 * properties and events.
 */
var Session = /** @class */ (function () {
    /**
     * Constructs a Session instance out of client and join response data.
     * Warning: You probably want to use initSession function instead.
     */
    function Session(client, data, throttleTime) {
        var _this = this;
        if (throttleTime === void 0) { throttleTime = 300; }
        this.client = client;
        this.throttleTime = throttleTime;
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
        this.detachAddParticipant = this.client.subscribe('ADD_PARTICIPANT', { sessionId: this.id }, function (add) {
            log_1.default.debug('< ADD_PARTICIPANT');
            var newParticipant = {
                id: add.participantId,
                identity: add.participantIdentity,
                color: add.participantColor,
            };
            _this.participants = _this.participants.concat(newParticipant);
            _this.emitter.dispatchEvent(new CustomEvent('participants'));
            return {};
        });
        this.detachRemoveParticipant = this.client.subscribe('REMOVE_PARTICIPANT', { sessionId: this.id }, function (remove) {
            log_1.default.debug('< REMOVE_PARTICIPANT');
            _this.participants = _this.participants.filter(function (p) { return p.id !== remove.participantId; });
            _this.emitter.dispatchEvent(new CustomEvent('participants'));
            return {};
        });
        this.detachUpdateResource = this.client.subscribe('UPDATE_RESOURCE', { sessionId: this.id }, function (update) {
            log_1.default.debug('< UPDATE_RESOURCE');
            _this.handleExternalUpdate(update);
            return {};
        });
    }
    /**
     * Update resource with a jot operation. Session will take care of syncing
     * the update with the collaboration server.
     */
    Session.prototype.update = function (operation) {
        var _this = this;
        // start change timeout if unset
        // timeout is casted to any because setTimeout returns number/Timeout
        // depending on the environment
        if (this.changeTimeout === 'unset') {
            this.changeTimeout = setTimeout(function () {
                _this.changeTimeout = 'finished';
                _this.tryProcessNextBatch();
            }, this.throttleTime);
        }
        // apply change to the resource
        var _a = operation.applyWithMeta(this.value, this.meta), newValue = _a[0], newMeta = _a[1];
        if (newValue !== this.value) {
            this.value = newValue;
            this.emitter.dispatchEvent(new CustomEvent('value'));
        }
        if (newMeta !== this.meta) {
            this.meta = newMeta;
            this.emitter.dispatchEvent(new CustomEvent('meta'));
        }
        // add operation to pending changes
        this.pendingChange = this.pendingChange === null
            ? operation
            : new jot_1.default.LIST([this.pendingChange, operation]).simplify();
    };
    /**
     * Close the session.
     */
    Session.prototype.stop = function () {
        this.detachAddParticipant();
        this.detachRemoveParticipant();
        this.detachUpdateResource();
        if (this.client.id) {
            var leaveMessage = {
                type: 'LEAVE_SESSION',
                data: {
                    sessionId: this.id,
                },
            };
            this.client.sendRequest(leaveMessage)
                .catch(function (err) { return log_1.default.error('Could not leave session', err); });
        }
    };
    /**
     * Sends pending changes update when two criteria are met:
     * 1. change timeout is finished
     * 2. server responded to the last update
     */
    Session.prototype.tryProcessNextBatch = function () {
        if (this.changeTimeout === 'finished' && this.sentChange === null) {
            this.processPending();
        }
    };
    /**
     * Sends pending changes to the server. Tries processing next batch when
     * response comes back.
     */
    Session.prototype.processPending = function () {
        var _this = this;
        asserts_1.assertNotNull(this.pendingChange);
        log_1.default.debug('> UPDATE_RESOURCE', { base: this.syncedVersion, operation: this.pendingChange.toJSON() });
        var updateMessage = {
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
            .then(function (_a) {
            var version = _a.version;
            asserts_1.assertNotNull(_this.sentChange);
            var _b = _this.sentChange.applyWithMeta(_this.syncedValue, _this.syncedMeta), newSyncedValue = _b[0], newSyncedMeta = _b[1];
            _this.syncedValue = newSyncedValue;
            _this.syncedMeta = newSyncedMeta;
            _this.syncedVersion = version;
            _this.sentChange = null;
            _this.tryProcessNextBatch();
        });
    };
    /**
     * Handles update request coming from the server. Rebases update against
     * local changes and applies it to the current resource state.
     */
    Session.prototype.handleExternalUpdate = function (message) {
        var _a, _b;
        var acceptedChange = jot_1.default.opFromJSON(message.update.operation);
        var _c = acceptedChange.applyWithMeta(this.syncedValue, this.syncedMeta), newSyncedValue = _c[0], newSyncedMeta = _c[1];
        // rebase pending and sent changes
        if (this.pendingChange !== null) {
            var sentValue = (this.sentChange
                ? this.sentChange.applyWithMeta(this.syncedValue, this.syncedMeta)
                : [this.syncedValue, this.syncedMeta])[0];
            this.pendingChange = rebase(this.pendingChange, acceptedChange, sentValue);
        }
        if (this.sentChange !== null) {
            this.sentChange = rebase(this.sentChange, acceptedChange, this.syncedValue);
        }
        var _d = [newSyncedValue, newSyncedMeta], newValue = _d[0], newMeta = _d[1];
        if (this.sentChange !== null) {
            _a = this.sentChange.applyWithMeta(newValue, newMeta), newValue = _a[0], newMeta = _a[1];
        }
        if (this.pendingChange !== null) {
            _b = this.pendingChange.applyWithMeta(newValue, newMeta), newValue = _b[0], newMeta = _b[1];
        }
        if (newValue !== this.value) {
            this.value = newValue;
            this.emitter.dispatchEvent(new CustomEvent('value'));
        }
        if (newMeta !== this.meta) {
            this.meta = newMeta;
            this.emitter.dispatchEvent(new CustomEvent('meta'));
        }
        this.syncedVersion = message.update.version;
        this.syncedValue = newSyncedValue;
        this.syncedMeta = newSyncedMeta;
    };
    return Session;
}());
exports.default = Session;
/**
 * Establishes a session given a client and initial resource value.
 * Starts a session if it does not exist. Joins the session if already
 * started.
 */
function initSession(client, resourceType, resourceId, resourceValue, throttleTime) {
    if (throttleTime === void 0) { throttleTime = 300; }
    var makeJoinPromise;
    var makeStartPromise = function () {
        log_1.default.debug('> START_SESSION');
        var startMessage = {
            type: 'START_SESSION',
            data: {
                resourceType: resourceType,
                resourceId: resourceId,
                resourceValue: resourceValue,
            },
        };
        return client.sendRequest(startMessage)
            .then(function (res) {
            var initData = __assign(__assign({}, res), { value: resourceValue, participants: res.participants });
            return new Session(client, initData);
        })
            .catch(function (err) {
            if (err.name.match(/AlreadyExists/i)) {
                return makeJoinPromise();
            }
            throw err;
        });
    };
    makeJoinPromise = function () {
        log_1.default.debug('> JOIN_SESSION');
        var joinMessage = {
            type: 'JOIN_SESSION',
            data: {
                resourceType: resourceType,
                resourceId: resourceId,
            },
        };
        return client.sendRequest(joinMessage)
            .then(function (res) { return new Session(client, res, throttleTime); })
            .catch(function (err) {
            if (err.name.match(/NotFound/i)) {
                return makeStartPromise();
            }
            throw err;
        });
    };
    return makeJoinPromise();
}
exports.initSession = initSession;
//# sourceMappingURL=session.js.map