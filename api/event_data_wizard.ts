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

    target_group_1?: string;
    target_group_2?: string;
    target_group_3?: string;

    feedback_tags?: string[];
    feedback_custom?: string;

    purpose_why1?: string;
    purpose_why2?: string;
    previous_feedback?: string;
  };
  context?: {
    field: EventField;
    event_name?: string;
    subtitle?: string;
    previous_feedback?: string;
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

function formatFeedback(tags: string[], custom?: string) {
  const all = [...tags];
  if (custom?.trim()) all.push(custom.trim());
  return all;
}

function hasValidPreviousFeedbackStyle(text: string): boolean {
  const forbidden =
    /\b(förbättra|planera|säkerställ|öka|minska|inkludera|åtgärda|prioritera|optimera|ska|bör|behöver)\b/i;
  return (
    text.startsWith("Upplevelser från tidigare eller liknande event:") &&
    !forbidden.test(text)
  );
}

async function proposeSubtitle(input: string): Promise<string> {
  const system = `Du är Ollo.
Skapa en underrubrik:
- Max 6 ord
- Sammanhängande mening
- Inga skiljetecken (kolon, tankstreck, semikolon)
- Inledande versal
- Versal på egennamn
Svara endast med underrubriken.`;

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

async function proposeTargetGroupFromLevels(tg1 = "", tg2 = "", tg3 = "", correction_note = ""): Promise<string> {
  const system = `Du är Ollo.
Du ska skapa en målgruppsbeskrivning enligt EXAKT denna mall:
Primär målgrupp är [nivå 1].
Sekundär målgrupp är [nivå 2].
[nivå 3] är också välkomna att delta i mån av plats.
Regler:
- Max 50 ord totalt
- Gör inga tolkningar
- Lägg inte till motiv, teman eller syfte
– Inled mening med stor bokstav, och övriga ord med liten, om de inte är namn eller begrepp som brukar skrivas med inledande stor bokstav
- Utelämna mening om nivå saknas
- Börja ALDRIG med "Eventet" eller "Målgruppen är"
${correction_note}
Svara ENDAST med texten.`;

  const user = `Nivå 1:\n${tg1 || "[ingen]"}\nNivå 2:\n${tg2 || "[ingen]"}\nNivå 3:\n${tg3 || "[ingen]"}`;

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

async function synthesizePurpose(
  why1: string,
  why2: string,
  feedback: string = ""
): Promise<string> {

  const system = `
Du är Ugglan, en svensk eventassistent.

DIN UPPGIFT:
Skriv en kort syftesbeskrivning för ett event.

ABSOLUTA KRAV (OM NÅGOT BRYTS ÄR SVARET FEL):
- Texten MÅSTE börja exakt med: "Eventet arrangeras i syfte att"
- 1–3 meningar
- Max 50 ord
- Endast löpande text
- Inga rubriker, listor eller förklaringar
- Ingen information om eventnamn, tema, logistik, talare eller aktiviteter

INNEHÅLL – MYCKET VIKTIGT:
- Texten MÅSTE tydligt spegla BOTH WHY1 och WHY2
- Ord eller mycket nära vardagliga motsvarigheter från WHY1 och WHY2 MÅSTE användas
- Du får INTE ersätta enkla uttryck med professionella eller marknadsförande formuleringar

EXAKTA REGLER:
- "ha kul" får endast bli t.ex. "ha kul", "ha roligt", "trivas", "känna glädje"
- "vilja samarbeta mer" får endast bli t.ex. "vilja samarbeta mer", "jobba mer ihop", "samarbeta bättre"
- Om du inte kan spegla WHY1 eller WHY2 konkret ska du skriva om texten tills du kan

FÖRBJUDET:
- inspirerande, lärorik, sömlös, högkvalitativ
- leverera, optimera, maximera, effektivisera
- upplevelse, innehåll, talare, logistik, garderob
- abstrakta ord som inte finns i WHY1 eller WHY2

SJÄLVKONTROLL (MÅSTE GÖRAS INNAN SVAR):
1. Kontrollera att WHY1 speglas tydligt
2. Kontrollera att WHY2 speglas tydligt
3. Kontrollera att inga förbjudna ord används
4. Om något inte stämmer – skriv om texten

Svara ENDAST med den färdiga syftesbeskrivningen.
`;

  const user =
    `WHY1: ${why1}\n` +
    `WHY2: ${why2}` +
    (feedback?.trim()
      ? `\nTIDIGARE FEEDBACK: ${feedback.trim()}`
      : "");

  // Första försök
  const first = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    temperature: 0.15
  });

  let text = first.choices[0].message.content?.trim() || "";

  // Enkel hård kontroll – om den inte ens börjar rätt, gör om en gång
  if (!text.startsWith("Eventet arrangeras i syfte att")) {
    const retry = await client.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: system + "\n\nDU BRÖT MOT KRAVEN. GÖR OM TEXTEN." },
        { role: "user", content: user }
      ],
      temperature: 0.1
    });

    text = retry.choices[0].message.content?.trim() || "";
  }

  return text;
}

/* =========================================================
   HANDLER
   ========================================================= */

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  try {
    const body = req.body as EventWizardBody;
    const { step, input, state = {}, context = {} } = body;
    const { field } = state;

    if (!field) return res.status(400).json({ error: "Missing field" });

    /* -------------------- STEP: subtitle -------------------- */
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

    /* -------------------- STEP: target_group -------------------- */
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

    /* -------------------- STEP: previous_feedback -------------------- */
    if (step === "clarify" && field === "previous_feedback") {
      const tags = formatFeedback(
        state.feedback_tags || [],
        state.feedback_custom
      );

      let summary = await proposePreviousFeedbackSummary(tags);

      if (!hasValidPreviousFeedbackStyle(summary)) {
        summary = await proposePreviousFeedbackSummary(
          tags,
          "DU ANVÄNDE FEL TON ELLER ÅTGÄRDSSPRÅK. BESKRIV ENDAST UPPLEVELSER."
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

/* -------------------- STEP: purpose -------------------- */
if (step === "clarify" && field === "purpose") {
  const feedback = state.previous_feedback || context.previous_feedback || "";

  // Steg 1: varken WHY1 eller WHY2 är ifyllda
  if (!state.purpose_why1 && !state.purpose_why2 && !input) {
    return res.json({
      ok: true,
      ui: [{
        role: "assistant",
        text: "Börja med att kort beskriva varför det här eventet planeras."
      }],
      next_step: "clarify",
      state
    });
  }

  // Steg 2: användaren har precis svarat på WHY1
  if (!state.purpose_why1 && input) {
    return res.json({
      ok: true,
      ui: [{
        role: "assistant",
        text: "Beskriv kort vilka effekter eller nyttor ni hoppas uppnå, både under och efter eventet."
      }],
      next_step: "clarify",
      state: { ...state, purpose_why1: input }
    });
  }

  // Steg 3: användaren har precis svarat på WHY2 eller båda finns redan
  const why1 = state.purpose_why1 || "";
  const why2 = state.purpose_why2 || input || "";

  if (!why2) {
    return res.status(400).json({
      error: "Saknar input till syftesbeskrivningens effekt/nytta"
    });
  }

  const proposal = await synthesizePurpose(why1, why2, feedback);

  if (!isPurposeValid(proposal)) {
  const retry = await synthesizePurpose(
    why1,
    why2,
    feedback + "\n\nFÖRRA FÖRSLAGET FÖLJDE INTE INSTRUKTIONERNA. FÖLJ DEM EXAKT."
  );

  return res.json({
    ok: true,
    ui: [{
      role: "assistant",
      text: "Första förslaget följde inte instruktionerna. Här är ett nytt:",
      value: retry,
      actions: [
        { text: "Använd denna", action: "finalize", value: retry },
        { text: "Justera", action: "ask_refinement" },
        { text: "Nytt förslag", action: "refine" },
        { text: "Redigera", action: "edit" }
      ]
    }],
    next_step: "propose",
    state: {
      ...state,
      last_proposal: retry
    }
  });
}

  return res.json({
    ok: true,
    ui: [{
      role: "assistant",
      text: "Här är ett förslag på syftesbeskrivning utifrån det du skrev:",
      value: proposal,
      actions: [
        { text: "Använd denna", action: "finalize", value: proposal },
        { text: "Justera", action: "ask_refinement" },
        { text: "Nytt förslag", action: "refine" },
        { text: "Redigera", action: "edit" }
      ]
    }],
    next_step: "propose",
    state: {
      ...state,
      purpose_why1: why1,
      purpose_why2: why2,
      last_proposal: proposal
    }
  });
}

    /* -------------------- FINALIZE -------------------- */
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
