"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
var AssertionError = /** @class */ (function (_super) {
    __extends(AssertionError, _super);
    function AssertionError(msg) {
        var _this = _super.call(this, msg) || this;
        _this.name = _this.constructor.name;
        return _this;
    }
    return AssertionError;
}(Error));
exports.AssertionError = AssertionError;
/**
 * Asserts the parameter is not undefined.
 */
function assertDefined(thing) {
    if (thing === undefined) {
        throw new AssertionError('parameter is undefined');
    }
}
exports.assertDefined = assertDefined;
/**
 * Asserts the parameter is not null.
 */
function assertNotNull(thing) {
    if (thing === null) {
        throw new AssertionError('parameter is null');
    }
}
exports.assertNotNull = assertNotNull;
//# sourceMappingURL=asserts.js.map