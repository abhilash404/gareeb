# Isogame

2D isometric pixel-art prototype (Phaser 3 + TypeScript + Vite).

## Run

```
npm install
npm run dev        # starts the game server (port 2567) and the game (port 5173)
npm run bot        # adds a wandering test player; `npm run bot -- 10` leaves after 10s
npm run sprites    # regenerate the placeholder sprites in public/assets (and rebuild the atlas)
npm run atlas      # rebuild public/atlas from public/assets (also runs automatically on npm run dev)
```

**Editing world sprites:** change the PNGs in `public/assets`, then restart `npm run dev` (or run `npm run atlas`
and refresh). The game reads them from one packed image, `public/atlas/terrain.png`, which is rebuilt from
those files — don't edit the atlas itself.

Open http://localhost:5173. Move with WASD or the arrow keys, **Space** to jump, and **click** a tree or rock
next to you to hit it (trees break after 3 hits, rocks after 4). The tile highlight turns red when
something is out of reach.

**Testing with two players:** open the game in two separate browser windows side by side (not tabs; background tabs pause), or run `npm run bot`.
On another device on the same Wi-Fi, open the "Network" address `npm run dev` prints (e.g. `http://192.168.1.3:5173`); allow Node.js through Windows Firewall if asked.

## World generation

- The whole world comes from one number, the **seed**. The server picks it (random each time it starts,
  or set `WORLD_SEED=12345` before `npm run dev` to get the same world every time) and sends it to
  players; everyone generates the identical world themselves (`shared/terrain.ts`).
- The server only sends what players *changed* (damaged/destroyed trees and rocks so far), not the terrain.
- The world is endless and split into 16×16 chunks. The browser draws the chunks within ~24 tiles of
  you and throws away ones far behind.
- Terrain: rolling plains, lakes with sandy shores, hills, bare stone mountain tops, forests and rocks.
  Water can't be walked into yet. Tweak the shapes in `groundHeight()` and `generateChunk()`.
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

- The world is stacked blocks. A column's top block is grass (sand by water, stone on peaks), the next two are dirt, deeper ones stone.
- You can't walk up ledges: jump onto them. Jump height is a per-player stat (`jumpHeight`, 1 block
  by default) synced from the server, so potions or spells can raise it later.
- Walking off an edge makes you fall.
- Drawing goes back to front in diagonal rows (gx + gy), lower blocks first. Characters are drawn after
  their own row, so terrain in front of them still covers them. When it does, a faint silhouette shows
  where they are.

If the server behaves oddly after editing files in `server/` or `shared/`, stop `npm run dev` (Ctrl+C)
and start it again: its auto-restart occasionally misses a change.

## How multiplayer works

- The **server decides** where everyone is. The browser only sends which keys are held (`input` messages, one per 1/60 s tick while moving).
- Your own character moves **instantly** on your screen (prediction). When the server's answer arrives, the browser replays any inputs the server hasn't processed yet (reconciliation). Both sides use the same code in `shared/world.ts`, so they normally agree exactly.
- Other players' positions arrive ~20 times a second; the browser glides them smoothly between updates.
- The server lets each player move at most one step per tick of real time, so a modified client can't speed-hack by sending inputs faster.

## Project layout

| File | What it does |
|---|---|
| `shared/terrain.ts` | Seeded noise and terrain generation: heights, water, trees, rocks |
| `shared/world.ts` | Blocks, collision, jumping, falling, reach — used by both browser and server |
| `shared/protocol.ts` | Synced state (players, trees/rocks) and message types |
| `server/index.ts` | Starts the Colyseus game server |
| `server/WorldRoom.ts` | The world room: joins/leaves, applies movement inputs, checks hits on trees/rocks |
| `src/main.ts` | Starts Phaser |
| `src/iso.ts` | Grid ↔ screen maths and draw-order layers |
| `src/TerrainView.ts` | Draws chunks near the player, removes far ones |
| `src/scenes/WorldScene.ts` | Draws the world, connects to the server, prediction, other players |
| `src/CharacterView.ts` | A character on screen: body, tinted scarf, shadow, animations |
| `tools/make-sprites.mjs` | Draws the placeholder sprites with code |
| `tools/pack-atlas.mjs` | Packs world sprites (plus rim variants) into `public/atlas/terrain.*` |
| `tools/bot.ts` | Test bot player |

## Sprite specs (keep these sizes when repainting)

Pixel art is drawn small and zoomed 3× in game. Use a 2:1 isometric angle: lines go 2 pixels across for every 1 pixel up.

| File | Size | Anchor (where it touches the ground) |
|---|---|---|
| `grass_0..2.png` | 32×32 | Top face is the 32×16 diamond at the top; sides are 16px tall below it |
| `dirt.png`, `stone.png`, `sand.png`, `water.png` | 32×32 | Same cube shape as grass |
| `rim_left.png`, `rim_right.png` | 32×32 | Light line on the top face's back-left / back-right edge |
| `tile_hover.png` | 32×32 | Outline of the top diamond |
| `tree.png` | 32×48 | Bottom of the trunk at y≈43 |
| `rock.png` | 16×12 | Bottom at y≈10 |
| `shadow.png` | 24×12 | Centre |
| `player.png` | 192×24 (twelve 16×24 frames) | Feet at y≈22 |

`player.png` frames: 0–2 = facing down-right (idle, step, step), 3–5 = facing up-right (idle, step, step),
6–8 = facing down-right action (wind-up, strike, recover), 9–11 = facing up-right action.
`player_scarf.png` has the same frames but only the scarf, drawn in white/grey; the game tints it with each player's colour.
Left-facing directions are made by flipping in code, so you only draw the right-facing ones.

Note: running `npm run sprites` overwrites `public/assets`. Once you've repainted a sprite, stop using the script for it.
