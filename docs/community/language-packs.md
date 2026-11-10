# Community language packs (idea 495)

Manifest's interface can be shown in other languages (module `ui.languages`, switched on in `config/features/ui.json`).
English, Spanish, French, German, Portuguese and Irish are built in. Anyone can add another language as a small file.

## How to add a language

1. Copy `server/public/features/lang/template.json` to `server/public/features/lang/<code>.json`, where `<code>` is the
   two- or three-letter language code (`nl`, `pl`, `it`, `pt-BR`...).
2. Fill in `"name"` with the language's own name (for example `"Polski"`), then translate each English word on the left
   into the empty string on the right. Leave a string empty if you are unsure; the English text stays.
3. Keep translations short: they replace button and tab labels, so a long word can crowd the screen.
4. Open a pull request. Dutch (`nl.json`) is included as a worked example.

## How players use a pack

Settings → **Community pack code** → type the code (for example `nl`). The game loads the pack and switches to it; the
choice is remembered on that device.

## Rules for packs

- Translations only: no links, scripts, HTML or names of real people.
- Only exact interface labels are replaced. Port names, company names and numbers are never translated.
- Packs are reviewed like any other change before they ship.

## Message to post when asking for translators

> **Help translate Manifest!** We're looking for players who speak other languages to translate about thirty short
> interface words (Port, Fleet, Set sail...). It takes ten minutes: copy `template.json`, fill it in and send a pull
> request, or paste your translations in the #translations channel and we'll add them for you. Every translator is
> credited in the release notes.
