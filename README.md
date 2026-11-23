# Paladin Command Center (local edition)

A private, persistent World of Warcraft Forever companion for an Alliance Human Retribution Paladin. It runs entirely on your own computer, keeps its data in a local SQLite database, and has a built-in AI coach powered by Claude.

## Requirements

- Node.js **22.13 or newer** (24 LTS recommended): https://nodejs.org
- For the AI coach only: an Anthropic API key (https://console.anthropic.com/settings/keys). Everything else works without one.

## Start it (Windows)

1. Unzip this folder somewhere permanent, for example `Documents\Paladin Command Center`.
2. Double-click **`start.cmd`**. The first run installs one package (`@anthropic-ai/sdk`) and creates a `.env` file.
3. Your browser opens **http://127.0.0.1:5173**. Bookmark it.
4. To stop the app, close the black console window (or press Ctrl+C in it).

To turn on the AI coach, open `.env` in Notepad, set `ANTHROPIC_API_KEY=sk-ant-...`, save, and restart `start.cmd`.

From a terminal instead (any OS):

    npm install
    copy .env.example .env      (macOS/Linux: cp .env.example .env)
    npm start

## Owner-only access

- The server listens on `127.0.0.1` only, so other devices on your network cannot connect.
- It rejects any request whose `Host` is not `127.0.0.1:<port>` or `localhost:<port>`, which stops other websites from reaching it through your browser (DNS rebinding).
- Changes must come from the app's own page (same-origin `Origin` check).
- Anyone signed in to your Windows account can open the page. There is no separate password.

## Your data

- Everything is in the **`data`** folder: `character.sqlite` (character, checklist, journal, coach conversations) and `images\` (screenshots).
- **Back up by copying the `data` folder** while the app is stopped. The in-app **Export** button (Adventure journal) downloads a JSON copy for reading; the app cannot import it, so the `data` folder is the real backup.
- This edition starts empty. Characters from the earlier preview or from OpenAI Sites are not imported.
- Your API key lives only in `.env` on this computer. It is never sent to the browser.

## AI coach

- Model **Claude Sonnet 5.5** (`claude-sonnet-5-5`) at **medium** effort. Both are fixed in `server/coach.mjs`. The only setting allowed is `PALADIN_COACH_EFFORT=low`, which makes answers cheaper. Anything else falls back to medium.
- If Sonnet 5.5 declines a question for safety reasons, the API's built-in fallback retries it on Claude Sonnet 5. No Opus or Fable model is ever called.
- Each question sends your saved character sheet, the open objectives, recent journal entries and the dated source list, plus the last 20 messages of the current conversation. Up to 8,000 output tokens are allowed per answer.
- Daily cap: 40 calls to the AI service per day (`COACH_DAILY_LIMIT` in `.env`), counting failed and declined questions too. Only one question runs at a time. It resets at local midnight. "New conversation" clears the view but still counts toward the cap.
- Answers are labeled *AI coaching · verify in game*. Use **Save to journal** to keep useful advice with your history.
- Cost depends on Anthropic's current Sonnet 5.5 price and on how long the conversation runs. Check your usage in the Anthropic Console.

## Features

- First-use setup asks for your actual current level and leaves unknown stats blank.
- Character stats, XP, gear, talents, abilities, gold, professions, quests, mount status, and notes.
- Three prioritized actions, persistent checkboxes, completed objectives, and change history.
- Level- and character-aware combat, talent, zone, profession, weapon, and mount guidance (rule-based, transparent).
- Screenshot uploads (PNG, JPEG or WebP, up to 8 MB, checked by file signature).
- Natural-language progress updates, with a review step before anything is saved.
- A dated sourcebook that separates Forever facts from uncertain Classic references.

## Project layout

- `src/client.js`: interface and interactions (browser)
- `src/domain.js`: leveling rules, sources, and text parsing (shared by browser and server)
- `src/server.js`: the API, a Worker-style `fetch` handler
- `server/local.mjs`: the local Node server (host check, owner identity, `.env`, data folder)
- `server/coach.mjs`: the Claude API call
- `scripts/local-bindings.mjs`: SQLite and folder storage; applies `drizzle/*.sql` migrations in order
- `scripts/build-native.mjs`: bundles everything into `dist/server/index.js`
- `tests/`: `npm test` builds the app, then runs the worker, coach, and real-server tests. The tests never call the real API.

The Worker-style core is unchanged in shape, and `.openai/hosting.json` is kept, so the app can still be packaged for OpenAI Sites from a Codex session. The AI coach only works in the local edition, because Sites has no `env.COACH`. There it reports that it is not set up.

Source guide checks are dated November 22, 2026, not a live patch feed. Mount costs and Classic zone references must be confirmed in game.
