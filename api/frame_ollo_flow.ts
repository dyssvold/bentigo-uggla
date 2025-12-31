// api/frame_ollo_flow.ts
import OpenAI from "openai";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/* -------------------------------------------------- */
/* Types                                              */
/* -------------------------------------------------- */

type Step =
  | "start"
  | "analyze_intent"
  | "generate_content"
  | "refine"
  | "finalize";

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

function sanitizeNulls(text: string): string {
  return text.replace(/\bnull\b/gi, "saknas");
}

/* ---------- A. ANALYZE INTENT (NYTT STEG) ---------- */

async function analyzeIntent(intent: string, eventContext: any) {
  const system = `
Du är Ollo, en erfaren och varsam rådgivare inom mötesdesign.

Din uppgift:
Analysera användarens beskrivning av en programpunkt innan något förslag skapas.

Bedöm:
- Risk för lågt engagemang
- Risk för mental trötthet
- Påverkan på olika deltagartyper (Analytiker, Interaktörer, Visionärer)
- Eventuella NPF-risker

VIKTIGT:
• Hitta inte på lösningar.
• Ge inte färdiga upplägg.
• Var tydlig men respektfull.

Svara med giltig JSON:
{
  "risk_level": "low" | "medium" | "high",
  "message": "Kort rådgivande text i Ollo-ton (max 3 meningar)",
  "recommend_adjustment": true | false
}
`;

  const user = `
EVENTETS SYFTE:
${eventContext.purpose}

DELTAGARPROFIL:
${eventContext.audience_profile}

PROGRAMPUNKTENS BESKRIVNING:
${intent}
`;

  const rsp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.2,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });

  return JSON.parse(rsp.choices[0].message.content || "{}");
}

/* ---------- B. GENERERA INNEHÅLL ---------- */

async function generateFrameContent(prompt: string) {
  const system = `
Du är Ollo, expert på inkluderande och hjärnvänliga programpunkter.

Skapa ett förslag som innehåller:
- Titel
- Kort beskrivning (spegla exakt det som efterfrågas)
- Reflektionsinslag (eller skriv "saknas")
- Interaktionsinslag (eller skriv "saknas")
- 1–5 steg med beskrivning och tidslängd (max 20 min per steg)

VIKTIGT:
• Hitta inte på inslag som inte efterfrågats.
• Om något saknas: skriv "saknas".
• Använd inga värdeord som antyder engagemang om det inte finns.

Skriv konkret och neutralt.
`;

  const rsp = await openai.chat.completions.create({
    model: "gpt-4o",
    temperature: 0.5,
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
  });

  return sanitizeNulls(rsp.choices[0].message.content?.trim() || "");
}

/* ---------- C. ANALYS (NFI + ENGAGEMANG) ---------- */

async function analyzeFrameContent(content: string) {
  const system = `
Du är Ollo i strikt analytiskt läge.

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
5 = NPF-anpassad, varierad, flera sätt att delta

Bedöm strikt utifrån innehållet.
Svara ENDAST med JSON:
{
  "engagement_level": number,
  "nfi_index": number,
  "motivation": "Kort saklig motivering"
}
`;

  const rsp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    messages: [
      { role: "system", content: system },
      { role: "user", content: content },
    ],
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

    /* ---------- START ---------- */
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
        next_step: "analyze_intent",
        state,
      });
    }

    /* ---------- ANALYZE INTENT ---------- */
    if (step === "analyze_intent") {
      if (!input || !state.event_id)
        return res.status(400).json({ error: "Missing input/state" });

      const eventContext = await getEventContext(state.event_id);
      const analysis = await analyzeIntent(input, eventContext);

      return res.json({
        ok: true,
        ui: [
          {
            role: "assistant",
            text: analysis.message,
          },
          {
            role: "assistant",
            buttons: analysis.recommend_adjustment
              ? [
                  { text: "Ja, låt oss förbättra upplägget", action: "continue" },
                  { text: "Nej, fortsätt som beskrivet", action: "continue_anyway" },
                ]
              : [{ text: "Fortsätt", action: "continue" }],
          },
        ],
        next_step: "generate_content",
        state: {
          ...state,
          frame_purpose: input,
        },
      });
    }

    /* ---------- GENERATE CONTENT ---------- */
    if (step === "generate_content") {
      if (!state.event_id || !state.frame_purpose)
        return res.status(400).json({ error: "Missing state" });

      const eventContext = await getEventContext(state.event_id);

      const prompt = `
EVENTETS SYFTE:
${eventContext.purpose}

DELTAGARPROFIL:
${eventContext.audience_profile}

PROGRAMPUNKTENS BESKRIVNING:
${state.frame_purpose}
`;

      const content = await generateFrameContent(prompt);
      const analysis = await analyzeFrameContent(content);

      return res.json({
        ok: true,
        ui: [
          { role: "assistant", text: `Här är ett förslag:\n\n${content}` },
          {
            role: "assistant",
            text:
              `Bedömning:\n` +
              `• Engagemangsnivå: ${analysis.engagement_level}\n` +
              `• NFI-index: ${analysis.nfi_index}\n\n` +
              `${analysis.motivation}`,
          },
          { role: "assistant", text: "Vill du justera något, eller ska vi spara detta?" },
        ],
        data: {
          frame_content: content,
          engagement_level: analysis.engagement_level,
          nfi_index: analysis.nfi_index,
        },
        next_step: "refine",
        state: { ...state, last_content: content },
      });
    }

    /* ---------- REFINE ---------- */
    if (step === "refine") {
      if (!input || !state.last_content)
        return res.status(400).json({ error: "Missing input/state" });

      const prompt = `
Utgångsförslag:
${state.last_content}

Användarens önskade ändringar:
${input}

Justera endast det som efterfrågas.
`;

      const updated = await generateFrameContent(prompt);
      const analysis = await analyzeFrameContent(updated);

      return res.json({
        ok: true,
        ui: [
          { role: "assistant", text: `Uppdaterat förslag:\n\n${updated}` },
          {
            role: "assistant",
            text:
              `Ny bedömning:\n` +
              `• Engagemangsnivå: ${analysis.engagement_level}\n` +
              `• NFI-index: ${analysis.nfi_index}\n\n` +
              `${analysis.motivation}`,
          },
          { role: "assistant", text: "Vill du justera mer, eller ska vi spara detta?" },
        ],
        data: {
          frame_content: updated,
          engagement_level: analysis.engagement_level,
          nfi_index: analysis.nfi_index,
        },
        next_step: "refine",
        state: { ...state, last_content: updated },
      });
    }

    /* ---------- FINALIZE ---------- */
    if (step === "finalize") {
      return res.json({
        ok: true,
        actions: [
          { type: "save_frame_data", target: "frames", value: input },
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
