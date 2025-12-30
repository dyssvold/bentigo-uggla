// api/audience_flow.ts
import OpenAI from "openai";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

type AudienceBody = {
  step: 0 | 1 | 2 | "final_edit" | "refine_existing";
  input?: string;
  existing_audience?: string;
  state?: {
    who?: string;
    needs?: string;
    archetype?: string;
  };
  context?: {
    program_id?: string | null;
    has_audience?: boolean | null;
  };
};

function q(id: string, text: string) {
  return [{ role: "assistant", id, text }];
}

/* ---------- AI: skapa deltagarprofil ---------- */

async function synthesizeAudience(state: Required<AudienceBody>["state"]) {
  const system =
    "Du är Ugglan, en svensk eventassistent.\n\n" +
    "HOPA – Human Oriented Participation Architecture:\n" +
    "HOPA är en modell för att designa möten och event så att fler deltagare kan känna sig inkluderade, trygga och engagerade.\n\n" +
    "Tre deltagartyper:\n" +
    "- Analytiker – uppskattar struktur, fördjupning och lugn.\n" +
    "- Interaktörer – trivs med samarbete, dialog och aktivitet.\n" +
    "- Visionärer – drivs av syfte, helhet och verklighetskoppling.\n\n" +
    "Instruktion:\n" +
    "Skriv en kort svensk deltagarbeskrivning (2–3 meningar).\n" +
    "Språket ska vara vardagligt, positivt och inkluderande.\n" +
    "Om en arketyp anges, skriv att deltagarprofilen kan luta åt den.\n" +
    "Om ingen tydlig arketyp anges, skriv att gruppen är blandad och behöver variation.";

  const user =
    `WHO: ${state.who}\n` +
    `NEEDS: ${state.needs}\n` +
    `ARCHETYPE: ${state.archetype}`;

  const rsp = await client.responses.create({
    model: "gpt-4o-mini",
    input: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });

  return (rsp as any).output_text?.trim() || "";
}

/* ---------- AI: förbättra befintlig text ---------- */

async function refineAudience(existing: string, userInput: string) {
  const system =
    "Du är Ugglan, en svensk eventassistent.\n" +
    "Din uppgift är att förbättra en befintlig deltagarbeskrivning.\n" +
    "Behåll ton, längd och stil, men förtydliga och förbättra utifrån användarens input.\n" +
    "Skriv 2–3 meningar, vardagligt och inkluderande.";

  const user =
    `Befintlig deltagarbeskrivning:\n${existing}\n\n` +
    `Användarens tillägg eller önskemål:\n${userInput}`;

  const rsp = await client.responses.create({
    model: "gpt-4o-mini",
    input: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });

  return (rsp as any).output_text?.trim() || "";
}

/* ---------- Handler ---------- */

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    return res.status(200).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST" });
  }

  try {
    const body = req.body as AudienceBody;
    const step = body.step ?? 0;
    const input = body.input?.trim();
    const state = body.state ?? {};
    const hasAudience = body.context?.has_audience ?? false;

    /* ---------- Steg 0: start ---------- */

    if (step === 0 && hasAudience && body.existing_audience) {
      return res.status(200).json({
        ok: true,
        ui: q(
          "audience_existing",
          "Det finns redan en deltagarbeskrivning:\n\n" +
            body.existing_audience +
            "\n\nVill du förbättra eller förtydliga den? Beskriv i så fall vad du vill ändra."
        ),
        next_step: "refine_existing",
      });
    }

    if (step === 0) {
      return res.status(200).json({
        ok: true,
        ui: q(
          "audience_q1",
          "Lyckade event bygger på formeln: **varför** och **för vem**.\n\n" +
            "Börja med att kort beskriva vilka som ska delta och vilka behov, önskemål eller förväntningar de kan ha."
        ),
        next_step: 1,
      });
    }

    /* ---------- Steg 1: WHO + NEEDS ---------- */

    if (step === 1) {
      if (!input) {
        return res.status(400).json({ error: "Missing input (who + needs)" });
      }

      return res.status(200).json({
        ok: true,
        ui: q(
          "audience_q2",
          "En sista fråga.\n\n" +
            "Bentigo utgår från tre deltagartyper:\n" +
            "- Analytiker\n" +
            "- Interaktörer\n" +
            "- Visionärer\n\n" +
            "Tror du att någon av dessa är vanligare i gruppen?"
        ),
        state: { ...state, who: input, needs: input },
        next_step: 2,
      });
    }

    /* ---------- Steg 2: ARCHETYPE ---------- */

    if (step === 2) {
      if (!input) {
        return res.status(400).json({ error: "Missing input (archetype)" });
      }

      const fullState = {
        ...state,
        archetype: input,
      } as Required<AudienceBody>["state"];

      const profile = await synthesizeAudience(fullState);

      return res.status(200).json({
        ok: true,
        ui: [
          {
            role: "assistant",
            id: "audience_final",
            text:
              "Jag föreslår denna deltagarbeskrivning:\n\n" +
              profile +
              "\n\nVill du ändra något, eller ska vi spara den?",
          },
        ],
        data: { audience_candidate: profile },
        actions: [{ type: "offer_edit_or_save", field: "audience_profile" }],
        next_step: "done",
      });
    }

    /* ---------- Förbättra befintlig ---------- */

    if (step === "refine_existing") {
      if (!input || !body.existing_audience) {
        return res
          .status(400)
          .json({ error: "Missing input or existing audience" });
      }

      const improved = await refineAudience(
        body.existing_audience,
        input
      );

      return res.status(200).json({
        ok: true,
        ui: [
          {
            role: "assistant",
            id: "audience_refined",
            text:
              "Här är ett uppdaterat förslag:\n\n" +
              improved +
              "\n\nVill du ändra något mer, eller ska vi spara?",
          },
        ],
        data: { audience_candidate: improved },
        actions: [{ type: "offer_edit_or_save", field: "audience_profile" }],
        next_step: "done",
      });
    }

    /* ---------- Manuell slutredigering ---------- */

    if (step === "final_edit") {
      if (!input) {
        return res.status(400).json({ error: "Missing edited audience profile" });
      }

      return res.status(200).json({
        ok: true,
        ui: [
          {
            role: "assistant",
            id: "audience_final_edit",
            text:
              "Uppdaterat förslag:\n\n" +
              input +
              "\n\nVill du spara detta?",
          },
        ],
        data: { audience_candidate: input },
        actions: [{ type: "offer_edit_or_save", field: "audience_profile" }],
        next_step: "done",
      });
    }

    return res.status(400).json({ error: "Invalid step" });
  } catch (err: any) {
    return res.status(500).json({
      error: String(err?.message ?? err),
    });
  }
}
