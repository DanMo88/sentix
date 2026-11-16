# Sentix

A phone-first American English sentence builder for Persian speakers, from A1 to C2. Same engine as Zinsmaken (DanMo88/dutch-sentences). Interface in Persian (RTL); English stays LTR. Every word tile shows a Persian-letter American reading (water → «وادِر»), and every sentence and reading line shows a full Persian-letter reading.

## How a lesson works

1. Read the Persian meaning and tap the English tiles in the right order. Every tap plays that word slowly (American voice).
2. When the order is right the whole sentence plays, its Persian-letter reading appears, and a short Persian note opens at the bottom.
3. After two wrong tries «کمک گرفتن» shows the correct sentence with meaning and reading; after a helped solve the same sentence restarts and only an unaided solve moves on.
4. After the last sentence, a short English reading text with reading + Persian translation and slow audio.

Progress is stored only in the browser (`localStorage`, key `sentix-progress-v1`). No accounts, no analytics.

## Content

- `content/<level>-NN.txt` — lessons (format at the top of `tools/build.py`; the `nl` JSON key holds the English text, kept from the shared engine).
- `content/pron.txt` — word → Persian-letter American reading (required for every word).
- `content/sentence-pron.txt` — optional connected-speech readings for whole sentences.
- `content/plan.txt` — full A1–C2 lesson map; lessons without content are shown locked.

```bash
python3 tools/build.py   # validate + build data/*.json + tools/tts_jobs.json
python3 tools/tts.py     # generate missing MP3s (edge-tts, en-US-AriaNeural, rate -15%)
python3 -m http.server 8741
```

Fonts: Vazirmatn under the SIL Open Font License 1.1 (see `fonts/NOTICE.md`).
