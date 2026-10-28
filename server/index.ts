import express from 'express';
import { Server, WebSocketTransport } from 'colyseus';
import { ROOM_NAME, SERVER_PORT } from '../shared/protocol';
import { WorldRoom } from './WorldRoom';

// Hosts (e.g. Render) assign the port via PORT; locally we use the fixed one.
const port = Number(process.env.PORT) || SERVER_PORT;

const server = new Server({
  transport: new WebSocketTransport(),
  // In production the same server also hosts the built client from dist/.
  express: (app) => {
    app.use(express.static('dist'));
  },
});
server.define(ROOM_NAME, WorldRoom);
await server.listen(port);
console.log(`Game server running on port ${port}`);
