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

    /* gemensamt */
    existing_value?: string;
    last_proposal?: string;

    /* steg 4 – målgrupp */
    target_group_1?: string;
    target_group_2?: string;
    target_group_3?: string;

    /* steg 5 – tidigare synpunkter */
    feedback_tags?: string[];
    feedback_custom?: string;
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

/* =========================================================
   GPT – STEG 3: UNDERRUBRIK (ORÖRT)
   ========================================================= */

async function proposeSubtitle(input: string): Promise<string> {
  const system = `
Du är Ollo.

Skapa en underrubrik:
- Max 6 ord
- Sammanhängande mening
- Inga skiljetecken (kolon, tankstreck, semikolon)
- Inledande versal
- Versal på egennamn

Svara endast med underrubriken.
`;

  const rsp = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: system },
      { role: "user", content: input }
    ],
    temperature: 0.3
  });

  return rsp.choices[0].message.content?.trim() || "";
}

/* =========================================================
   GPT – STEG 4: MÅLGRUPPSBESKRIVNING (ORÖRT)
   ========================================================= */

async function proposeTargetGroupFromLevels(
  tg1 = "",
  tg2 = "",
  tg3 = "",
  correction_note = ""
): Promise<string> {
  const system = `
Du är Ollo.

Du ska skapa en målgruppsbeskrivning enligt EXAKT denna mall:

Primär målgrupp är [nivå 1].
Sekundär målgrupp är [nivå 2].
[nivå 3] är också välkomna att delta i mån av plats.

Regler:
- Max 50 ord totalt
- Gör inga tolkningar
- Lägg inte till motiv, teman eller syfte
- Utelämna mening om nivå saknas
- Börja ALDRIG med "Eventet" eller "Målgruppen är"

${correction_note}

Svara ENDAST med texten.
`;

  const user = `
Nivå 1:
${tg1 || "[ingen]"}

Nivå 2:
${tg2 || "[ingen]"}

Nivå 3:
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

/* =========================================================
   GPT – STEG 5: TIDIGARE SYNPUNKTER (FÖRBÄTTRAT)
   ========================================================= */

function formatFeedback(tags: string[], custom?: string) {
  const all = [...tags];
  if (custom?.trim()) all.push(custom.trim());
  return all;
}

function hasValidPreviousFeedbackStyle(text: string): boolean {
  const forbidden = /\b(förbättra|planera|säkerställ|öka|minska|inkludera|åtgärda)\b/i;
  return (
    text.startsWith("Upplevelser från tidigare eller liknande event:") &&
    !forbidden.test(text)
  );
}

async function proposePreviousFeedbackSummary(
  tags: string[],
  correctionNote: string = ""
) {
  const system = `
Du är Ollo.

Din uppgift är att beskriva upplevelser från tidigare eller liknande event,
baserat ENBART på användarens synpunkter.

SPRÅKLIGA KRAV:
- Beskriv hur eventen upplevdes
- Använd observerande, beskrivande språk
- Använd inte förbättrings- eller åtgärdsspråk
- Inga rekommendationer, inga slutsatser

ABSOLUT FÖRBUD:
- Ord som: förbättra, planera, säkerställ, öka, minska, åtgärda
- Orsak–verkan-formuleringar
- Värderande språk

FORM:
- Max 60 ord
- Löpande text
- Exakt denna inledning:
  "Upplevelser från tidigare eller liknande event:"

${correctionNote}

Utgå ENDAST från följande synpunkter:
"${tags.join(", ")}"

Svara ENDAST med den färdiga texten.
`;

  const rsp = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "system", content: system }],
    temperature: 0.25
  });

  return rsp.choices[0].message.content?.trim() || "";
}

/* =========================================================
   HANDLER
   ========================================================= */

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
    const { step, input, state = {} } = body;
    const { field } = state;

    if (!field) return res.status(400).json({ error: "Missing field" });

    /* =====================================================
       STEG 3 – UNDERRUBRIK
       ===================================================== */

    if (step === "start" && field === "subtitle") {
      return res.json({
        ok: true,
        ui: [{ role: "assistant", text: "Beskriv eventets fokus eller huvudfråga." }],
        next_step: "clarify",
        state: { field }
      });
    }

    if (step === "clarify" && field === "subtitle") {
      const proposal = await proposeSubtitle(input || "");
      return res.json({
        ok: true,
        ui: [{
          role: "assistant",
          text: "Förslag på underrubrik:",
          value: proposal,
          actions: [
            { text: "Använd denna", action: "finalize", value: proposal },
            { text: "Justera", action: "refine" },
            { text: "Nytt förslag", action: "refine" },
            { text: "Redigera", action: "edit" }
          ]
        }],
        next_step: "propose",
        state: { ...state, last_proposal: proposal }
      });
    }

    /* =====================================================
       STEG 4 – MÅLGRUPP
       ===================================================== */

    if (step === "clarify" && field === "target_group") {
      let proposal = await proposeTargetGroupFromLevels(
        state.target_group_1,
        state.target_group_2,
        state.target_group_3
      );

      if (!hasRequiredStructure(proposal)) {
        proposal = await proposeTargetGroupFromLevels(
          state.target_group_1,
          state.target_group_2,
          state.target_group_3,
          "DU FÖLJDE INTE STRUKTUREN."
        );
      }

      return res.json({
        ok: true,
        ui: [{
          role: "assistant",
          text: "Förslag på målgruppsbeskrivning:",
          value: proposal,
          actions: [
            { text: "Använd denna", action: "finalize", value: proposal },
            { text: "Justera", action: "refine" },
            { text: "Nytt förslag", action: "refine" },
            { text: "Redigera", action: "edit" }
          ]
        }],
        next_step: "propose",
        state: { ...state, last_proposal: proposal }
      });
    }

    /* =====================================================
       STEG 5 – TIDIGARE SYNPUNKTER (FÖRBÄTTRAT)
       ===================================================== */

    if (step === "clarify" && field === "previous_feedback") {
      const tags = formatFeedback(
        state.feedback_tags || [],
        state.feedback_custom
      );

      let summary = await proposePreviousFeedbackSummary(tags);

      if (!hasValidPreviousFeedbackStyle(summary)) {
        summary = await proposePreviousFeedbackSummary(
          tags,
          "DU ANVÄNDE ÅTGÄRDSSPRÅK ELLER FEL TON. BESKRIV ENDAST UPPLEVELSER."
        );
      }

      return res.json({
        ok: true,
        ui: [{
          role: "assistant",
          text: "Förslag på summering av tidigare synpunkter:",
          value: summary,
          actions: [
            { text: "Använd denna", action: "finalize", value: summary },
            { text: "Justera", action: "refine" },
            { text: "Nytt förslag", action: "refine" },
            { text: "Redigera", action: "edit" }
          ]
        }],
        next_step: "propose",
        state: { ...state, last_proposal: summary }
      });
    }

    /* =====================================================
       FINALIZE (gemensam)
       ===================================================== */

    if (step === "finalize") {
      return res.json({
        ok: true,
        actions: [{
          type: "save_event_field",
          field,
          value: input || state.last_proposal
        }],
        next_step: "done"
      });
    }

    return res.status(400).json({ error: "Invalid step" });

  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
