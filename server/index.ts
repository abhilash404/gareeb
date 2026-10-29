import express from 'express';
import { Server, WebSocketTransport } from 'colyseus';
import { ROOM_NAME, SERVER_PORT } from '../shared/protocol';
import { WorldRoom } from './WorldRoom';
import { addApi } from './api';
import { DEV_LOGIN, SUPABASE_URL } from './auth';

// Hosts (e.g. Render) assign the port via PORT; locally we use the fixed one.
const port = Number(process.env.PORT) || SERVER_PORT;

const server = new Server({
  transport: new WebSocketTransport(),
  express: (app) => {
    addApi(app);
    // In production the same server also hosts the built client from dist/.
    app.use(express.static('dist'));
  },
});
server.define(ROOM_NAME, WorldRoom);
await server.listen(port);
console.log(`Game server running on port ${port}`);
if (!SUPABASE_URL) console.log('Google sign-in is off: set SUPABASE_URL and SUPABASE_ANON_KEY (see README).');
if (DEV_LOGIN) console.log('Dev login is on (anyone can sign in by typing a name). Never use --dev in production.');
