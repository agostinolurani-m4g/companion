# Studio Builder (POC locale)

Webapp Next.js con **SQLite** (`data/studio.db`), **Claude** (Anthropic API) e tool per salvare artefatti e generare file sotto `output/<sessionId>/`.

## Trail Planner AI (MVP)

L’app **mappa + chat planner** vive in **`trail-planner/`** (stesso repo `poc`, non una cartella esterna). Da lì:

```bash
cd trail-planner
cp .env.example .env.local   # oppure: cp ../.env.local .env.local
npm install
npm run dev
```

Apri [http://localhost:3001](http://localhost:3001) (stessa porta dello Studio in root: se uno dei due è avviato, ferma l’altro o cambia porta in uno dei `package.json`).

## Avvio

1. Copia `.env.example` in `.env.local` e imposta `ANTHROPIC_API_KEY`.
2. **Ricerca web**: è sempre disponibile il tool locale **`web_search_ddg`** (DuckDuckGo, senza chiavi). Il tool Anthropic **`web_search`** richiede abilitazione in Console; se dà problemi, `ANTHROPIC_WEB_SEARCH=0` usa solo DDG.
3. `npm install`
4. `npm run dev` → [http://localhost:3001](http://localhost:3001)

## MCP (opzionale, stdio)

- **Studio** (`src/lib/studio-core.ts`): `npm run mcp:studio`
- **Presentazioni** Reveal.js (`src/lib/presentation-core.ts`): `npm run mcp:presentation`

Configura il client MCP (es. Cursor) con comando `npm run mcp:presentation` nella root del progetto.

## Regole progetto

- Nessun MongoDB; solo SQLite in questo repo.
- Nessun accesso a database/progetti esterni non previsti.

## Build

```bash
npm run build && npm start
```
