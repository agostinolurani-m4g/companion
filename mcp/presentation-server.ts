/**
 * MCP presentazioni: genera deck Reveal.js (HTML) sotto output/<session_id>/presentation/
 * Avvio: npm run mcp:presentation
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import { writeRevealPresentation } from "../src/lib/presentation-core";

const cwd = process.cwd();

const server = new McpServer({ name: "studio-presentations", version: "1.0.0" });

const slideSchema = z.object({
  heading: z.string().optional().describe("Titolo slide (opzionale)"),
  body: z.string().describe("Contenuto testuale della slide"),
});

server.registerTool(
  "presentation_create_reveal",
  {
    description:
      "Crea una presentazione HTML (Reveal.js) nella cartella sessione. Apribile nel browser. Nessun account esterni.",
    inputSchema: {
      session_id: z.string().describe("ID sessione (UUID)"),
      deck_title: z.string().describe("Titolo del deck / copertina"),
      slides: z
        .array(slideSchema)
        .min(1)
        .describe("Slide di contenuto (la copertina con titolo è aggiunta automaticamente)"),
      relative_path: z
        .string()
        .optional()
        .describe("Default: presentation/index.html"),
    },
  },
  async ({ session_id, deck_title, slides, relative_path }) => {
    const path = relative_path?.trim() || "presentation/index.html";
    const r = writeRevealPresentation(cwd, session_id, path, deck_title, slides);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(r) }],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP presentazioni (Reveal.js) pronto.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
