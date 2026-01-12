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

🧠 DITT UPPDRAG:
Skriv en syftesbeskrivning som följer nedan mall, utan att lägga till annan information än det som kommer från WHY1 och WHY2.

📐 MALL – ANVÄND DENNA STRUKTUR:
Eventet arrangeras i syfte att … [baserat på WHY1, max 15 ord per mening, lägg till en andra mening som inleds med ”Dessutom …” om det behövs].
Eventet ska också bidra till … [baserat på WHY2, max 15 ord per mening, lägg till en andra mening som inleds med ”Slutligen att …” om det behövs].

🧱 FORMREGLER:
- Texten måste börja exakt med: Eventet arrangeras i syfte att
- Skriv sammanhängande löptext (inga punktlistor, rubriker eller mellanrubriker)
- 1–3 meningar
- Minst 20 ord, max 50 ord

🎯 INNEHÅLLSKRAV:
- Texten ska TYDLIGT spegla både WHY1 och WHY2
- Använd enkla vardagliga ord – inte abstrakta, professionella eller marknadsförande formuleringar
- Om WHY1 t.ex. är "ha kul" – använd "ha roligt", "trivas" eller "känna glädje"
- Om WHY2 t.ex. är "vilja samarbeta mer" – använd "samarbeta mer", "jobba bättre ihop" eller "vilja till att samarbeta"

🚫 FÖRBJUDNA ORD:
- inspirerande, lärorik, högkvalitativ, sömlös, effektivisera, optimera, maximera
- talare, ämnen, innehåll, logistik, garderob, program
- resultat, utveckling, verktyg, insikter, kunskap, värde

Svara ENDAST med den färdiga syftesbeskrivningen.
`;

  const user =
    `WHY1: ${why1}\n` +
    `WHY2: ${why2}` +
    (feedback?.trim() ? `\nTIDIGARE FEEDBACK: ${feedback.trim()}` : "");

  /* ---------------- Valideringshjälpare ---------------- */

  const forbiddenRegex =
    /\b(inspirerande|lärorik|högkvalitativ|sömlös|effektivisera|optimera|maximera|talare|ämnen|innehåll|logistik|garderob|program|resultat|utveckling|verktyg|insikter|kunskap|värde)\b/i;

  const normalize = (s: string) =>
    s.toLowerCase().replace(/[^\wåäö\s]/gi, "");

  const reflectsWhy = (text: string, why: string) => {
    const whyWords = normalize(why)
      .split(/\s+/)
      .filter(w => w.length > 3);

    const normalizedText = normalize(text);
    return whyWords.some(w => normalizedText.includes(w));
  };

  const isValid = (text: string): boolean => {
    const words = text.split(/\s+/).length;
    const startsCorrectly = text.startsWith("Eventet arrangeras i syfte att");
    const lengthOk = words >= 20 && words <= 50;
    const noForbidden = !forbiddenRegex.test(text);
    const why1Ok = reflectsWhy(text, why1);
    const why2Ok = reflectsWhy(text, why2);

    return startsCorrectly && lengthOk && noForbidden && why1Ok && why2Ok;
  };

  /* ---------------- GPT-anrop ---------------- */

  const getGPTResponse = async (strict = false) => {
    return await client.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: system + (strict ? "\n\n⚠️ DU BRÖT MOT KRAVEN. GÖR OM EXAKT ENLIGT MALLEN." : "")
        },
        { role: "user", content: user }
      ],
      temperature: strict ? 0.05 : 0.15
    });
  };

  /* ---------------- Försök med fallback ---------------- */

  const MAX_ATTEMPTS = 3;
  let attempt = 0;
  let text = "";

  while (attempt < MAX_ATTEMPTS) {
    const strict = attempt > 0;
    const rsp = await getGPTResponse(strict);
    text = rsp.choices[0].message.content?.trim() || "";

    // 🔍 Avkommentera vid felsökning
    // console.log("GPT attempt", attempt + 1, text);

    if (isValid(text)) {
      return text;
    }

    attempt++;
  }

  /* ---------------- Sista utväg ---------------- */

  return (
    `Eventet arrangeras i syfte att deltagarna ska ha roligt tillsammans. ` +
    `Eventet ska också bidra till att de vill samarbeta mer med varandra.`
  );
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
