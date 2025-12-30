// File: api/frame_ollo_generator.ts
import OpenAI from "openai";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Typdefinition för inkommande request-body
type FrameOlliBody = {
  step:
    | "start"
    | "suggest_bentos"
    | "generate_custom"
    | "refine_custom"
    | "finalize";
  input?: string;
  state?: {
    program_id?: string;
    event_id?: string;
    frame_id?: string;
    frame_purpose?: string;
    bento_id?: string;
  };
};

async function fetchEventContext(event_id: string) {
  const { data, error } = await supabase
    .from("event")
    .select("purpose, audience_profile, program_notes")
    .eq("id", event_id)
    .single();
  if (error || !data) throw new Error("Failed to load event context");
  return data;
}

async function fetchMatchingBentos(query: string) {
  const { data, error } = await supabase
    .from("bento_library")
    .select("id, name, short_description, category")
    .ilike("name", `%${query}%`);
  if (error) throw new Error("Bento search failed");
  return data;
}

async function generateFrameContent(prompt: string) {
  const system = `Du är Ugglan Olli, en AI-assistent som hjälper arrangörer att skapa inkluderande och engagerande programpunkter.
  Du har tillgång till syftet med eventet, deltagarprofil, programanteckningar och ett syfte för en specifik programpunkt.
  
  Baserat på detta ska du skapa:
  - Ett reflektionsinslag (kort)
  - Ett interaktionsinslag (kort)
  - 3–5 steg (med korta titlar och beskrivningar)
  - Tidslängd per steg
  - NFI-index (1–5)
  - Engagemangsnivå (1–5)

  Presentera detta i strukturerad text, enkel att läsa.
  `;

  const messages = [
    { role: "system", content: system },
    { role: "user", content: prompt }
  ];

  const response = await client.chat.completions.create({
    model: "gpt-4o",
    messages,
    temperature: 0.7
  });

  return response.choices[0].message.content?.trim();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  try {
    const body = req.body as FrameOlliBody;
    const step = body.step;
    const input = body.input?.trim();
    const state = body.state || {};

    if (step === "start") {
      return res.status(200).json({
        ok: true,
        ui: [
          {
            role: "assistant",
            text: "Vad är syftet med den här programpunkten? Skriv några meningar."
          }
        ],
        next_step: "suggest_bentos",
        state
      });
    }

    if (step === "suggest_bentos") {
      if (!input || !state.event_id) return res.status(400).json({ error: "Missing input or event_id" });
      const eventContext = await fetchEventContext(state.event_id);
      const bentos = await fetchMatchingBentos(input);

      return res.status(200).json({
        ok: true,
        ui: [
          {
            role: "assistant",
            text: `Här är några bento-förslag som passar det du skrev: \"${input}\"`
          },
          ...bentos.map((bento) => ({
            role: "bento_card",
            data: bento
          }))
        ],
        next_step: "generate_custom",
        state: { ...state, frame_purpose: input }
      });
    }

    if (step === "generate_custom") {
      const { event_id, frame_purpose } = state;
      if (!event_id || !frame_purpose) return res.status(400).json({ error: "Missing state" });

      const event = await fetchEventContext(event_id);
      const fullPrompt = `Eventets syfte: ${event.purpose}
Deltagarprofil: ${event.audience_profile}
Programanteckningar: ${event.program_notes}
Programpunktens syfte: ${frame_purpose}`;

      const content = await generateFrameContent(fullPrompt);

      return res.status(200).json({
        ok: true,
        ui: [
          {
            role: "assistant",
            text: `Här är ett förslag baserat på det du skrivit:\n\n${content}`
          }
        ],
        next_step: "refine_custom",
        data: { frame_proposal_raw: content },
        state
      });
    }

    if (step === "refine_custom") {
      if (!input || !state?.frame_purpose || !state?.event_id) return res.status(400).json({ error: "Missing input/state" });
      const event = await fetchEventContext(state.event_id);
      const refinePrompt = `Följande förbättring eller önskemål kom från användaren: ${input}

Utgångspunkt:
Eventets syfte: ${event.purpose}
Deltagarprofil: ${event.audience_profile}
Programanteckningar: ${event.program_notes}
Programpunktens syfte: ${state.frame_purpose}`;

      const updated = await generateFrameContent(refinePrompt);

      return res.status(200).json({
        ok: true,
        ui: [
          {
            role: "assistant",
            text: `Här är det uppdaterade förslaget:\n\n${updated}`
          }
        ],
        data: { frame_proposal_raw: updated },
        next_step: "refine_custom",
        state
      });
    }

    if (step === "finalize") {
      // För frontend att spara i Supabase
      return res.status(200).json({
        ok: true,
        actions: [
          {
            type: "save_frame_data",
            target: "frame",
            field: "frame_proposal_raw",
            value: input || ""
          }
        ],
        next_step: "done"
      });
    }

    return res.status(400).json({ error: "Invalid step" });
  } catch (err: any) {
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
