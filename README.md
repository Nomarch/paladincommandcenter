# Paladin Command Center

A private, persistent World of Warcraft Forever companion for an Alliance Human Retribution Paladin.

## Run locally

Requires Node.js 24. No package installation or external API key is needed.

    node scripts/build-native.mjs
    node --test tests/native.test.mjs
    node scripts/preview-native.mjs

Open http://127.0.0.1:5173 and choose Sign in with ChatGPT. The development server uses an isolated local test identity and a persistent SQLite database under .sites-runtime/preview. Local test characters are never copied to production. Stop the server with Ctrl+C.

## Features

- First-use setup requires the actual current level and leaves unknown stats blank.
- Character stats, XP, gear, talents, abilities, gold, professions, quests, mount status, and notes.
- Three prioritized actions, persistent checkboxes, completed objectives, and change history.
- Level- and character-aware combat, talent, zone, profession, weapon, and mount guidance.
- Durable D1 records keyed to trusted ChatGPT identity, optimistic concurrency checks, same-origin writes.
- R2 screenshot uploads with ownership checks and raster-format restrictions.
- Natural-language progress extraction with explicit review before saving.
- Character briefing for ChatGPT AI coaching; live AI inference is not connected inside the site.
- Responsive layouts and a dated sourcebook separating Forever facts from uncertain Classic references.

## Source and hosting

The .openai/hosting.json project_id belongs to the already registered private Site. Reuse it. Do not create another Site.

- src/client.js: interface and interactions
- src/domain.js: leveling rules, sources, and conservative text parsing
- src/server.js: authenticated APIs
- app/globals.css: responsive dark fantasy theme
- drizzle/0000_paladin.sql: initial schema
- scripts/build-native.mjs: deterministic self-contained Worker build
- tests/native.test.mjs: direct runtime and persistence tests

The build embeds browser assets into dist/server/index.js and copies the hosting manifest and schema to dist/.openai. Sites provisions DB (D1) and BUCKET (R2); the production Worker accepts only platform-injected user identity for character data. The local authentication mock exists solely in the development runner and is not in the deployed Worker.

Use the Sites source workflow to commit, push, package, and save the exact source state. Keep the Site private. Do not deploy until the working browser preview has been tested, per the user's instruction.

## Validation status — November 22, 2026

Build and syntax checks passed. Seven integration/rule tests passed: authentication and same-origin restrictions; persistent profiles and ownership isolation; stale-write rejection; objective completion/reopening/history; safe text extraction; character-aware recommendations; persistent screenshot access and invalid-format rejection; journal and asset delivery.

Browser QA is blocked: the execution environment rejects local HTTP socket access, and the browser preview timed out connecting to localhost. Desktop/mobile visual inspection and browser form interaction remain unverified. No production character data has been seeded and no deployment has been claimed.

Source guide checks are dated November 22, 2026, not a live patch feed. Mount costs and Classic zone references must be confirmed in game.
