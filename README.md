# Stripe Rotator (modularized)

**What you have**: same functionality as your working `server.js`, split into a clean structure.

## Quick start
```bash
npm i
cp .env.example .env   # fill it
pm2 start ecosystem.config.js
```

## Structure
- `src/index.js` — entry, starts server & schedulers
- `src/app.js` — Express app (routes only, no listen)
- `src/config/` — env loader
- `src/models/` — Mongoose models
- `src/services/` — DB/memory store, rotation, milestones, notify
- `src/routes/` — HTTP endpoints
- `src/bot/` — Telegram init + commands + UI builders
- `src/loaders/` — mongo connect, telegram init, schedulers
- `src/utils/` — helpers (MarkdownV2 escaping, money formatting)

## .env
See `.env.example`.

## PM2
```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```
