import OpenAI from "openai";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* ---------------- Types ---------------- */

type Step =
  | "start"
  | "analyze"
  | "ask_clarifying"
  | "propose"
  | "refine"
  | "finalize";

type EventField =
  | "event_name"
  | "event_description"
  | "public_description"
  | "purpose"
  | "audience_profile";

type EventOlloBody = {
  step: Step;
  input?: string;
  state?: {
    field?: EventField;
    existing_value?: string;
    last_proposal?: string;
    must_include?: string[];
  };
  context?: {
    field?: EventField;
    existing_value?: string | null;
  };
};

/* ---------------- Field helpers ---------------- */

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
      "Skapa eller förbättra ett kort, tydligt och säljande namn som förklarar vad eventet handlar om.",
    event_description:
      "Skapa eller förbättra en beskrivning som tydligt förklarar vad eventet är, varför det genomförs och vad deltagaren kan förvänta sig.",
    public_description:
      "Skapa eller förbättra en publik text som lockar rätt målgrupp och är lätt att förstå även utan intern kontext.",
    purpose:
      "Skapa eller förbättra en syftesbeskrivning som tydliggör varför eventet genomförs och vilken effekt man vill uppnå.",
    audience_profile:
      "Skapa eller förbättra en deltagarbeskrivning som tydliggör vilka deltagarna är, deras behov och hur upplägget bör anpassas.",
  }[field];
}

/* ---------------- GPT: analysis ---------------- */

async function analyzeExisting(field: EventField, text: string) {
  const system = `
Du är Ollo, en erfaren rådgivare för mötes- och eventdesign.

Analysera texten för fältet "${field}".

Identifiera:
- 1–2 styrkor
- 1–2 konkreta förbättringsområden

Var särskilt uppmärksam på:
- Om texten är för generisk (t.ex. "Frukostseminarium", "Konferens 2025")
- Om texten är otydlig, intern eller svårbegriplig
- Om viktig kontext saknas för att kunna förbättra texten

Avgör om du behöver ställa en följdfråga innan du kan ge ett bra förslag.

Svara ENDAST med giltig JSON:
{
  "strengths": string[],
  "improvements": string[],
  "needs_clarification": boolean,
  "clarifying_question": string | null
}`;

  const rsp = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: system },
      { role: "user", content: `TEXT:\n${text}` },
    ],
    temperature: 0.2,
  });

  return JSON.parse(rsp.choices[0].message.content || "{}");
}

/* ---------------- GPT: propose / refine ---------------- */

async function proposeImproved(
  field: EventField,
  baseText: string,
  adjustment?: string,
  mustInclude: string[] = []
) {
  const system = `
Du är Ollo.

${fieldInstruction(field)}

VIKTIGA REGLER:
- Om användaren ger ett konkret förslag (t.ex. "ändra till X"), använd X som slutresultat.
- Kombinera inte med tidigare formuleringar om användaren varit tydlig.
- Hitta inte på innehåll som inte stöds av användarens input.
- Förbättra tydlighet, begriplighet och relevans – inte omfattning.
- Anpassa ton efter fältets funktion.
- Om användaren har upprepat ett krav flera gånger (t.ex. att ett visst uttryck ska finnas med), se till att det aldrig tappas i förslaget.
- Använd små bokstäver förutom första ordet i namn (inga inledande versaler i varje ord).
` + (mustInclude.length > 0 ? `
Inkludera alltid följande uttryck i resultatet:
${mustInclude.map(e => `- ${e}`).join("\n")}
` : "");

  const user =
    `UTGÅNGSTEXT:\n${baseText}\n\n` +
    (adjustment ? `ANVÄNDARENS INSTRUKTION:\n${adjustment}` : "");

  const rsp = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.35,
  });

  return rsp.choices[0].message.content?.trim() || "";
}

/* ---------------- Handler ---------------- */

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Use POST" });

  try {
    const body = req.body as EventOlloBody;
    const { step, input, state = {}, context = {} } = body;

    const field = state.field || context.field;
    const existingValue = state.existing_value ?? context.existing_value ?? "";
    const mustInclude = state.must_include ?? [];

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
              { text: "Avbryt", action: "cancel" },
            ],
          },
        ],
        next_step: "analyze",
        state: { field, existing_value: existingValue, must_include: [] },
      });
    }

    /* -------- analyze -------- */
    if (step === "analyze") {
      const analysis = await analyzeExisting(field, existingValue);

      if (analysis.needs_clarification && analysis.clarifying_question) {
        return res.json({
          ok: true,
          ui: [{ role: "assistant", text: analysis.clarifying_question }],
          next_step: "ask_clarifying",
          state,
        });
      }

      const proposal = await proposeImproved(field, existingValue, undefined, mustInclude);

      return res.json({
        ok: true,
        ui: [
          { role: "assistant", text: `Här är ett förbättrat förslag:\n\n${proposal}` },
          { role: "assistant", buttons: [
            { text: "Justera", action: "refine" },
            { text: "Spara", action: "finalize" },
          ] },
        ],
        next_step: "refine",
        state: { ...state, last_proposal: proposal },
      });
    }

    /* -------- ask_clarifying -------- */
    if (step === "ask_clarifying") {
      const proposal = await proposeImproved(field, existingValue, input, mustInclude);

      return res.json({
        ok: true,
        ui: [
          { role: "assistant", text: `Tack! Här är ett första förslag:\n\n${proposal}` },
          { role: "assistant", buttons: [
            { text: "Justera", action: "refine" },
            { text: "Spara", action: "finalize" },
          ] },
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
        input,
        mustInclude
      );

      return res.json({
        ok: true,
        ui: [
          { role: "assistant", text: `Uppdaterat förslag:\n\n${proposal}` },
          { role: "assistant", buttons: [
            { text: "Justera mer", action: "refine" },
            { text: "Spara", action: "finalize" },
          ] },
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
          { type: "save_event_field", field, value: state.last_proposal },
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
