export declare class AssertionError extends Error {
    constructor(msg?: string);
}
/**
 * Asserts the parameter is not undefined.
 */
export declare function assertDefined<T>(thing: T): asserts thing is Exclude<T, undefined>;
/**
 * Asserts the parameter is not null.
 */
export declare function assertNotNull<T>(thing: T): asserts thing is Exclude<T, null>;
