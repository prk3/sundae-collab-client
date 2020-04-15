"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
var nanoid_1 = require("nanoid");
var sundae_collab_shared_1 = require("sundae-collab-shared");
var sendRequest_1 = __importDefault(require("./utils/sendRequest"));
var errors_1 = require("./utils/errors");
var log_1 = __importDefault(require("./utils/log"));
/**
 * Checks if an incoming client request matches a request filter.
 * TODO: improve this function - maybe handle nested values and regexes
 */
function matches(data, filter) {
    return Object.entries(filter).every(function (_a) {
        var key = _a[0], value = _a[1];
        return data[key] === value;
    });
}
/**
 * Collaboration client. Provides abstraction over web socket connection with
 * custom protocol. Offers request sending and subscriptions for client
 * requests.
 */
var Client = /** @class */ (function () {
    /**
     * Creates Client instance given url of the collaboration service (probably
     * starting with ws:// or wss://) and client identity which will be used
     * for authentication.
     */
    function Client(url, identity) {
        var _this = this;
        /**
         * Socket open listener. Authenticates the collaboration client and updates
         * internal client data.
         */
        this.handleOpen = function () {
            var socket = _this.socket;
            var message = {
                type: 'AUTHENTICATE',
                data: { clientIdentity: _this.identity },
            };
            log_1.default.debug('> AUTHENTICATE');
            return sendRequest_1.default(socket, message, {})
                .then(function (_a) {
                var id = _a.id;
                if (socket === _this.socket) {
                    _this.id = id;
                    _this.isReady = true;
                    _this.socket.onmessage = _this.handleMessage;
                    _this.emitter.dispatchEvent(new CustomEvent('id'));
                    _this.sendQueuedRequests();
                }
            })
                .catch(function (err) {
                log_1.default.error('Could not start collaboration client.', err);
            });
        };
        /**
         * Socket close listener. Logs the event.
         */
        this.handleClose = function () {
            log_1.default.error('Client socket closed.');
        };
        /**
         * Socket message listener. Parses the message and directs to
         * request/response handlers listeners.
         */
        this.handleMessage = function (ev) {
            if (!_this.isReady) {
                return;
            }
            var json;
            try {
                json = JSON.parse(ev.data);
            }
            catch (e) {
                log_1.default.warn('Non-json message.', ev.data);
                return;
            }
            try {
                var response = sundae_collab_shared_1.responsePacketValidator.validateSync(json);
                _this.handleResponse(response);
                return;
            }
            catch (e) {
                // fine, maybe it's a request
            }
            var requestPacket;
            try {
                requestPacket = sundae_collab_shared_1.requestPacketValidator.validateSync(json);
            }
            catch (e) {
                log_1.default.warn('Malformed packet.', { json: json, e: e });
                return;
            }
            var message;
            try {
                message = sundae_collab_shared_1.messageValidator.validateSync(requestPacket.message);
                // TODO validate server messages
            }
            catch (e) {
                log_1.default.warn('Malformed message.', { requestPacket: requestPacket, e: e });
                return;
            }
            _this.handleRequest(requestPacket, message);
        };
        this.identity = identity;
        this.emitter = new EventTarget();
        this.id = null;
        this.isReady = false;
        this.responseHandlers = new Map();
        this.requestSubscriptions = [];
        this.requestQueue = [];
        // initialize the socket
        this.socket = new WebSocket(url);
        this.socket.onopen = this.handleOpen;
        this.socket.onclose = this.handleClose;
    }
    /**
     * Sends a request to the server. The returned promise resolves with server
     * response.
     */
    Client.prototype.sendRequest = function (message) {
        var _this = this;
        return new Promise(function (res, rej) {
            _this.requestQueue.push({ message: message, res: res, rej: rej });
            _this.sendQueuedRequests();
        });
    };
    /**
     * Adds a subscription for the request type. The handler gets called when
     * an incoming client request matches type and filter. The returned function
     * cancels the subscription.
     */
    Client.prototype.subscribe = function (type, filter, handler) {
        var _this = this;
        this.requestSubscriptions.push({ type: type, filter: filter, handler: handler });
        return function () {
            _this.requestSubscriptions = _this.requestSubscriptions.filter(function (s) { return s.handler !== handler; });
        };
    };
    /**
     * Stops the client.
     */
    Client.prototype.stop = function () {
        if (this.socket) {
            this.socket.onopen = null;
            this.socket.onmessage = null;
            this.socket.onclose = null;
            this.socket.close();
        }
        this.id = null;
        this.isReady = false;
        this.emitter.dispatchEvent(new CustomEvent('id'));
    };
    /**
     * Flushes the request queue.
     */
    Client.prototype.sendQueuedRequests = function () {
        while (this.isReady && this.socket && this.requestQueue.length > 0) {
            var requestQueue = this.requestQueue; // used only for type reading
            var _a = this.requestQueue.shift(), message = _a.message, res = _a.res, rej = _a.rej;
            var uid = nanoid_1.nanoid();
            var packet = { uid: uid, message: message };
            this.socket.send(JSON.stringify(packet));
            this.responseHandlers.set(uid, { res: res, rej: rej });
        }
    };
    /**
     * Resolves/rejects a request promise with the server response.
     */
    Client.prototype.handleResponse = function (response) {
        var handler = this.responseHandlers.get(response.responseTo);
        if (handler) {
            // remove listener, a response can only be received once
            this.responseHandlers.delete(response.responseTo);
            var res = handler.res, rej = handler.rej;
            try {
                var errData = sundae_collab_shared_1.errorDataValidator.validateSync(response.data, { strict: true });
                rej(new errors_1.ApplicationError(errData.error));
            }
            catch (e) {
                res(response.data);
            }
        }
        else {
            log_1.default.warn('Received unexpected response from server.');
        }
    };
    /**
     * Forwards request to the appropriate subscription handler.
     */
    Client.prototype.handleRequest = function (packet, message) {
        // TODO can many subscriptions match one request?
        var sub = this.requestSubscriptions.find(function (s) { return s.type === message.type
            && matches(message.data, s.filter); });
        if (sub) {
            var result = sub.handler(message.data);
            var responsePacket = { responseTo: packet.uid, data: result };
            if (this.isReady && this.socket) {
                this.socket.send(JSON.stringify(responsePacket));
            }
            else {
                log_1.default.warn('Attempted sending response to inactive client.');
            }
        }
        else {
            log_1.default.warn('Request ignored - no matching subscriber.');
        }
    };
    return Client;
}());
exports.default = Client;
//# sourceMappingURL=client.js.map