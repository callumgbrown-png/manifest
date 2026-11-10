# Releases and merch (ideas 178, 182, 514-519)

Every paid item is sold on an outside shop. Where it comes with an in-game extra, add a batch of unlock codes to the
shop's key system (`make-codes.mjs`) and say so on the product page.

| Idea | Product | Where | Price idea | In-game extra (code grant) |
| --- | --- | --- | --- | --- |
| 178 | Tip jar | Ko-fi (`tipJar` in links.json) | any | `pack:pack.supporter` for tips of $5+ (send by Ko-fi message) |
| 182 | Sprite packs (ships, ports, goods icons; PNG + Aseprite) | itch.io asset page (`spritePacks`) | $4-8 | `pack:pack.sprite-patron` |
| 514 | Soundtrack | Bandcamp (`soundtrack`) | $5, name your price | `pack:pack.soundtrack` (steam whistle horn and badge) |
| 515 | Pixel-art book PDF | itch.io | $10 | `pack:pack.sprite-patron` |
| 516 | Wallpapers (desktop 2560x1440, phone 1170x2532) | itch.io, free with optional tip | $0+ | none |
| 517 | Sticker packs (Discord/Telegram stickers and printable vinyl) | itch.io / print-on-demand | $3 / $6 | none |
| 518 | Printable posters (A3/A2, 300 dpi, sprite scaled 8x with nearest-neighbour) | itch.io | $5 | none |
| 519 | Pixel-art commissions for other devs | Ko-fi commissions page | from $40 per sprite | none |

## Soundtrack release plan (514)
1. Master 8-12 tracks (harbour, open sea, storm, market rush, season end). Export WAV + MP3 320.
2. Bandcamp album: cover = harbour at dusk sprite at 1400x1400; credits; "includes an unlock code for the steam whistle horn".
3. Upload codes: Bandcamp doesn't hand out codes per buyer, so put one multi-use code in the download's `UNLOCK.txt`:
   `node tools/community/make-codes.mjs --grant pack:pack.soundtrack --uses 500 --label bandcamp-ost`. Replace it when it runs out.
4. Announce on Discord, itch.io devlog and a Short (sprite timelapse with the main theme).

## Pixel-art book PDF outline (515)
1. The palette (why 16 colours, sea vs land contrast)
2. Ships at 16, 24 and 32 pixels: silhouettes first
3. Ports and cranes: readable at map zoom
4. Animating wakes and flags in 2-4 frames
5. Goods icons that read in colour-blind modes
6. Before and after: ten sprites redrawn
7. Exporting: nearest-neighbour scaling, sprite sheets
Format: A4 landscape, 40-60 pages, every image at an integer scale.

## Sticker pack list (517)
Anchor, gull, "BUY LOW SAIL FAR", grain sack, fuel barrel, ore cart, machinery cog, pirate flag, lighthouse, freighter, "PRICE CRASH", "CONVOY!".

## Commission page text (519)
> I draw the ships, ports and icons in Manifest. I take a few pixel-art commissions a month for other indie games:
> vehicles, buildings, icons and small animated loops. From $40 per static sprite (up to 32x32), $80 for a 4-frame
> loop. Two rounds of changes included, full commercial rights. DM me on Discord with references and your palette.
