// api/frame_ollo_flow.ts

import OpenAI from "openai";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

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

async function getEventContext(event_id: string) {
  const { data, error } = await supabase
    .from("event")
    .select("purpose, audience_profile, program_notes")
    .eq("id", event_id)
    .single();

  if (error || !data) throw new Error("Could not load event context");
  return data;
}

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
Inget annat.`;

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
        `- ${b.name} (${b.purpose_category}, HOPA: ${b.hopa_profiles?.join(", ")}, ENG: ${b.eng_level}, NFI: ${b.nfi_index}) – ${b.short_description}`
    )
    .join("\n")}`;

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

async function generateFrameContent(prompt: string) {
  const system = `
Du är Ollo – AI-assistent och expert på inkluderande, engagerande och hjärnvänliga programpunkter.

Din uppgift är att skapa en tydlig programpunkt som innehåller:
- En kort och tydlig titel (max 6 ord)
- En beskrivning (1–3 meningar)
- Ett reflektionsinslag (t.ex. tyst reflektion eller delning)
- Ett interaktionsinslag (t.ex. fråga i Mentimeter, diskussion i par eller handuppräckning)
- 3–5 steg med namn och kort beskrivning
- En rimlig tidslängd för varje steg (max 20 minuter)
- Ett NFI-index (1–5) som anger hjärnvänlighet
- En engagemangsnivå (1–5) baserat på variation och interaktivitet

Svarsmall:
Titel: ...
Beskrivning: ...

Steg:
1. Namn (X min) – Kort beskrivning
2. ...

Reflektion: ...
Interaktion: ...
NFI-index: X
Engagemangsnivå: X
`;

  const rsp = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
    temperature: 0.5,
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

    if (step === "start") {
      return res.json({
        ok: true,
        ui: [
          {
            role: "assistant",
            text:
              "Vad är syftet med den här programpunkten?\n\nBeskriv kort vad den ska handla om och leda till.",
          },
        ],
        next_step: "suggest_bentos",
        state,
      });
    }

    if (step === "suggest_bentos") {
      if (!input || !state.event_id)
        return res.status(400).json({ error: "Missing input or event_id" });

      const eventContext = await getEventContext(state.event_id);
      const candidates = await fetchCandidateBentos();
      const ranked = await rankBentosWithOllo(candidates, input, eventContext);

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
            text: "Här är några bentos som passar bra för den här programpunkten:",
          },
          ...suggested.map((b) => ({
            role: "bento_card",
            data: b,
          })),
          {
            role: "assistant",
            text: "Vill du använda någon av dessa, eller skapa en egen aktivitet?",
          },
        ],
        next_step: "choose_or_custom",
        state: { ...state, frame_purpose: input },
      });
    }

    if (step === "generate_content") {
      if (!state.event_id || !state.frame_purpose)
        return res.status(400).json({ error: "Missing state" });

      const eventContext = await getEventContext(state.event_id);

      const prompt = `
Eventets syfte:
${eventContext.purpose}

Deltagarprofil:
${eventContext.audience_profile}

Programanteckningar:
${eventContext.program_notes || "—"}

Syfte med denna programpunkt:
${state.frame_purpose}`;

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
            text: "Vill du justera något, eller ska vi spara detta förslaget?",
          },
        ],
        data: { frame_proposal_raw: content },
        next_step: "refine",
        state,
      });
    }

    if (step === "refine") {
      if (!input || !state.event_id)
        return res.status(400).json({ error: "Missing input/state" });

      const eventContext = await getEventContext(state.event_id);

      const prompt = `
Användaren vill justera följande:
${input}

Skapa ett nytt förslag med uppdaterade delar enligt användarens önskemål. Återskapa hela förslaget.

Eventets syfte:
${eventContext.purpose}

Deltagarprofil:
${eventContext.audience_profile}

Programpunktens syfte:
${state.frame_purpose}`;

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
