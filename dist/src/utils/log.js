"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
var loglevel_1 = __importDefault(require("loglevel"));
var logger = loglevel_1.default.getLogger('collaboration-client');
if (typeof process !== 'undefined') {
    if (process.env.LOG) {
        logger.setLevel(process.env.LOG);
    }
    else if (process.env.NODE_ENV === 'test') {
        logger.setLevel('silent');
    }
    else if (process.env.NODE_ENV === 'development') {
        logger.setLevel('debug');
    }
    else {
        logger.setLevel('warn');
    }
}
exports.default = logger;
//# sourceMappingURL=log.js.map