// api/frame_generator.ts
import OpenAI from "openai";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    return res.status(200).end();
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  try {
    const { event_id, bento_id } = req.body;

    if (!event_id) return res.status(400).json({ error: "Missing event_id" });

    // Hämta eventets syfte och deltagarprofil
    const { data: event, error: eventError } = await supabase
      .from("event")
      .select("purpose, audience_profile")
      .eq("id", event_id)
      .single();

    if (eventError) throw new Error(eventError.message);

    let bentoData = null;
    if (bento_id) {
      const { data: bento, error: bentoError } = await supabase
        .from("bento_library")
        .select(
          "name, description, category, type, duration_minutes, reflection_notes, interaction_notes, step_1, step_2, step_3, step_4, step_5, step_1_duration, step_2_duration, step_3_duration, step_4_duration, step_5_duration"
        )
        .eq("id", bento_id)
        .single();

      if (bentoError) throw new Error(bentoError.message);
      bentoData = bento;
    }

    // Prompt till Ugglan
    const system = `Du är Ugglan, en AI-assistent som hjälper till att skapa inkluderande, engagerande och hjärnvänliga programpunkter till event. 
Utgå från eventets syfte och deltagarprofil, samt eventuell bento. 
Generera förslag på:
- En kort reflektion (reflection_notes)
- En enkel interaktion (interaction_notes)
- 3–5 steg med korta beskrivningar (step_1–step_5)
- Ungefärlig tidslängd per steg i minuter (step_1_duration–step_5_duration)
- Ett NFI-index (1–5) – högre om låg hjärnbelastning och NPF-anpassat
- En engagemangsnivå (1–5) – högre vid variation, interaktion och energi

Skriv tydligt och konkret. Varje steg ska vara max 12 ord.`;

    const user = `Eventets syfte:
${event.purpose || "Ej angivet"}

Deltagarprofil:
${event.audience_profile || "Ej angiven"}

${
  bentoData
    ? `Bento:
Namn: ${bentoData.name}
Beskrivning: ${bentoData.description}
Kategori: ${bentoData.category}
Typ: ${bentoData.type}
`
    : `Ingen bento har valts. Generera helt ny programpunkt.`
}`;

    const rsp = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.7,
    });

    const output = rsp.choices[0].message.content;

    return res.status(200).json({
      ok: true,
      ui: [{ role: "assistant", text: output }],
      data: {
        frame_proposal_raw: output,
      },
      next_step: "done",
    });
  } catch (err: any) {
    console.error("Error:", err.message);
    return res.status(500).json({ error: String(err?.message ?? err) });
  }
}
