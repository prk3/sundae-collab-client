
export class AssertionError extends Error {
  constructor(msg?: string) {
    super(msg);
    this.name = this.constructor.name;
  }
}

/**
 * Asserts the parameter is not undefined.
 */
export function assertDefined<T>(thing: T): asserts thing is Exclude<T, undefined> {
  if (thing === undefined) {
    throw new AssertionError('parameter is undefined');
  }
}

/**
 * Asserts the parameter is not null.
 */
export function assertNotNull<T>(thing: T): asserts thing is Exclude<T, null> {
  if (thing === null) {
    throw new AssertionError('parameter is null');
  }
}
