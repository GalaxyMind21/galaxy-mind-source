# Credits and third-party licenses

The items below keep their own licenses. Whatever license the Galaxy Mind code is released under does not cover them, and they are not relicensed.

## Code

- **three.js r185** (`public/chop/vendor/`): MIT License, Copyright 2010-2026 Three.js Authors (full text below). Some example files under `postprocessing/` and `shaders/` don't carry their own header; they're covered by the same license.
- npm dependencies keep the licenses declared in their own packages (see `package-lock.json`).

## Fonts

- **Plus Jakarta Sans** (`src/app/fonts/`, `ios-arcade/shell/fonts/`): Copyright 2020 The Plus Jakarta Sans Project Authors (https://github.com/tokotype/PlusJakartaSans), licensed under the [SIL Open Font License 1.1](https://openfontlicense.org). The licence text sits beside the font files as `OFL.txt`. The static Regular, Medium and Bold files (TTF and WOFF2) were instanced from the variable font in the Google Fonts repository (https://github.com/google/fonts/tree/main/ofl/plusjakartasans); nothing else was changed.
- Spline Sans Mono is loaded at build time through `next/font/google` and is not stored in this repository.

## Third-party images

The images in `public/avatars/x/` (profile images of the listed shops and people) and `public/vendor-shelves/` (screenshots of the listed shops' own websites) belong to their owners. They are not covered by the MIT License or any other license in this repository, and no rights in them are granted. They are shown only to identify the shops in the directory. If you fork this project, replace them or fetch your own, and ask the owner before reusing any of them. Owners who want an image removed from galaxymind.space can use the contact details on the site.

## Music in CHOP (`public/chop/audio/`)

The game also shows these credits in its settings panel (`MUSIC_CREDITS` in `public/chop/js/main.js`). Every file was transcoded to AAC (m4a) for iOS Safari; nothing else was changed.

| Track | Artist | License | Source |
|---|---|---|---|
| Faxing Berlin | 1000 Handz | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | https://freemusicarchive.org/music/1000-handz/cc-by-free-to-use-dancehouse-instrumentals/faxing-berlin/ |
| Take You Higher | 1000 Handz | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | https://freemusicarchive.org/music/1000-handz/cc-by-free-to-use-dancehouse-instrumentals/take-you-higher/ |
| Big Room | Maxim Nick | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | https://opengameart.org/content/big-room-track-2 |
| Ascend | Tricks & Traps | CC0 | https://opengameart.org/content/free-rhythm-game-music-pack-1 |
| Starting Over | Tricks & Traps | CC0 | https://opengameart.org/content/free-rhythm-game-music-pack-1 |
| Flying Temple | Tricks & Traps | CC0 | https://opengameart.org/content/free-rhythm-game-music-pack-1 |
| Lost Utopia | Tricks & Traps | CC0 | https://opengameart.org/content/free-rhythm-game-music-pack-1 |
| Drama | Tricks & Traps | CC0 | https://opengameart.org/content/free-rhythm-game-music-pack-2 |
| Extended | Tricks & Traps | CC0 | https://opengameart.org/content/free-rhythm-game-music-pack-2 |

**CC BY 3.0 attribution:** "Big room track #2" by Maxim Nick (https://opengameart.org/content/big-room-track-2), licensed under CC BY 3.0 (https://creativecommons.org/licenses/by/3.0/). Transcoded from MP3 to AAC; shipped as `big-room.m4a` and titled "Big Room" in the game.

**CC BY 4.0 attribution:** "Faxing Berlin" and "Take You Higher" by 1000 Handz (1000handz.com), from the album "CC BY: FREE TO USE - Dance/House Instrumentals" on the Free Music Archive (track pages above), licensed under CC BY 4.0. Transcoded to AAC.

**Where each OpenGameArt file came from:** Ascend, Starting Over, Flying Temple and Lost Utopia are the pack-1 WAVs (`1_ascend.wav`, `2_starting_over.wav`, `5_flying_temple.wav`, `7_lost_utopia.wav`). Drama is `2_drama.wav` and Extended is `5_extended.wav`, both downloaded from the pack-2 page (https://opengameart.org/content/free-rhythm-game-music-pack-2). The pack-2 page lists all ten WAVs, including `5_extended.wav`; the page preview only shows three. Our `extended.m4a` (197.5 s) and `drama.m4a` (243.7 s) match the lengths of those WAVs.

Ascend, Starting Over, Flying Temple and Lost Utopia come from "Free Rhythm Game Music Pack 1". Drama and Extended come from "Free Rhythm Game Music Pack 2". Both packs are by tricksntraps (Tricks & Traps) and are dedicated to the public domain under CC0; credit is given anyway. CC BY tracks require attribution wherever they're redistributed.

## three.js license text

```
The MIT License

Copyright © 2010-2026 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```
