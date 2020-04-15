<h1 align="center"><a href="https://github.com/prk3/sundae-collab-server">sundae-collab</a></h1>
<p align="center">Delicious collaboration framework</p>

sundae-collab-client is a set of Javascript utilities that talk to [sundae-collab-server](https://github.com/prk3/sundae-collab-server) instance and provide you with a high level collaboration functionalities.

## What's inside?

### `Client class`

Establishes connection to the collaboration server. Forwards incoming messages to subscription handlers. Requests are queued, so you can send requests before the initialization process finishes.

Available methods:
- `constructor` - Creates client instance given url and client identity.
- `sendRequest` - Sends request to the server. Returns a promise that resolves to a response or rejects with ApplicationError.
- `subscribe` - Listens for requests coming from server and if the message meets criteria (matches type and filter), subscribe handler is called with message content. The value returned by the handler is sent back to the server. Return value of subscribe is a function canceling the subscriptions.
- `stop` - Closes the client.

Client's `emitter` property emits `id` DOM event when the client is ready to send and receive messages and the client id is known.

### `Session class`

Synchronizes a local copy af a resource with the collaboration server. Unlike `Client`, it has to be initialized before instantiation. You can use `initSession` function to do that. `Session` exposes sundae-collab session data through `id`, `participants`, `value` and `meta` properties. Just like in `Client` class, any changes to the state are announced with a dispatch of DOM events on `session.emitter`.

Available methods:

- `constructor` - Creates a Session instance from sundae-collab session data. You probably want to use `initSession` function instead.
- `update` - Apply [jot](https://github.com/prk3/jot) update on the local copy and send it to the server.
- `stop` - Stop the `Session` and send SESSION_LEAVE request to the server.

## Useful commands

In the project directory, you can run:

### `npm run build`

Builds client code to `dist` directory.

### `npm run dev`

Builds client code to `dist` directory. Runs compiler again if the code changes.

### `npm run list`

Lints source files.

## TODO

1. Improve subscription filters.
2. Separate initialization of Client to a separate functions, like in Session.

## Learn more

To learn more about sundya-collab project, visit [sundae-collab-server page](http://github.com/prk3/sundae-collab-server).

Do you want to use sundae-collab in a React application? Check out [sundae-collab-react](http://github.com/prk3/sundae-collab-react).
