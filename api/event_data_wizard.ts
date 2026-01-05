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
    target_group_1?: string;
    target_group_2?: string;
    target_group_3?: string;
  };
  context?: {
    field: EventField;
    event_name?: string;
  };
};

/* ---------------- Helpers ---------------- */
function hasRequiredStructure(text: string): boolean {
  return (
    text.includes("Primär målgrupp är") ||
    text.includes("Sekundär målgrupp är") ||
    text.includes("är också välkomna att delta i mån av plats")
  );
}

async function proposeTargetGroupFromLevels(
  tg1: string = "",
  tg2: string = "",
  tg3: string = "",
  correction_note: string = ""
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
- Gör inga tillägg om motiv, teman, klimat, framtid eller syfte.
- Utelämna eventnamn eller annan metadata.
- Gör ingen tolkning – enbart omskrivning och kondensering.
- Om någon nivå är tom, utelämna meningen.

DU MÅSTE använda exakt följande struktur:

Primär målgrupp är [text från nivå 1].
Sekundär målgrupp är [text från nivå 2].
[text från nivå 3] är också välkomna att delta i mån av plats.

- Om en nivå saknas: utelämna hela meningen.
- Ändra inte ordningen.
- Lägg inte till egna formuleringar.

ABSOLUT FÖRBUD:
- Börja ALDRIG texten med "Eventet", "Eventet riktar sig", "Målgruppen är".

${correction_note}

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

    if (
      step === "clarify" &&
      field === "target_group" &&
      !target_group_1 &&
      !target_group_2 &&
      !target_group_3
    ) {
      return res.status(400).json({ error: "Du måste fylla i minst en målgruppsnivå." });
    }

    if (step === "clarify" && field === "target_group") {
      let proposal = await proposeTargetGroupFromLevels(
        target_group_1,
        target_group_2,
        target_group_3
      );

      if (!hasRequiredStructure(proposal)) {
        proposal = await proposeTargetGroupFromLevels(
          target_group_1,
          target_group_2,
          target_group_3,
          "DU FÖLJDE INTE STRUKTUREN. ANVÄND EXAKT MALLEN."
        );
      }

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
      let refined = await proposeTargetGroupFromLevels(
        target_group_1,
        target_group_2,
        target_group_3
      );

      if (!hasRequiredStructure(refined)) {
        refined = await proposeTargetGroupFromLevels(
          target_group_1,
          target_group_2,
          target_group_3,
          "DU FÖLJDE INTE STRUKTUREN. ANVÄND EXAKT MALLEN."
        );
      }

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
