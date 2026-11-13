# Evo Flashcards

[Open the flashcard converter](https://bo3-33.github.io/evo-flashcards/)

A static browser converter and a TI‑84 Evo Python viewer. Choose a two-column UTF-8 CSV, optionally skip a header row, and send the named deck to calculator RAM from desktop Chrome. Install the viewer once from the same page.

The calculator's USB serial link uses Web Serial when available, with a WebUSB bulk transport for browsers exposing the device that way. The site keeps the deck index in FLINDEX on the device. The CSV and calculator data are processed locally in the browser.

Serve `dist/` over HTTPS or localhost. `node --test` runs the conversion and simulated link tests. `python3 -m unittest discover -s tests` runs the viewer tests.

Protocol references include the MIT-licensed [TI-84-Evo-tools](https://github.com/The-Real-NomadTax/TI-84-Evo-tools) and the [Evo USB Python project](https://github.com/Evo-Programming/evo_usb_py). Papa Parse is bundled with its license in `dist/vendor/`.
