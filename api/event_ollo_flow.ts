import OpenAI from "openai";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

type Step =
  | "start"
  | "analyze"
  | "ask_clarifying"
  | "propose"
  | "refine"
  | "finalize";

type EventOlloBody = {
  step: Step;
  input?: string;
  state?: {
    field?: EventField;
    existing_value?: string;
    last_proposal?: string;
  };
  context?: {
    field?: EventField;
    existing_value?: string | null;
  };
};

type EventField =
  | "event_name"
  | "event_description"
  | "public_description"
  | "purpose"
  | "audience_profile";

/* ----------------------- Helpers ----------------------- */

function fieldLabel(field: EventField) {
  return {
    event_name: "ett namn på eventet",
    event_description: "en beskrivning av eventet",
    public_description: "en publik beskrivning",
    purpose: "ett syfte",
    audience_profile: "en deltagarbeskrivning",
  }[field];
}

function fieldInstruction(field: EventField) {
  return {
    event_name:
      "Skapa eller förbättra ett tydligt, förklarande och säljande namn.",
    event_description:
      "Skapa eller förbättra en beskrivning som förklarar vad eventet är, för vem och varför.",
    public_description:
      "Skapa eller förbättra en lockande publik text som gör att rätt målgrupp vill delta.",
    purpose:
      "Skapa eller förbättra en syftesbeskrivning som tydliggör intention och önskad effekt.",
    audience_profile:
      "Skapa eller förbättra en deltagarbeskrivning som tydliggör vilka deltagarna är och deras behov.",
  }[field];
}

/* ---------------- GPT calls ---------------- */

async function analyzeExisting(field: EventField, text: string) {
  const system = `
Du är Ollo, en erfaren rådgivare för mötes- och eventdesign.

Analysera texten kort.
Svara med:
- 1–2 styrkor
- 1–2 möjliga förbättringar
- om du behöver mer information innan förbättring (true/false)

Svara ENDAST i JSON:
{
  "strengths": string[],
  "improvements": string[],
  "needs_clarification": boolean,
  "clarifying_question": string | null
}
`;

  const rsp = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content: `FÄLT: ${field}\nTEXT:\n${text}`,
      },
    ],
    temperature: 0.3,
  });

  return JSON.parse(rsp.choices[0].message.content || "{}");
}

async function proposeImproved(
  field: EventField,
  baseText: string,
  adjustment?: string
) {
  const system = `
Du är Ollo.

${fieldInstruction(field)}

Regler:
- Hitta inte på innehåll som inte stöds.
- Förbättra tydlighet, relevans och språk.
- Anpassa ton efter fältets funktion.
- Skriv sakligt, tryggt och inbjudande.

Svara endast med förbättrat förslag.
`;

  const user =
    `UTGÅNGSTEXT:\n${baseText}\n\n` +
    (adjustment ? `ANVÄNDARENS ÖNSKAN:\n${adjustment}` : "");

  const rsp = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.5,
  });

  return rsp.choices[0].message.content?.trim() || "";
}

/* ----------------------- Handler ----------------------- */

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Use POST" });

  try {
    const body = req.body as EventOlloBody;
    const { step, input, state = {}, context = {} } = body;

    const field = state.field || context.field;
    const existingValue =
      state.existing_value ?? context.existing_value ?? "";

    if (!field)
      return res.status(400).json({ error: "Missing field context" });

    /* -------- start -------- */
    if (step === "start" && existingValue) {
      return res.json({
        ok: true,
        ui: [
          {
            role: "assistant",
            text:
              `Eventet har redan ${fieldLabel(field)}:\n\n` +
              `${existingValue}\n\n` +
              "Vill du ha hjälp att förbättra den?",
            buttons: [
              { text: "Ja, gärna", action: "continue" },
              { text: "Inte just nu", action: "cancel" },
            ],
          },
        ],
        next_step: "analyze",
        state: { field, existing_value: existingValue },
      });
    }

    /* -------- analyze -------- */
    if (step === "analyze") {
      const analysis = await analyzeExisting(field, existingValue);

      if (analysis.needs_clarification && analysis.clarifying_question) {
        return res.json({
          ok: true,
          ui: [
            {
              role: "assistant",
              text: analysis.clarifying_question,
            },
          ],
          next_step: "ask_clarifying",
          state,
        });
      }

      const proposal = await proposeImproved(field, existingValue);

      return res.json({
        ok: true,
        ui: [
          {
            role: "assistant",
            text: `Här är ett förbättrat förslag:\n\n${proposal}`,
          },
          {
            role: "assistant",
            buttons: [
              { text: "Justera", action: "refine" },
              { text: "Spara", action: "finalize" },
            ],
          },
        ],
        next_step: "refine",
        state: { ...state, last_proposal: proposal },
      });
    }

    /* -------- ask_clarifying -------- */
    if (step === "ask_clarifying") {
      const proposal = await proposeImproved(
        field,
        existingValue,
        input
      );

      return res.json({
        ok: true,
        ui: [
          {
            role: "assistant",
            text: `Tack! Här är ett första förbättrat förslag:\n\n${proposal}`,
          },
          {
            role: "assistant",
            buttons: [
              { text: "Justera", action: "refine" },
              { text: "Spara", action: "finalize" },
            ],
          },
        ],
        next_step: "refine",
        state: { ...state, last_proposal: proposal },
      });
    }

    /* -------- refine -------- */
    if (step === "refine") {
      const proposal = await proposeImproved(
        field,
        state.last_proposal || existingValue,
        input
      );

      return res.json({
        ok: true,
        ui: [
          {
            role: "assistant",
            text: `Uppdaterat förslag:\n\n${proposal}`,
          },
          {
            role: "assistant",
            buttons: [
              { text: "Justera mer", action: "refine" },
              { text: "Spara", action: "finalize" },
            ],
          },
        ],
        next_step: "refine",
        state: { ...state, last_proposal: proposal },
      });
    }

    /* -------- finalize -------- */
    if (step === "finalize") {
      return res.json({
        ok: true,
        actions: [
          {
            type: "save_event_field",
            field,
            value: state.last_proposal,
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
