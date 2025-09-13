// api/purpose_flow.ts
import OpenAI from "openai";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

type PurposeBody = {
  step: 0 | 1 | 2;
  input?: string;
  state?: { why1?: string };
  context?: { program_id?: string | null; has_purpose?: boolean | null };
};

const PQ1 =
  "Vad roligt att få hjälpa till med beskrivning av syftet. Det kommer guida oss till att senare kunna välja rätt aktiviteter.\n\n" +
  "Syftet ska svara på **varför** ett event genomförs. Helst ur både arrangörens och deltagarnas perspektiv.\n\n" +
  "Börja med en kort beskrivning av varför det här eventet planeras?";

const PQ2 =
  "Tack! Ofta finns också **ett djupare syfte**. För att hitta det kan ni tänka på:\n" +
  "- Varför är det viktigt att ses just nu?\n" +
  "- Vilken förändring vill ni se som resultat av att eventet genomförts?\n" +
  "- Vad skulle ni kunna tappa om eventet inte genomförs?\n\n" +
  "Försök göra en kort beskrivning av några nyttor, effekter eller förändringar som ni hoppas eventet ska leda till, både under eventet och efter att det genomförts.";

async function synthesizePurpose(why1: string, why2: string) {
  const system =
    "Du är Ugglan, en svensk eventassistent. " +
    "Skriv alltid på svenska. " +
    "Omformulera WHY1 och WHY2 till ett förädlat syfte: " +
    "en tydlig och inspirerande syftesbeskrivning som pekar på den djupare intentionen " +
    "och vilken effekt arrangören vill skapa genom att eventet genomförs. " +
    "Syftet ska inte bara återge utan förädla svaren. " +
    "Syftesbeskrivningen ska bestå av 1–3 meningar och max 50 ord totalt. " +
    "Använd enkelt, vardagligt språk. " +
    "Undvik metaforer eller onaturliga uttryck som 'tända motivationen'. " +
    "Beskriv i stället med vanliga ord som 'öka motivationen', 'att arbetet känns mer inspirerande', 'stärka gemenskapen'. " +
    "Undvik uppräkningar av aktiviteter; fokusera på effekten och intentionen. " +
    "Skriv bara själva syftesbeskrivningen, inget annat.";
    
  const user = `WHY1: ${why1}\nWHY2: ${why2}`;
  const rsp = await client.responses.create({
    model: "gpt-4o-mini",
    input: [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
  });
  return (rsp as any).output_text?.trim() || "";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    return res.status(200).end();
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  try {
    const body = req.body as PurposeBody;
    const step = body?.step ?? 0;
    const input = body?.input?.trim();
    const state = body?.state ?? {};
    const hasPurpose = body?.context?.has_purpose ?? false;

    // Om syfte redan finns
    if (hasPurpose === true && step === 0) {
      return res.status(200).json({
        ok: true,
        ui: [
          {
            role: "assistant",
            id: "purpose_refine_intro",
            text: "Eventet har redan ett syfte. Vill ni förtydliga eller omformulera det?"
          }
        ],
        next_step: "refine_prompt",
      });
    }

    // Steg 0: Fråga första frågan (pq1)
    if (step === 0) {
      return res.status(200).json({
        ok: true,
        ui: [{ role: "assistant", id: "pq1", text: PQ1 }],
        next_step: 1
      });
    }

    // Steg 1: Mottog svar på pq1 → fråga pq2
    if (step === 1) {
      if (!input) return res.status(400).json({ error: "Missing input (why1)" });
      return res.status(200).json({
        ok: true,
        ui: [{ role: "assistant", id: "pq2", text: PQ2 }],
        state: { ...state, why1: input },
        next_step: 2
      });
    }

    // Steg 2: Mottog svar på pq2 → generera slutligt syfte
    if (step === 2) {
      if (!input) return res.status(400).json({ error: "Missing input (why2)" });
      if (!state?.why1) return res.status(400).json({ error: "Missing why1" });

      const purpose = await synthesizePurpose(state.why1, input);

      const finalMsg =
        `Snyggt! Då skulle vi kunna formulera syftet så här:\n\n` +
        `**${purpose}**\n\n` +
        `Vill du eller ni ändra något, eller ska vi spara detta som syfte?`;

      return res.status(200).json({
        ok: true,
        ui: [{ role: "assistant", id: "purpose_final", text: finalMsg }],
        data: { purpose_candidate: purpose },
        actions: [{ type: "offer_edit_or_save", field: "purpose" }],
        next_step: "done"
      });
    }

    return res.status(400).json({ error: "Invalid step" });
  } catch (err: any) {
    return res.status(500).json({ error: String(err?.message ?? err) });
  }
}
