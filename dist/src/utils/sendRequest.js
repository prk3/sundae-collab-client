"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var nanoid_1 = require("nanoid");
var sundae_collab_shared_1 = require("sundae-collab-shared");
var errors_1 = require("./errors");
/**
 * Sends a server request to the socket and returns a promise resolving with
 * response data.
 */
function sendRequest(socket, message, _a) {
    var _b = _a.timeout, timeout = _b === void 0 ? 30000 : _b, signal = _a.signal;
    var uid = nanoid_1.nanoid();
    var timeoutId;
    var messageListener;
    var closeListener;
    var abortListener;
    // time limit, configurable through options
    var timeoutPromise = new Promise(function (res, rej) {
        timeoutId = setTimeout(function () {
            // don't need to clear timeout
            socket.removeEventListener('message', messageListener);
            socket.removeEventListener('close', closeListener);
            signal === null || signal === void 0 ? void 0 : signal.removeEventListener('abort', abortListener);
            rej(new Error('WS timeout. Either server did not respond or response could not be read.'));
        }, timeout);
    });
    // listen for socket events
    var responsePromise = new Promise(function (res, rej) {
        messageListener = function (_a) {
            var data = _a.data;
            var packet;
            try {
                packet = sundae_collab_shared_1.responsePacketValidator.validateSync(JSON.parse(data), { strict: true });
            }
            catch (e) {
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
            signal === null || signal === void 0 ? void 0 : signal.removeEventListener('abort', abortListener);
            try {
                // reject if response data matches error response format
                var errData = sundae_collab_shared_1.errorDataValidator.validateSync(packet.data, { strict: true });
                rej(new errors_1.ApplicationError(errData.error));
            }
            catch (e) {
                // not an error
                // the cast is necessary, but we could validate the response to be sure
                res(packet.data);
            }
        };
        // reject if socket closes before timeout
        closeListener = function () {
            clearTimeout(timeoutId);
            // don't need to clear message listener, socket will remove the handler
            signal === null || signal === void 0 ? void 0 : signal.removeEventListener('abort', abortListener);
            rej(new Error('Socket closed'));
        };
        socket.addEventListener('message', messageListener);
        socket.addEventListener('close', closeListener);
    });
    // request can be manually aborted
    var abortPromise = new Promise(function (res, rej) {
        if (signal) {
            abortListener = function () {
                clearTimeout(timeoutId);
                socket.removeEventListener('message', messageListener);
                socket.removeEventListener('close', closeListener);
                signal.removeEventListener('abort', abortListener);
                rej(new Error('Sending aborted'));
            };
            signal.addEventListener('abort', abortListener);
        }
    });
    // send the message
    socket.send(JSON.stringify({ uid: uid, message: message }));
    return Promise.race([responsePromise, timeoutPromise, abortPromise]);
}
exports.default = sendRequest;
//# sourceMappingURL=sendRequest.js.map