# Isogame

2D isometric pixel-art multiplayer prototype (Phaser 3 + TypeScript + Vite, Colyseus server).

## Run locally

```
npm install
npm run dev        # starts the game server (port 2567) and the game (port 5173)
npm run bot        # adds a wandering test player; `npm run bot -- 10` leaves after 10s
npm run sprites    # regenerate the placeholder sprites in public/assets (and rebuild the atlas)
npm run atlas      # rebuild public/atlas from public/assets (also runs automatically on npm run dev)
npm run build      # production build into dist/
npm start          # production server: game page + multiplayer on one port (PORT, default 2567)
```

Open http://localhost:5173.

**Testing with two players:** open the game in two separate browser windows side by side (not tabs; background tabs pause), or run `npm run bot`.
On another device on the same Wi-Fi, open the "Network" address `npm run dev` prints (e.g. `http://192.168.1.3:5173`); allow Node.js through Windows Firewall if asked.

If the server behaves oddly after editing files in `server/` or `shared/`, stop `npm run dev` (Ctrl+C)
and start it again: its auto-restart occasionally misses a change.

## Controls

| Input | Action |
|---|---|
| WASD / arrow keys | Move |
| Space | Jump (hold to keep jumping) |
| Left click | Hit a tree or rock next to you, or break the top block of a column within 3 tiles |
| Right click | Place the selected item as a block (on the block you point at, or beside the side you point at) |
| 1–4 / mouse wheel | Pick a hotbar slot |

- Trees break after 3 hits and give **3 wood**; rocks break after 4 and give **2 stone**.
- Breaking a block gives it back as an item (grass gives dirt). You can't break the bottom block of a
  column, water, or a block with a tree/rock on it.
- Wood places as wooden planks. You can build up to height 24, never inside a player.
- The cursor outlines the block face under the mouse: white if you can break or build there, red if not
  (too far, or nothing to do).
- Your inventory lives on the server. It survives reconnects (5 minutes), but not closing the tab yet:
  that will come with player accounts.

## Hosting on Render

Create a **Web Service** from the GitHub repo with:

| Setting | Value |
|---|---|
| Build command | `npm install && npm run build` |
| Start command | `npm start` |

Render sets `PORT`; the server uses it and serves the built game from `dist/` on the same address.

### Environment variables

| Variable | What it does |
|---|---|
| `DATABASE_URL` | **Strongly recommended.** A Postgres connection string. The world (seed + every change players made) is saved there every 10 s and when the server stops, and loaded when it starts. Without it, saves go to files in `save/`, which Render **wipes on every restart** — and free Render servers restart after ~15 minutes with no visitors. |
| `WORLD_SEED` | The seed (any whole number, e.g. `48213`) used when a **new** world is created. Once a world is saved, its seed comes from the save and this is ignored. |
| `WORLD_ID` | Which saved world to run (default `main`). Change it to start a fresh world while keeping the old one in the database. |
| `SAVE_DIR` | Folder for save files when there's no database (default `save`). |

**Getting a free database:** create a project on [Supabase](https://supabase.com) or [Neon](https://neon.tech),
copy its Postgres connection string (Supabase: *Connect → Session pooler*), and paste it into Render as
`DATABASE_URL`. The server creates its `worlds` table itself.

### World seed guidance

- **With a database:** you don't need `WORLD_SEED`. The first start picks a random seed and saves it,
  and every restart after that loads the same world with all its changes. Set `WORLD_SEED` only if you
  want to choose the world (e.g. a seed you liked locally), and set it *before* the first start.
- **Without a database:** set `WORLD_SEED` so at least the terrain is the same after every restart.
  Player changes (broken trees, built blocks) will still be lost on restarts.
- **To start over:** change `WORLD_ID` (e.g. `main2`); to go back, change it back. `WORLD_SEED` then
  picks the seed for the new world.
- **Finding a seed you like:** run locally with `$env:WORLD_SEED=12345; npm run dev` (PowerShell),
  look around, and try other numbers. Delete the `save/` folder between tries, since a saved world
  keeps its own seed.

## World generation

- The whole world comes from one number, the **seed**, sent to players when they join; everyone
  generates the identical world themselves (`shared/terrain.ts`).
- The server only sends what players *changed*: damaged/destroyed trees and rocks, and columns that
  were built on or dug into. Those changes are also what gets saved.
- The world is endless and split into 16×16 chunks. The browser draws the chunks around you and throws
  away ones far behind.
- Terrain: rolling plains, lakes with sandy shores, hills, bare stone mountain tops, forests and rocks.
  Water can't be walked into yet. Tweak the shapes in `rawHeight()` and `generateChunk()`.
- Light rims along ledges show where the ground steps up, even when the step's wall faces away.

## Keeping it light

- Noise is only computed every 4 tiles and blended in between (about 0.013 ms per chunk).
- The browser loads just enough chunks to cover the screen (based on window size and zoom) and hides
  chunks that are off screen, so they cost nothing to draw.
- All world sprites are in one atlas, so they're drawn from a single texture. Ledge rims are baked
  into the tile images instead of being extra sprites.
- Terrain data far from any player is freed (browser every 3 s, server every 5 s) and regenerated
  from the seed if needed again. Players' changes are stored separately, so nothing is lost.
- Characters are snapped to the isometric pixel grid and the camera follows them exactly, so movement
  doesn't wobble; drawing is blended between 60 Hz movement ticks so it's even on any refresh rate.

## Heights and draw order

- The world is stacked blocks. A column's top block is grass (sand by water, stone on peaks), the next
  two are dirt, deeper ones stone. Columns players changed are stored as their own list of blocks.
- Building only adds or removes the top block of a column, so there are no overhangs or caves
  (house interiors are planned as separate scenes).
- You can't walk up ledges: jump onto them. Jump height is a per-player stat (`jumpHeight`, 1 block
  by default) synced from the server, so potions or spells can raise it later.
- Walking off an edge makes you fall.
- Drawing goes back to front in diagonal rows (gx + gy), lower blocks first. Characters are drawn after
  their own row, so terrain in front of them still covers them. When it does, a faint silhouette shows
  where they are.

## How multiplayer works

- The **server decides** everything: where players are, what they hit, what they build and carry.
  Browsers send requests (keys held, "break this", "place that"), and the server checks each one
  (reach, cooldowns, inventory, not building inside players) before applying it.
- Your own character moves **instantly** on your screen (prediction). When the server's answer arrives,
  the browser replays any inputs the server hasn't processed yet (reconciliation). Both sides use the
  same code in `shared/world.ts`, so they normally agree exactly.
- Other players are drawn slightly in the past, gliding between the server's updates; the delay grows
  automatically on a jittery connection.
- The server lets each player move at most one step per tick of real time, so a modified client can't
  speed-hack by sending inputs faster.
- **Staying connected:** browsers send a heartbeat every second (the ping is shown top right). The server
  removes players it hasn't heard from for 10 s, and a browser that loses the server reloads and rejoins.
  Each tab has a key, so a rejoin within 5 minutes puts you back where you were, with your items.

## Project layout

| File | What it does |
|---|---|
| `shared/terrain.ts` | Seeded noise and terrain generation: heights, water, trees, rocks; block types |
| `shared/world.ts` | Blocks, edited columns, collision, jumping, falling, reach, building rules — used by both browser and server |
| `shared/items.ts` | Items: what they place, what blocks and trees/rocks drop |
| `shared/protocol.ts` | Synced state (players, inventories, trees/rocks, edited columns) and message types |
| `server/index.ts` | Starts the Colyseus game server (and serves `dist/` in production) |
| `server/WorldRoom.ts` | The world room: joins/leaves, movement, hits, breaking/placing, saving |
| `server/storage.ts` | Saves and loads worlds: Postgres (`DATABASE_URL`) or files in `save/` |
| `src/main.ts` | Starts Phaser |
| `src/iso.ts` | Grid ↔ screen maths and draw-order layers |
| `src/TerrainView.ts` | Draws chunks near the player, removes far ones, redraws edited columns |
| `src/picking.ts` | Finds the block and face under the mouse |
| `src/hotbar.ts` | The item bar at the bottom of the screen |
| `src/scenes/WorldScene.ts` | Connects to the server, prediction, other players, cursor, hitting/building |
| `src/CharacterView.ts` | A character on screen: body, tinted scarf, shadow, animations |
| `src/status.ts` | Status messages, ping, coordinates, pickup messages |
| `tools/make-sprites.mjs` | Draws the placeholder sprites with code |
| `tools/pack-atlas.mjs` | Packs world sprites (plus rim variants) into `public/atlas/terrain.*` |
| `tools/bot.ts` | Test bot player |

## Sprites

**Editing world sprites:** change the PNGs in `public/assets`, then restart `npm run dev` (or run
`npm run atlas` and refresh). The game reads them from one packed image, `public/atlas/terrain.png`,
which is rebuilt from those files — don't edit the atlas itself. The hotbar icons come from the atlas too.

Pixel art is drawn small and zoomed 3× in game. Use a 2:1 isometric angle: lines go 2 pixels across for every 1 pixel up.

| File | Size | Anchor (where it touches the ground) |
|---|---|---|
| `grass_0..2.png` | 32×32 | Top face is the 32×16 diamond at the top; sides are 16px tall below it |
| `dirt.png`, `stone.png`, `sand.png`, `water.png`, `planks.png` | 32×32 | Same cube shape as grass |
| `rim_left.png`, `rim_right.png` | 32×32 | Light line on the top face's back-left / back-right edge |
| `tile_hover.png` | 32×32 | Outline of the top diamond |
| `face_left.png`, `face_right.png` | 32×32 | Outline of the front-left / front-right side of the cube |
| `tree.png` | 32×48 | Bottom of the trunk at y≈43 |
| `rock.png` | 16×12 | Bottom at y≈10 |
| `shadow.png` | 24×12 | Centre |
| `player.png` | 192×24 (twelve 16×24 frames) | Feet at y≈22 |

`player.png` frames: 0–2 = facing down-right (idle, step, step), 3–5 = facing up-right (idle, step, step),
6–8 = facing down-right action (wind-up, strike, recover), 9–11 = facing up-right action.
`player_scarf.png` has the same frames but only the scarf, drawn in white/grey; the game tints it with each player's colour.
Left-facing directions are made by flipping in code, so you only draw the right-facing ones.

Note: running `npm run sprites` overwrites `public/assets`. Once you've repainted a sprite, stop using the script for it.
