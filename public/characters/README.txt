Character sprite sheets go here, one per race + class, named race_class.png in lower case:

  human_knight.png   elf_mage.png   dwarf_tank.png   goblin_assassin.png   merfolk_cleric.png   ...

Races:   human, elf, dwarf, goblin, merfolk
Classes: knight, tank, mage, assassin, cleric

Each sheet: 256 x 64 pixels = 8 columns x 2 rows of 32 x 32 frames.
  Row 1: facing down-right.  Row 2: facing up-right.
  Each row: idle, walk x4, action wind-up, action strike, action recover.
  Feet on pixel row 30 of each frame.

Restart `npm run dev` (or run `npm run atlas`) after adding sheets. Missing ones use the placeholder.
