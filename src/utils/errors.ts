// more errors might be added to this file in the future
/* eslint-disable import/prefer-default-export */

export class ApplicationError extends Error {
  constructor(data: { name: string; message: string }) {
    super(data.message);
    this.name = data.name;
  }
}
