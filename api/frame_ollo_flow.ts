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
 * STEG I FLODET (justerat):
 * start               -> fråga om användaren vill skapa med Ollo
 * generate_content    -> om ja: be om syfte och skapa förslag
 * refine              -> användaren justerar
 * finalize            -> spara och stäng
 */

type Step = "start" | "generate_content" | "refine" | "finalize";

type FrameOlloBody = {
  step: Step;
  input?: string;
  state?: {
    event_id?: string;
    frame_id?: string;
    frame_purpose?: string;
  };
};

async function getEventContext(event_id: string) {
  const { data, error } = await supabase
    .from("event")
    .select("purpose, audience_profile, program_notes")
    .eq("id", event_id)
    .single();

  if (error || !data) throw new Error("Could not load event context");
  return data;
}

async function generateFrameContent(prompt: string) {
  const system = `
Du är Ollo, expert på inkluderande och hjärnvänliga programpunkter.

Skapa:
- Reflektionsinslag
- Interaktionsinslag
- 3–5 steg (kort text)
- Tidslängd per steg (max 20 min)
- NFI-index (1–5)
- Engagemangsnivå (1–5)

Skriv tydligt, praktiskt och konkret.
`;

  const rsp = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
    temperature: 0.6,
  });

  return rsp.choices[0].message.content?.trim();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  try {
    const body = req.body as FrameOlloBody;
    const { step, input, state = {} } = body;

    /* ----------- step: start ----------- */
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

    /* ----------- step: generate_content ----------- */
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

      return res.json({
        ok: true,
        ui: [
          {
            role: "assistant",
            text: `Här är ett förslag för din programpunkt:\n\n${content}`,
          },
          {
            role: "assistant",
            text: "Vill du justera något, eller ska vi spara detta?",
          },
        ],
        data: { frame_proposal_raw: content },
        next_step: "refine",
        state: { ...state, frame_purpose: input },
      });
    }

    /* ----------- step: refine ----------- */
    if (step === "refine") {
      if (!input || !state.event_id || !state.frame_purpose)
        return res.status(400).json({ error: "Missing input/state" });

      const eventContext = await getEventContext(state.event_id);

      const prompt = `
Användaren vill justera följande:
${input}

Utgå från:
Eventets syfte: ${eventContext.purpose}
Deltagarprofil: ${eventContext.audience_profile}
Programpunktens syfte: ${state.frame_purpose}
`;

      const updated = await generateFrameContent(prompt);

      return res.json({
        ok: true,
        ui: [
          {
            role: "assistant",
            text: `Uppdaterat förslag:\n\n${updated}`,
          },
          {
            role: "assistant",
            text: "Vill du justera mer, eller ska vi spara detta?",
          },
        ],
        data: { frame_proposal_raw: updated },
        next_step: "refine",
        state,
      });
    }

    /* ----------- step: finalize ----------- */
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
