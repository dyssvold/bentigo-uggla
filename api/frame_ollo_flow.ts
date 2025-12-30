// api/frame_ollo_flow.ts
import OpenAI from "openai";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * STEG I FLÖDET
 * start
 * generate_content
 * refine
 * finalize
 */

type Step = "start" | "generate_content" | "refine" | "finalize";

type FrameOlloBody = {
  step: Step;
  input?: string;
  state?: {
    event_id?: string;
    frame_id?: string;
    frame_purpose?: string;
    last_content?: string;
  };
};

/* -------------------------------------------------- */
/* Helpers                                            */
/* -------------------------------------------------- */

async function getEventContext(event_id: string) {
  const { data, error } = await supabase
    .from("event")
    .select("purpose, audience_profile, program_notes")
    .eq("id", event_id)
    .single();

  if (error || !data) throw new Error("Could not load event context");
  return data;
}

/**
 * A) GENERERA INNEHÅLL
 */
async function generateFrameContent(prompt: string) {
  const system = `
Du är Ollo, expert på inkluderande och hjärnvänliga programpunkter.

Skapa ett förslag som innehåller:
- Titel
- Kort beskrivning
- Ett reflektionsinslag
- Ett interaktionsinslag
- 3–5 steg med kort beskrivning och tidslängd per steg (max 20 min per steg)

Skriv konkret, praktiskt och lätt att genomföra.
Använd inga värderande skalor eller index i detta steg.
`;

  const rsp = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
    temperature: 0.6,
  });

  return rsp.choices[0].message.content?.trim() || "";
}

/**
 * B) ANALYSERA INNEHÅLL (NFI + Engagemang)
 */
async function analyzeFrameContent(content: string) {
  const system = `
Du är Ollo i analytiskt läge.

Utvärdera programpunkten nedan enligt dessa kriterier.

ENGAGEMANGSNIVÅ (1–5):
1 = Titta / lyssna
2 = Tycka till / rösta
3 = Ställa eller svara på frågor
4 = Delta eller göra
5 = Valbara aktiviteter

NFI – Neuro Friendliness Index (1–5):
1 = En lång aktivitet (>20 min), ingen variation
2 = Max två moment, ingen reflektion
3 = Anpassad för en deltagartyp
4 = Tydlig struktur, begränsade intryck, psykologisk trygghet
5 = NPF-anpassad, varierad, flera sätt att delta, återkommande trygghetsskapande inslag

Bedöm utifrån innehållet – inte ambitioner.

Svara ENDAST med giltig JSON enligt detta format:
{
  "engagement_level": number,
  "nfi_index": number,
  "motivation": "Kort motivering (1–2 meningar)"
}
`;

  const rsp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: system },
      { role: "user", content: content },
    ],
    temperature: 0,
  });

  return JSON.parse(rsp.choices[0].message.content || "{}");
}

/* -------------------------------------------------- */
/* Handler                                            */
/* -------------------------------------------------- */

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  try {
    const body = req.body as FrameOlloBody;
    const { step, input, state = {} } = body;

    /* -------- start -------- */
    if (step === "start") {
      return res.json({
        ok: true,
        ui: [
          {
            role: "assistant",
            text: "Ska vi designa en egen programpunkt tillsammans?",
            buttons: [
              { text: "Ja gärna", action: "continue" },
              { text: "Inte just nu", action: "cancel" },
            ],
          },
        ],
        next_step: "generate_content",
        state,
      });
    }

    /* -------- generate_content -------- */
    if (step === "generate_content") {
      if (!input || !state.event_id)
        return res.status(400).json({ error: "Missing input/state" });

      const eventContext = await getEventContext(state.event_id);

      const prompt = `
EVENTETS SYFTE:
${eventContext.purpose}

DELTAGARPROFIL:
${eventContext.audience_profile}

PROGRAMANTECKNINGAR:
${eventContext.program_notes || "—"}

PROGRAMPUNKTENS SYFTE:
${input}
`;

      const content = await generateFrameContent(prompt);
      const analysis = await analyzeFrameContent(content);

      return res.json({
        ok: true,
        ui: [
          {
            role: "assistant",
            text: `Här är ett förslag för programpunkten:\n\n${content}`,
          },
          {
            role: "assistant",
            text:
              `Bedömning:\n` +
              `• Engagemangsnivå: ${analysis.engagement_level}\n` +
              `• NFI-index: ${analysis.nfi_index}\n\n` +
              `${analysis.motivation}`,
          },
          {
            role: "assistant",
            text: "Vill du justera något, eller ska vi spara detta?",
          },
        ],
        data: {
          frame_content: content,
          engagement_level: analysis.engagement_level,
          nfi_index: analysis.nfi_index,
        },
        next_step: "refine",
        state: {
          ...state,
          frame_purpose: input,
          last_content: content,
        },
      });
    }

    /* -------- refine -------- */
    if (step === "refine") {
      if (!input || !state.event_id || !state.last_content)
        return res.status(400).json({ error: "Missing input/state" });

      const eventContext = await getEventContext(state.event_id);

      const prompt = `
Utgångsförslag:
${state.last_content}

Användarens önskade ändringar:
${input}

Behåll struktur och förbättra där det behövs.
`;

      const updatedContent = await generateFrameContent(prompt);
      const analysis = await analyzeFrameContent(updatedContent);

      return res.json({
        ok: true,
        ui: [
          {
            role: "assistant",
            text: `Uppdaterat förslag:\n\n${updatedContent}`,
          },
          {
            role: "assistant",
            text:
              `Ny bedömning:\n` +
              `• Engagemangsnivå: ${analysis.engagement_level}\n` +
              `• NFI-index: ${analysis.nfi_index}\n\n` +
              `${analysis.motivation}`,
          },
          {
            role: "assistant",
            text: "Vill du justera mer, eller ska vi spara detta?",
          },
        ],
        data: {
          frame_content: updatedContent,
          engagement_level: analysis.engagement_level,
          nfi_index: analysis.nfi_index,
        },
        next_step: "refine",
        state: {
          ...state,
          last_content: updatedContent,
        },
      });
    }

    /* -------- finalize -------- */
    if (step === "finalize") {
      return res.json({
        ok: true,
        actions: [
          {
            type: "save_frame_data",
            target: "frames",
            value: input,
          },
        ],
        next_step: "done",
      });
    }

    return res.status(400).json({ error: "Invalid step" });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
