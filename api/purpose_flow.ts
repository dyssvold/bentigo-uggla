import OpenAI from "openai";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

type PurposeBody = {
  step: 0 | 1 | 2 | "final_edit" | "refine_existing";
  input?: string;
  state?: {
    why1?: string;
    why2?: string;
  };
  context?: {
    program_id?: string | null;
    has_purpose?: boolean | null;
    existing_purpose?: string | null;
    previous_feedback?: string | null; // ✅ NYTT FÄLT
  };
};

/* ---------- Frågetexter ---------- */

const PQ1 =
  "Ett tydligt syfte är avgörande för ett lyckat event. Det fungerar som en kompass i viktiga vägval.\n\n" +
  "Syftet ska svara på **varför** eventet genomförs – gärna både ur arrangörens och deltagarnas perspektiv.\n\n" +
  "Börja med att kort beskriva varför det här eventet planeras.";

const PQ2 =
  "Tack! Ofta finns också ett **djupare syfte**.\n\n" +
  "Fundera till exempel på:\n" +
  "- Varför är det viktigt att ses just nu?\n" +
  "- Vilken förändring vill ni se som resultat?\n" +
  "- Vad riskerar ni att tappa om eventet inte genomförs?\n\n" +
  "Beskriv kort vilka effekter eller nyttor ni hoppas uppnå, både under och efter eventet.";

/* ---------- GPT-syntes ---------- */

async function synthesizePurpose(
  why1: string,
  why2: string,
  previous_feedback?: string | null
) {
  const system =
    "Du är Ugglan, en svensk eventassistent.\n\n" +
    "HOPA – Human Oriented Participation Architecture:\n" +
    "Ett bra syfte hjälper olika deltagartyper (Analytiker, Interaktörer, Visionärer) att förstå varför eventet finns och varför deras medverkan spelar roll.\n\n" +
    "Instruktion:\n" +
    "- Förädla WHY1 och WHY2 till en tydlig och inspirerande syftesbeskrivning.\n" +
    "- Fokusera på intention och önskad effekt, inte på aktiviteter.\n" +
    "- 1–3 meningar, max 50 ord.\n" +
    "- Använd enkelt, vardagligt språk.\n" +
    "- Undvik metaforer och fluff.\n\n" +
    "Om tidigare års deltagarfeedback finns, väg in den i arbetet.\n\n" +
    "Skriv endast själva syftesbeskrivningen.";

  const user = `WHY1: ${why1}\nWHY2: ${why2}` +
    (previous_feedback
      ? `\nTIDIGARE FEEDBACK: ${previous_feedback}`
      : "");

  const rsp = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.4,
  });

  return rsp.choices[0].message.content?.trim() || "";
}

/* ---------- Handler ---------- */

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    return res.status(200).end();
  }
  if (req.method !== "POST")
    return res.status(405).json({ error: "Use POST" });

  try {
    const body = req.body as PurposeBody;
    const step = body?.step ?? 0;
    const input = body?.input?.trim();
    const state = body?.state ?? {};
    const ctx = body?.context ?? {};
    const hasPurpose = ctx?.has_purpose ?? false;
    const existingPurpose = ctx?.existing_purpose ?? null;
    const previousFeedback = ctx?.previous_feedback ?? null;

    /* ---------- FALL: förfina befintligt syfte ---------- */
    if (hasPurpose === true && step === 0 && existingPurpose) {
      return res.status(200).json({
        ok: true,
        ui: [
          {
            role: "assistant",
            id: "purpose_refine_intro",
            text:
              "Det finns redan en syftesbeskrivning:\n\n" +
              `**${existingPurpose}**\n\n` +
              "Vill du förbättra eller förtydliga den? Beskriv i så fall vad du vill ändra.",
          },
        ],
        next_step: "refine_existing",
        state: {
          why1: existingPurpose,
          why2: "",
        },
      });
    }

    /* ---------- REFINE_EXISTING ---------- */
    if (step === "refine_existing") {
      if (!input || !state?.why1) {
        return res
          .status(400)
          .json({ error: "Missing input or state for refinement" });
      }

      const fullState = {
        why1: state.why1,
        why2: state.why2
          ? `${state.why2}. ${input}`
          : input,
      };

      const purpose = await synthesizePurpose(
        fullState.why1,
        fullState.why2,
        previousFeedback
      );

      const finalMsg =
        `Jag har förbättrat syftet utifrån det du skrev:\n\n` +
        `**${purpose}**\n\n` +
        `Vill du ändra något mer, eller ska vi spara denna version?`;

      return res.status(200).json({
        ok: true,
        ui: [{ role: "assistant", id: "purpose_refined", text: finalMsg }],
        data: { purpose_candidate: purpose },
        actions: [{ type: "offer_edit_or_save", field: "purpose" }],
        next_step: "done",
      });
    }

    /* ---------- NYTT SYFTE (ORDINARIE FLÖDE) ---------- */
    if (step === 0) {
      return res.status(200).json({
        ok: true,
        ui: [{ role: "assistant", id: "pq1", text: PQ1 }],
        next_step: 1,
      });
    }

    if (step === 1) {
      if (!input)
        return res.status(400).json({ error: "Missing input (why1)" });

      return res.status(200).json({
        ok: true,
        ui: [{ role: "assistant", id: "pq2", text: PQ2 }],
        state: { ...state, why1: input },
        next_step: 2,
      });
    }

    if (step === 2) {
      if (!input || !state?.why1)
        return res.status(400).json({ error: "Missing input/state" });

      const purpose = await synthesizePurpose(
        state.why1,
        input,
        previousFeedback
      );

      const finalMsg =
        `Då föreslår jag detta syfte:\n\n` +
        `**${purpose}**\n\n` +
        `Vill du eller ni ändra något, eller ska vi spara detta?`;

      return res.status(200).json({
        ok: true,
        ui: [{ role: "assistant", id: "purpose_final", text: finalMsg }],
        data: { purpose_candidate: purpose },
        actions: [{ type: "offer_edit_or_save", field: "purpose" }],
        next_step: "done",
      });
    }

    /* ---------- FINAL_EDIT ---------- */
    if (step === "final_edit") {
      if (!input)
        return res.status(400).json({ error: "Missing edited purpose" });

      const finalMsg =
        `Uppdaterat förslag på syfte:\n\n` +
        `**${input}**\n\n` +
        `Vill du ändra något mer, eller ska vi spara detta?`;

      return res.status(200).json({
        ok: true,
        ui: [{ role: "assistant", id: "purpose_final_edit", text: finalMsg }],
        data: { purpose_candidate: input },
        actions: [{ type: "offer_edit_or_save", field: "purpose" }],
        next_step: "done",
      });
    }

    return res.status(400).json({ error: "Invalid step" });
  } catch (err: any) {
    return res.status(500).json({ error: String(err?.message ?? err) });
  }
}
