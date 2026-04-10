/**
 * MCP "studio": stesso comportamento di src/lib/studio-core (stdio, per client esterni).
 * Avvio: npm run mcp:studio
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import {
  studioWriteFile,
  studioListFiles,
  studioFetchUrl,
} from "../src/lib/studio-core";

const cwd = process.cwd();

const server = new McpServer({ name: "studio", version: "1.0.0" });

server.registerTool(
  "studio_write_file",
  {
    description:
      "Scrive un file nella cartella output/<session_id>/ (sito statico).",
    inputSchema: {
      session_id: z.string().describe("ID sessione (UUID)"),
      path: z.string().describe("Percorso relativo, es. index.html"),
      content: z.string(),
    },
  },
  async ({ session_id, path: relPath, content }) => {
    const r = studioWriteFile(cwd, session_id, relPath, content);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(r) }],
    };
  }
);

server.registerTool(
  "studio_list_files",
  {
    description: "Elenca file generati per la sessione.",
    inputSchema: {
      session_id: z.string(),
      subdirectory: z.string().optional(),
    },
  },
  async ({ session_id, subdirectory }) => {
    const r = studioListFiles(cwd, session_id, subdirectory ?? "");
    return {
      content: [{ type: "text" as const, text: JSON.stringify(r) }],
    };
  }
);

server.registerTool(
  "studio_fetch_url",
  {
    description:
      "Scarica URL (http/https) in output/<session_id>/assets/. Verificare licenze immagini.",
    inputSchema: {
      session_id: z.string(),
      url: z.string(),
      filename: z.string().optional(),
    },
  },
  async ({ session_id, url, filename }) => {
    const r = await studioFetchUrl(cwd, session_id, url, filename);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(r) }],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Studio MCP server (stdio) pronto.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
