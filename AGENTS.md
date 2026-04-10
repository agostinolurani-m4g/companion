<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Regole progetto Studio Builder

- **Non usare MongoDB** (né Atlas, né MCP Mongo): persistenza solo **SQLite** locale in questo repo.
- **Non toccare altri progetti**: nessuna connessione a DB/API/repo esterni non previsti da questo POC; nessuna modifica a cartelle fuori da questo workspace.
