// A fake player that joins the world and wanders around, for testing multiplayer alone.
// Uses the development login, so it only works with `npm run dev` running.
// Usage: npm run bot            (runs until you press Ctrl+C)
//        npm run bot -- 10      (leaves after 10 seconds)
//        npm run bot -- 10 Bob  (plays as "Bob"; each name is its own account)
import { Callbacks, Client } from '@colyseus/sdk';
import { ROOM_NAME, SERVER_PORT, HEARTBEAT_MS, WorldState } from '../shared/protocol';
import { TICK_MS } from '../shared/world';
import { RACES, CLASSES } from '../shared/characters';

const seconds = Number(process.argv[2]) || Infinity;
const name = process.argv[3] || 'Bot';
const server = `http://localhost:${SERVER_PORT}`;
const token = `dev:${name}`;

// Make the bot's character the first time, with a random race and class.
const pickOne = <T>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)];
const me = await (await fetch(`${server}/api/me`, { headers: { Authorization: `Bearer ${token}` } })).json();
if (!me.character) {
  const res = await fetch(`${server}/api/character`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: name, race: pickOne(RACES).id, cls: pickOne(CLASSES).id }),
  });
  console.log('created character:', JSON.stringify(await res.json()));
}

const client = new Client(server);
const room = await client.joinOrCreate(ROOM_NAME, { token }, WorldState);
console.log(`bot joined as ${name}`);

const callbacks = Callbacks.get(room);
callbacks.onAdd('players', (p, id) => {
  if (id !== room.sessionId) console.log(`bot sees ${p.name} (${p.race} ${p.cls})`);
});

let dir = { x: 0, y: 0 };
let seq = 0;
const pick = () => (dir = { x: Math.floor(Math.random() * 3) - 1, y: Math.floor(Math.random() * 3) - 1 });
const turn = setInterval(pick, 1500);
// Holds jump now and then, so it can get up steps.
const move = setInterval(() => room.send('input', { seq: ++seq, ...dir, j: Math.random() < 0.05 ? 1 : 0 }), TICK_MS);
// Like a browser, say we're still here, or the server drops us when we stand still.
const ping = setInterval(() => room.send('ping', { t: performance.now() }), HEARTBEAT_MS);
room.onMessage('pong', () => {});
const report = setInterval(() => {
  const me = room.state.players.get(room.sessionId);
  if (me) {
    const pos = [me.x, me.y, me.z].map((n) => n.toFixed(2)).join(', ');
    console.log(`bot at (${pos}), ${room.state.players.size} online`);
  }
}, 1000);
pick();

if (seconds !== Infinity) {
  setTimeout(async () => {
    [turn, move, ping, report].forEach(clearInterval);
    await room.leave();
    process.exit(0);
  }, seconds * 1000);
}
