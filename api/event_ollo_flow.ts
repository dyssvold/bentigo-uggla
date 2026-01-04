import OpenAI from "openai";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* ---------------- Types ---------------- */

type Step =
  | "start"
  | "analyze"
  | "ask_clarifying"
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

/* ---------------- Helpers ---------------- */

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
      "Skapa eller förbättra ett kort, tydligt och förklarande namn för eventet.",
    event_description:
      "Skapa eller förbättra en beskrivning som tydligt förklarar vad eventet är och vad deltagaren kan förvänta sig.",
    public_description:
      "Skapa eller förbättra en publik text som lockar rätt målgrupp och är lätt att förstå utan intern kontext.",
    purpose:
      "Skapa eller förbättra en syftesbeskrivning som tydliggör varför eventet genomförs.",
    audience_profile:
      "Skapa eller förbättra en deltagarbeskrivning som tydliggör vilka deltagarna är och deras behov.",
  }[field];
}

function normalizeMustInclude(list: string[] = []) {
  return Array.from(
    new Set(list.map(s => s.trim()).filter(Boolean))
  );
}

function containsAllMustInclude(text: string, mustInclude: string[]) {
  return mustInclude.every(req => text.includes(req));
}

/* ---------------- GPT: propose ---------------- */

async function proposeImproved(
  field: EventField,
  baseText: string,
  adjustment?: string,
  mustInclude: string[] = []
) {
  const normalizedMust = normalizeMustInclude(mustInclude);

  const system = `
Du är Ollo.

${fieldInstruction(field)}

VIKTIGA REGLER:
- Följ användarens instruktioner ordagrant om de är tydliga.
- Hitta inte på innehåll.
- Förbättra tydlighet, inte längd.

FORMATREGLER:
- Eventnamn: endast inledande versal i första ordet.
- Bevara exakt stavning, versaler och ordning i obligatoriska uttryck.
- Tappa aldrig bort uttryck som måste finnas med.

${
  normalizedMust.length
    ? `Följande uttryck MÅSTE finnas med exakt:
${normalizedMust.map(e => `- ${e}`).join("\n")}`
    : ""
}
`;

  const user =
    `UTGÅNGSTEXT:\n${baseText}\n\n` +
    (adjustment ? `ANVÄNDARENS INSTRUKTION:\n${adjustment}` : "");

  const rsp = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.3,
  });

  const proposal = rsp.choices[0].message.content?.trim() || "";

  if (!containsAllMustInclude(proposal, normalizedMust)) {
    return proposeImproved(
      field,
      baseText,
      `${adjustment ?? ""}\nOBS: Obligatoriskt uttryck saknas. Försök igen.`,
      normalizedMust
    );
  }

  return proposal;
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
    const mustInclude = normalizeMustInclude(state.must_include);

    if (!field) {
      return res.status(400).json({ error: "Missing field context" });
    }

    /* -------- start -------- */
    if (step === "start" && existingValue) {
      return res.json({
        ok: true,
        ui: [{
          role: "assistant",
          text:
            `Eventet har redan ${fieldLabel(field)}:\n\n${existingValue}\n\n` +
            "Vill du ha hjälp att förbättra den?",
          buttons: [
            { text: "Ja, gärna", action: "continue" },
            { text: "Avbryt", action: "cancel" },
          ],
        }],
        next_step: "ask_clarifying",
        state: { field, existing_value: existingValue, must_include: [] },
      });
    }

    /* -------- ask_clarifying -------- */
    if (step === "ask_clarifying") {
      const updatedMust = input
        ? normalizeMustInclude([...mustInclude, input])
        : mustInclude;

      const proposal = await proposeImproved(
        field,
        existingValue,
        undefined,
        updatedMust
      );

      return res.json({
        ok: true,
        ui: [
          { role: "assistant", text: `Här är ett förslag:\n\n${proposal}` },
          {
            role: "assistant",
            buttons: [
              { text: "Justera", action: "refine" },
              { text: "Spara", action: "finalize" },
            ],
          },
        ],
        next_step: "refine",
        state: {
          ...state,
          must_include: updatedMust,
          last_proposal: proposal,
        },
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
        actions: [{
          type: "save_event_field",
          field,
          value: state.last_proposal,
        }],
        next_step: "done",
      });
    }

    return res.status(400).json({ error: "Invalid step" });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
