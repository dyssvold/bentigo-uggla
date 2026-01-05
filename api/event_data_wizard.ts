import OpenAI from "openai";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
    target_group_1?: string;
    target_group_2?: string;
    target_group_3?: string;
  };
  context?: {
    field: EventField;
    event_name?: string;
  };
};

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
      "Skapa en säljande publik text, max 80 ord.",
  }[field];
}

async function proposeTargetGroupFromLevels(
  tg1: string = "",
  tg2: string = "",
  tg3: string = ""
): Promise<string> {
  const system = `
Du är Ollo.

Du ska skapa en målgruppsbeskrivning för ett event, utifrån tre nivåer av deltagare:

- Nivå 1: Primär målgrupp
- Nivå 2: Sekundär målgrupp
- Nivå 3: Övriga deltagare

Användarens input är redan korrekt formulerad. Du ska INTE tolka, lägga till eller ändra något.

Följ dessa regler:
- Sammanfatta i löpande text, max 50 ord.
- Använd följande formulering: "Primär målgrupp är [...], sekundär är [...]. [...] är också välkomna att delta i mån av plats."
- Gör inga tillägg om motiv, teman, klimat, framtid eller syfte.
- Utelämna eventnamn eller annan metadata.
- Gör ingen tolkning – enbart omskrivning och kondensering.
- Om någon nivå är tom, utelämna meningen.

Svara ENDAST med texten. Inga rubriker eller förklaringar.`;

  const user = `
Nivå 1 – Primär målgrupp:
${tg1 || "[ingen]"}

Nivå 2 – Sekundär målgrupp:
${tg2 || "[ingen]"}

Nivå 3 – Övriga deltagare:
${tg3 || "[ingen]"}
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
    const { field, target_group_1, target_group_2, target_group_3 } = state;

    if (!field) {
      return res.status(400).json({ error: "Missing field" });
    }

    if (step === "start" && field === "target_group") {
      return res.json({
        ok: true,
        ui: [
          {
            role: "assistant",
            text: "Vem riktar sig eventet till? Ange tre nivåer: obligatoriska, gärna, i mån av plats."
          }
        ],
        next_step: "clarify",
        state: { field }
      });
    }

    if (step === "clarify" && field === "target_group") {
      const proposal = await proposeTargetGroupFromLevels(
        target_group_1,
        target_group_2,
        target_group_3
      );

      return res.json({
        ok: true,
        ui: [
          {
            role: "assistant",
            text: "Förslag på målgruppsbeskrivning:",
            value: proposal,
            actions: [
              { text: "Använd denna", action: "finalize", value: proposal },
              { text: "Justera", action: "refine", value: proposal },
              { text: "Nytt förslag", action: "refine" },
              { text: "Redigera", action: "edit" }
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

    if (step === "refine" && field === "target_group") {
      const refined = await proposeTargetGroupFromLevels(
        target_group_1,
        target_group_2,
        target_group_3
      );

      return res.json({
        ok: true,
        ui: [
          {
            role: "assistant",
            text: "Uppdaterat förslag:",
            value: refined,
            actions: [
              { text: "Använd denna", action: "finalize", value: refined },
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
