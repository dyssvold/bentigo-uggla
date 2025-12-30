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
 * STEG I FLÖDET
 * start               -> fråga om syfte för programpunkten
 * suggest_bentos      -> föreslå bentos (filtrerade i DB + rangordnade av Ollo)
 * choose_or_custom    -> användaren väljer bento eller egen aktivitet
 * generate_content    -> Ollo genererar innehåll
 * refine              -> användaren justerar
 * finalize            -> spara
 */

type Step =
  | "start"
  | "suggest_bentos"
  | "choose_or_custom"
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
    selected_bento_id?: string | null;
  };
};

/* ----------------------------- helpers ----------------------------- */

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
 * 1) FILTRERA I DATABASEN
 * Vi hämtar bara ett rimligt urval (t.ex. 20 st)
 */
async function fetchCandidateBentos() {
  const { data, error } = await supabase
    .from("bento_library")
    .select(
      `
      id,
      name,
      short_description,
      purpose_category,
      hopa_profiles,
      eng_level,
      nfi_index,
      effects
    `
    )
    .limit(30);

  if (error) throw new Error("Failed to fetch bentos");
  return data || [];
}

/**
 * 2) Ollo rangordnar och väljer 3–5 bentos
 */
async function rankBentosWithOllo(
  bentos: any[],
  framePurpose: string,
  eventContext: any
) {
  const system = `
Du är Ollo, en svensk AI-assistent för inkluderande mötesdesign.

Din uppgift:
Välj 3–5 bentos som passar bäst för en programpunkt.

Ta hänsyn till:
- Programpunktens syfte
- Eventets övergripande syfte
- Deltagarprofil (HOPA)
- Variation i engagemangsnivå
- Hjärnvänlighet (NFI)

Svara med en JSON-array enligt detta format:
[
  {
    "id": "bento_id",
    "motivation": "Kort motivering"
  }
]
Inget annat.
`;

  const user = `
PROGRAMPUNKTENS SYFTE:
${framePurpose}

EVENTETS SYFTE:
${eventContext.purpose}

DELTAGARPROFIL:
${eventContext.audience_profile}

TILLGÄNGLIGA BENTOS:
${bentos
  .map(
    (b) =>
      `- ${b.name} (${b.purpose_category}, HOPA: ${b.hopa_profiles?.join(
        ", "
      )}, ENG: ${b.eng_level}, NFI: ${b.nfi_index}) – ${b.short_description}`
  )
  .join("\n")}
`;

  const rsp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.4,
  });

  return JSON.parse(rsp.choices[0].message.content || "[]");
}

/**
 * 3) Generera innehåll för en frame
 */
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

/* ----------------------------- handler ----------------------------- */

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  try {
    const body = req.body as FrameOlloBody;
    const { step, input, state = {} } = body;

    /* ---------------- step: start ---------------- */
    if (step === "start") {
      return res.json({
        ok: true,
        ui: [
          {
            role: "assistant",
            text:
              "Vad är syftet med den här programpunkten?\n\n" +
              "Beskriv kort vad den ska handla om och leda till.",
          },
        ],
        next_step: "suggest_bentos",
        state,
      });
    }

    /* ---------------- step: suggest_bentos ---------------- */
    if (step === "suggest_bentos") {
      if (!input || !state.event_id)
        return res.status(400).json({ error: "Missing input or event_id" });

      const eventContext = await getEventContext(state.event_id);
      const candidates = await fetchCandidateBentos();
      const ranked = await rankBentosWithOllo(
        candidates,
        input,
        eventContext
      );

      const suggested = ranked.map((r: any) => {
        const b = candidates.find((c) => c.id === r.id);
        return {
          ...b,
          motivation: r.motivation,
        };
      });

      return res.json({
        ok: true,
        ui: [
          {
            role: "assistant",
            text:
              "Här är några bentos som passar bra för den här programpunkten:",
          },
          ...suggested.map((b) => ({
            role: "bento_card",
            data: b,
          })),
          {
            role: "assistant",
            text:
              "Vill du använda någon av dessa, eller skapa en egen aktivitet?",
          },
        ],
        next_step: "choose_or_custom",
        state: { ...state, frame_purpose: input },
      });
    }

    /* ---------------- step: generate_content ---------------- */
    if (step === "generate_content") {
      if (!state.event_id || !state.frame_purpose)
        return res.status(400).json({ error: "Missing state" });

      const eventContext = await getEventContext(state.event_id);

      const prompt = `
EVENTETS SYFTE:
${eventContext.purpose}

DELTAGARPROFIL:
${eventContext.audience_profile}

PROGRAMANTECKNINGAR:
${eventContext.program_notes || "—"}

PROGRAMPUNKTENS SYFTE:
${state.frame_purpose}
`;

      const content = await generateFrameContent(prompt);

      return res.json({
        ok: true,
        ui: [
          {
            role: "assistant",
            text: `Här är ett första förslag:\n\n${content}`,
          },
          {
            role: "assistant",
            text:
              "Vill du justera något, eller ska vi spara detta förslaget?",
          },
        ],
        data: { frame_proposal_raw: content },
        next_step: "refine",
        state,
      });
    }

    /* ---------------- step: refine ---------------- */
    if (step === "refine") {
      if (!input || !state.event_id)
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
        ],
        data: { frame_proposal_raw: updated },
        next_step: "refine",
        state,
      });
    }

    /* ---------------- step: finalize ---------------- */
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
