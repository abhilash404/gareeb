// A fake player that joins the world and wanders around, for testing multiplayer alone.
// Usage: npm run bot            (runs until you press Ctrl+C)
//        npm run bot -- 10      (leaves after 10 seconds)
import { Callbacks, Client } from '@colyseus/sdk';
import { ROOM_NAME, SERVER_PORT, WorldState } from '../shared/protocol';
import { TICK_MS } from '../shared/world';

const seconds = Number(process.argv[2]) || Infinity;
const client = new Client(`http://localhost:${SERVER_PORT}`);
const room = await client.joinOrCreate(ROOM_NAME, {}, WorldState);
console.log(`bot joined as ${room.sessionId}`);

const callbacks = Callbacks.get(room);
callbacks.onAdd('players', (_p, id) => {
  if (id !== room.sessionId) console.log(`bot sees player ${id}`);
});

let dir = { x: 0, y: 0 };
let seq = 0;
const pick = () => (dir = { x: Math.floor(Math.random() * 3) - 1, y: Math.floor(Math.random() * 3) - 1 });
const turn = setInterval(pick, 1500);
// Holds jump now and then, so it can get up steps.
const move = setInterval(() => room.send('input', { seq: ++seq, ...dir, j: Math.random() < 0.05 ? 1 : 0 }), TICK_MS);
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
    [turn, move, report].forEach(clearInterval);
    await room.leave();
    process.exit(0);
  }, seconds * 1000);
}
