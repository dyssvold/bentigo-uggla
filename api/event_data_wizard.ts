import OpenAI from "openai";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* ---------------- Types ---------------- */

type Step = "start" | "clarify" | "propose" | "refine" | "finalize";

type EventField =
  | "subtitle"
  | "target_group"
  | "previous_feedback"
  | "purpose"
  | "audience_profile"
  | "program_notes"
  | "public_description";

type EventWizardBody = {
  step: Step;
  input?: string;
  state?: {
    field: EventField;
    existing_value?: string;
    last_proposal?: string;
    proposals?: string[];
  };
  context?: {
    field: EventField;
    event_name?: string;
  };
};

/* ---------------- Helpers ---------------- */

function fieldInstruction(field: EventField): string {
  return {
    subtitle:
      "Skapa en kort underrubrik i form av en sammanhängande mening på max 6 ord. Undvik skiljetecken (t.ex. kolon, tankstreck, semikolon). Använd inledande versal i meningen samt versaler på egennamn. Fokus: eventets tema eller huvudfråga.",
    target_group:
      "Sammanfatta målgruppen i en löpande text, max 50 ord, utifrån tre nivåer av deltagare (obligatoriska, gärna, i mån av plats). Undvik att ta med eventets syfte, tema, namn eller andra metadata. Fokus ska enbart ligga på vem målgruppen är.",
    previous_feedback:
      "Sammanfatta relevant tidigare feedback, max 50 ord.",
    purpose:
      "Skapa en syftesbeskrivning, max 50 ord.",
    audience_profile:
      "Skapa en deltagarbeskrivning, max 60 ord.",
    program_notes:
      "Skapa en objektiv eventbeskrivning, max 60 ord.",
    public_description:
      "Skapa en säljande publik text, max 80 ord."
  }[field];
}

/* ---------------- GPT: propose target group ---------------- */

async function proposeTargetGroup(input: string): Promise<string> {
  const system = `
Du är Ollo.

Skapa en målgruppsbeskrivning för ett event.

FÖLJ DESSA PRINCIPER:
- Max 50 ord
- Använd löpande text
- Utgå från tre nivåer: obligatoriska, gärna, i mån av plats
- Beskriv endast målgruppens roller och typ – inte syfte eller tema
- Utelämna alla referenser till eventets namn, underrubrik eller innehåll

Svara ENDAST med den färdiga beskrivningen.`;

  const user = `Beskrivning eller anteckningar om önskad målgrupp:\n${input}`;

  const rsp = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    temperature: 0.4
  });

  return rsp.choices[0].message.content?.trim() || "";
}

/* ---------------- Handler ---------------- */

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Use POST" });

  try {
    const body = req.body as EventWizardBody;
    const { step, input, state = {}, context = {} } = body;
    const { field } = state;

    if (!field) {
      return res.status(400).json({ error: "Missing field" });
    }

    /* -------- start: target_group -------- */
    if (step === "start" && field === "target_group") {
      return res.json({
        ok: true,
        ui: [
          {
            role: "assistant",
            text:
              "Beskriv vem eventet riktar sig till – gärna i nivåer (obligatoriska, gärna, i mån av plats)."
          }
        ],
        next_step: "clarify",
        state: { field }
      });
    }

    /* -------- clarify -> propose: target_group -------- */
    if (step === "clarify" && field === "target_group") {
      const proposal = await proposeTargetGroup(input || "");

      return res.json({
        ok: true,
        ui: [
          {
            role: "assistant",
            text: "Här är ett förslag på målgruppsbeskrivning:",
            value: proposal,
            actions: [
              { text: "Spara", action: "finalize", value: proposal },
              { text: "Justera", action: "refine", value: proposal }
            ]
          }
        ],
        next_step: "propose",
        state: {
          ...state,
          last_proposal: proposal
        }
      });
    }

    /* -------- refine: target_group -------- */
    if (step === "refine" && field === "target_group") {
      const refined = await proposeTargetGroup(input || "");

      return res.json({
        ok: true,
        ui: [
          {
            role: "assistant",
            text: "Uppdaterat förslag:",
            value: refined,
            actions: [
              { text: "Spara", action: "finalize", value: refined },
              { text: "Justera mer", action: "refine" }
            ]
          }
        ],
        next_step: "refine",
        state: {
          ...state,
          last_proposal: refined
        }
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
            value: input || state.last_proposal
          }
        ],
        next_step: "done"
      });
    }

    return res.status(400).json({ error: "Invalid step" });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
