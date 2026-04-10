import Anthropic from "@anthropic-ai/sdk";
import { listMessages, listArtifacts, saveArtifact } from "@/lib/db";
import { duckDuckGoSearch } from "@/lib/ddg-search";
import { writeRevealPresentation } from "@/lib/presentation-core";
import {
  studioWriteFile,
  studioListFiles,
  studioFetchUrl,
} from "@/lib/studio-core";

const cwd = process.cwd();

export const DEFAULT_MODEL =
  process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-20250514";

const SYSTEM_PROMPT = `Sei Studio, un assistente per piccole aziende e artigiani. Aiuti a definire brand, strategia, marketing, proposta di valore, bozza di sito web statico (HTML/CSS) e presentazioni slide (tool \`presentation_create_reveal\`).

Regole:
- Tutto è BOZZA: niente consulenza legale/finanziaria certificata; suggerisci di verificare con professionisti.
- Per immagini scaricate da URL: ricorda che diritti d'autore e licenze vanno verificati dall'utente.
- Usa i tool per salvare artefatti strutturati e file del sito sotto la sessione corrente.
- Rispondi in italiano salvo se l'utente chiede altro.
- Quando proponi rebranding, offri naming, tone of voice, palette (descrizione colori), messaggi chiave.
- Per strategia: posizionamento, competitor (da ricerca limitata), idee di prezzo, canali.
- Hai sempre il tool \`web_search_ddg\` per cercare sul web pubblico (brand, competitor, notizie). Se è disponibile anche \`web_search\` (Anthropic), puoi usarlo per ricerche più ricche.
- Per notizie, competitor o prezzi aggiornati: usa prima \`web_search_ddg\` o \`web_search\`.
- Per presentazioni (pitch, brand deck): usa \`presentation_create_reveal\` e indica all'utente l'URL per aprire le slide nel browser.`;

/** Tool lato client (SQLite / filesystem sessione). */
function clientTools(): Anthropic.Tool[] {
  return [
    {
      name: "presentation_create_reveal",
      description:
        "Crea una presentazione slide (HTML Reveal.js) nella cartella della sessione, apribile nel browser (schermo intero, frecce). Usa per pitch, proposta brand, strategia. Slide: titolo opzionale + corpo testo.",
      input_schema: {
        type: "object",
        properties: {
          deck_title: {
            type: "string",
            description: "Titolo presentazione / copertina",
          },
          file_path: {
            type: "string",
            description: "Percorso file, default presentation/index.html",
          },
          slides: {
            type: "array",
            description: "Elenco slide (ordine). La copertina con titolo è aggiunta automaticamente.",
            items: {
              type: "object",
              properties: {
                heading: { type: "string", description: "Titolo slide" },
                body: {
                  type: "string",
                  description: "Contenuto (testo; vai a capo per paragrafi)",
                },
              },
              required: ["body"],
            },
          },
        },
        required: ["deck_title", "slides"],
      },
    },
    {
      name: "web_search_ddg",
      description:
        "Ricerca web pubblica (DuckDuckGo, senza API key). Usa per brand, aziende (es. Cinelli), competitor, notizie, prezzi indicativi. Passa una query chiara in italiano o inglese.",
      input_schema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Query di ricerca, es. 'Cinelli brand storia bicicletta'",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "save_artifact",
      description:
        "Salva un artefatto strutturato (brand kit, strategia, competitor, story, checklist legal/finance bozza).",
      input_schema: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            description:
              "brand_kit | strategy | competitors | story | product | style | legal_checklist | finance_checklist | other",
          },
          title: { type: "string" },
          data: { type: "object", description: "Payload JSON serializzabile" },
        },
        required: ["kind", "data"],
      },
    },
    {
      name: "list_artifacts",
      description: "Elenco artefatti già salvati per questa sessione (sintesi).",
      input_schema: {
        type: "object",
        properties: {
          unused: {
            type: "boolean",
            description: "Campo ignorato, lasciare assente",
          },
        },
      },
    },
    {
      name: "studio_write_file",
      description:
        "Scrive un file nel sito della sessione (es. index.html, styles.css). Percorsi relativi alla root sessione.",
      input_schema: {
        type: "object",
        properties: {
          path: { type: "string", description: "es. index.html o css/style.css" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
    },
    {
      name: "studio_list_files",
      description: "Elenca file generati nella cartella della sessione.",
      input_schema: {
        type: "object",
        properties: {
          subdirectory: { type: "string", description: "Opzionale, es. assets" },
        },
      },
    },
    {
      name: "studio_fetch_url",
      description:
        "Scarica contenuto da URL (http/https) e salva in assets/ con limiti di dimensione. Per immagini o pagine.",
      input_schema: {
        type: "object",
        properties: {
          url: { type: "string" },
          filename: { type: "string", description: "Nome file opzionale" },
        },
        required: ["url"],
      },
    },
  ];
}

/** Web search eseguito da Anthropic (abilita in Console → Privacy). */
function webSearchToolDef():
  | Anthropic.WebSearchTool20250305
  | Anthropic.WebSearchTool20260209
  | null {
  if (process.env.ANTHROPIC_WEB_SEARCH === "0") {
    return null;
  }
  const maxUses = Math.min(
    20,
    Math.max(1, parseInt(process.env.ANTHROPIC_WEB_SEARCH_MAX_USES ?? "8", 10) || 8)
  );
  const version =
    process.env.ANTHROPIC_WEB_SEARCH_VERSION === "20260209"
      ? "20260209"
      : "20250305";
  if (version === "20260209") {
    return {
      type: "web_search_20260209",
      name: "web_search",
      max_uses: maxUses,
    };
  }
  return {
    type: "web_search_20250305",
    name: "web_search",
    max_uses: maxUses,
  };
}

function allTools(): Anthropic.ToolUnion[] {
  const ws = webSearchToolDef();
  const client = clientTools();
  if (!ws) return client;
  const [head, ...tail] = client;
  return [head, ws, ...tail];
}

async function executeTool(
  sessionId: string,
  name: string,
  input: Record<string, unknown>
): Promise<unknown> {
  try {
    switch (name) {
      case "presentation_create_reveal": {
        const deckTitle = String(input.deck_title ?? "").trim();
        if (!deckTitle) return { error: "deck_title obbligatorio" };
        const filePath =
          String(input.file_path ?? "presentation/index.html").trim() ||
          "presentation/index.html";
        const raw = input.slides;
        if (!Array.isArray(raw) || raw.length === 0) {
          return { error: "slides deve essere un array con almeno un elemento" };
        }
        const slides = raw.map((item) => {
          const o = item as Record<string, unknown>;
          return {
            heading: o.heading != null ? String(o.heading) : undefined,
            body: String(o.body ?? ""),
          };
        });
        return writeRevealPresentation(
          cwd,
          sessionId,
          filePath,
          deckTitle,
          slides
        );
      }
      case "web_search_ddg": {
        const query = String(input.query ?? "").trim();
        if (!query) return { error: "query obbligatoria" };
        const r = await duckDuckGoSearch(query);
        return r;
      }
      case "save_artifact": {
        const kind = String(input.kind ?? "other");
        const title = input.title != null ? String(input.title) : null;
        saveArtifact(sessionId, kind, title, input.data ?? {});
        return { ok: true, kind };
      }
      case "list_artifacts": {
        const rows = listArtifacts(sessionId);
        return {
          count: rows.length,
          items: rows.map((r) => ({
            kind: r.kind,
            title: r.title,
            preview: r.payload.slice(0, 400),
          })),
        };
      }
      case "studio_write_file": {
        return studioWriteFile(
          cwd,
          sessionId,
          String(input.path ?? ""),
          String(input.content ?? "")
        );
      }
      case "studio_list_files": {
        return studioListFiles(
          cwd,
          sessionId,
          input.subdirectory != null ? String(input.subdirectory) : ""
        );
      }
      case "studio_fetch_url": {
        return studioFetchUrl(
          cwd,
          sessionId,
          String(input.url ?? ""),
          input.filename != null ? String(input.filename) : undefined
        );
      }
      default:
        return { error: "tool sconosciuto" };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

function extractText(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

export async function runAgentTurn(
  sessionId: string,
  model: string = DEFAULT_MODEL
): Promise<{ text: string; usage?: Anthropic.Usage }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Manca ANTHROPIC_API_KEY nel file .env.local");
  }
  const webSearchEnabled = webSearchToolDef() !== null;
  const useSearchBeta =
    webSearchEnabled && process.env.ANTHROPIC_WEB_SEARCH_BETA !== "0";
  const client = new Anthropic({
    apiKey,
    ...(useSearchBeta
      ? {
          defaultHeaders: {
            "anthropic-beta": "web-search-2025-03-05",
          },
        }
      : {}),
  });
  const history = listMessages(sessionId);
  const messages: Anthropic.MessageParam[] = history.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  let usage: Anthropic.Usage | undefined;
  let iterations = 0;
  while (iterations < 24) {
    iterations += 1;
    const response = await client.messages.create({
      model,
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages,
      tools: allTools(),
    });
    usage = response.usage;

    if (response.stop_reason === "pause_turn") {
      messages.push({
        role: "assistant",
        content: response.content as Anthropic.ContentBlockParam[],
      });
      continue;
    }

    if (response.stop_reason === "tool_use") {
      messages.push({
        role: "assistant",
        content: response.content as Anthropic.ContentBlockParam[],
      });
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type === "tool_use") {
          const input = (block.input ?? {}) as Record<string, unknown>;
          const result = await executeTool(sessionId, block.name, input);
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: JSON.stringify(result),
          });
        }
      }
      if (toolResults.length === 0) {
        const text = extractText(response.content);
        return { text, usage };
      }
      messages.push({ role: "user", content: toolResults });
      continue;
    }

    const text = extractText(response.content);
    return { text, usage };
  }
  return {
    text: "Limite passaggi strumenti raggiunto. Riprova con una richiesta più breve.",
    usage,
  };
}
