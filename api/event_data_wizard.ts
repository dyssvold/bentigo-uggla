import OpenAI from "openai";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* ---------------- Types ---------------- */

type Step =
  | "start"
  | "clarify"
  | "propose"
  | "refine"
  | "finalize";

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
      "Skapa en kort underrubrik eller tagline, max 8 ord. Upprepa inte eventnamnet.",
    target_group:
      "Sammanfatta målgruppen i löpande text, max 50 ord.",
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

/* ---------------- GPT: subtitle proposals ---------------- */

async function proposeMultipleSubtitles(
  themeInput: string,
  eventName?: string
): Promise<string[]> {
  const system = `
Du är Ollo.

Skapa MAX 3 alternativa underrubriker för ett event.

KRAV:
- Max 8 ord per underrubrik
- Upprepa inte eventnamnet
- Ingen punkt i slutet
- Varje förslag ska kunna stå ensamt
- Undvik marknadsfloskler

Eventnamn (endast som kontext, ska inte upprepas):
${eventName ?? ""}

Svara ENDAST som JSON-array:
["förslag 1", "förslag 2", "förslag 3"]
`;

  const user = `
Tema, fokus eller riktning för eventet:
${themeInput}
`;

  const rsp = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    temperature: 0.4
  });

  return JSON.parse(rsp.choices[0].message.content || "[]");
}

/* ---------------- GPT: refine ---------------- */

async function refineSubtitle(
  base: string,
  adjustment: string
): Promise<string> {
  const system = `
Du är Ollo.

Justera underrubriken nedan enligt användarens instruktion.

REGLER:
- Max 8 ord
- Upprepa inte eventnamn
- Endast inledande versal i första ordet
- Ingen punkt i slutet

Svara ENDAST med den färdiga underrubriken.
`;

  const user = `
NUVARANDE UNDERRUBRIK:
${base}

ANVÄNDARENS JUSTERING:
${adjustment}
`;

  const rsp = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    temperature: 0.3
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

    /* -------- start -------- */
    if (step === "start" && field === "subtitle") {
      return res.json({
        ok: true,
        ui: [
          {
            role: "assistant",
            text:
              "Kommer detta event att ha ett speciellt tema, fokus eller liknande?\n\n" +
              "Finns det någon fråga, trend, utmaning eller möjlighet som får större utrymme i programmet?",
          }
        ],
        next_step: "clarify",
        state: { field }
      });
    }

    /* -------- clarify -> propose -------- */
    if (step === "clarify" && field === "subtitle") {
      const proposals = await proposeMultipleSubtitles(
        input || "",
        context.event_name
      );

      return res.json({
        ok: true,
        ui: [
          {
            role: "assistant",
            text: "Här är tre förslag på underrubrik:",
            options: proposals.map((p, index) => ({
              id: index,
              text: p,
              actions: [
                { text: "Välj", action: "finalize", value: p },
                { text: "Redigera", action: "refine", value: p }
              ]
            }))
          }
        ],
        next_step: "propose",
        state: {
          ...state,
          proposals
        }
      });
    }

    /* -------- refine -------- */
    if (step === "refine" && field === "subtitle") {
      const refined = await refineSubtitle(
        state.last_proposal || "",
        input || ""
      );

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
