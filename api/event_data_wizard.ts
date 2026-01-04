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
    must_include?: string[];
  };
  context?: {
    field: EventField;
    existing_value?: string | null;
    event_name?: string;
    subtitle?: string;
    target_group?: string;
    previous_feedback?: string;
    purpose?: string;
  };
};

/* ---------------- Helpers ---------------- */

function fieldInstruction(field: EventField): string {
  return {
    subtitle: "Skapa en kort underrubrik (max 8 ord) som fångar eventets tema eller fokus.",
    target_group: "Sammanfatta målgruppen i en löpande text, max 50 ord, utifrån tre nivåer av deltagare (obligatoriska, gärna, i mån av plats).",
    previous_feedback: "Sammanfatta relevant deltagarfeedback från tidigare event i max 50 ord.",
    purpose: "Skapa en syftesbeskrivning (max 50 ord) baserat på användarens input och tidigare metadata.",
    audience_profile: "Skapa en deltagarbeskrivning (max 60 ord) som inleds med 'Deltagarna är…' och bygger på input och metadata.",
    program_notes: "Skapa en objektiv beskrivning (max 60 ord) av eventet baserat på metadata.",
    public_description: "Skapa en publik beskrivning (max 80 ord) som lockar deltagare och baseras på tidigare fält."
  }[field];
}

function normalizeMustInclude(list: string[] = []): string[] {
  return Array.from(new Set(list.map(s => s.trim()).filter(Boolean)));
}

function containsAllMustInclude(text: string, mustInclude: string[]): boolean {
  return mustInclude.every(req => text.includes(req));
}

/* ---------------- GPT: propose ---------------- */

async function proposeImproved(
  field: EventField,
  baseText: string,
  adjustment?: string,
  mustInclude: string[] = [],
  context?: EventWizardBody["context"]
): Promise<string> {
  const normalizedMust = normalizeMustInclude(mustInclude);

  const system = `
Du är Ollo.

${fieldInstruction(field)}

FÖLJ DESSA PRINCIPER:
- Följ instruktioner ordagrant om de är tydliga.
- Förbättra tydlighet, struktur och språk – inte längd.
- Inkludera metadata där det hjälper.
- Inkludera exakt stavning, versaler och ordning på uttryck som ska vara med.

${normalizedMust.length ? `Följande uttryck MÅSTE finnas med exakt:\n${normalizedMust.map(e => `- ${e}`).join("\n")}` : ""}

Använd följande metadata vid behov:
- Eventnamn: ${context?.event_name ?? ""}
- Underrubrik: ${context?.subtitle ?? ""}
- Målgrupp: ${context?.target_group ?? ""}
- Tidigare feedback: ${context?.previous_feedback ?? ""}
- Syfte: ${context?.purpose ?? ""}
  `.trim();

  const user = `UTGÅNGSTEXT:\n${baseText}\n\n${adjustment ? `ANVÄNDARENS INSTRUKTION:\n${adjustment}` : ""}`;

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
    return proposeImproved(field, baseText, "OBLIGATORISKT UTTRYCK SAKNAS. FÖRSÖK IGEN.", normalizedMust, context);
  }

  return proposal;
}

/* ---------------- Handler ---------------- */

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  try {
    const body = req.body as EventWizardBody;
    const { step, input, state = {}, context = {} } = body;
    const field = state.field || context.field;
    const existingValue = state.existing_value ?? context.existing_value ?? "";
    const mustInclude = normalizeMustInclude(state.must_include);

    if (!field) return res.status(400).json({ error: "Missing field context" });

    /* -------- start -------- */
    if (step === "start") {
      return res.json({
        ok: true,
        ui: [{
          role: "assistant",
          text: existingValue
            ? `Följande text finns redan sparad för detta fält:\n\n${existingValue}\n\nVill du förbättra den med min hjälp?`
            : `Vill du att jag hjälper dig att skapa ${fieldInstruction(field).toLowerCase()}`,
          buttons: [
            { text: "Ja, gärna", action: "clarify" },
            { text: "Nej tack", action: "cancel" },
          ],
        }],
        next_step: "clarify",
        state: { field, existing_value: existingValue },
      });
    }

    /* -------- clarify -------- */
    if (step === "clarify") {
      const updatedMust = input
        ? normalizeMustInclude([...mustInclude, input])
        : mustInclude;

      const proposal = await proposeImproved(
        field,
        existingValue,
        undefined,
        updatedMust,
        context
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
        mustInclude,
        context
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
        state: {
          ...state,
          last_proposal: proposal,
        },
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
