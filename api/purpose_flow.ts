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
  "Vad roligt att få hjälpa till med beskrivning av syftet. Det blir en värdefull kompass för att välja rätt aktiviteter. " +
  "Syftet ska ge svar på varför eventet och aktiviteterna genomförs, ur både arrangörens och deltagarnas perspektiv. " +
  "Kan du börja med att kort beskriva varför ni gör det här eventet och varför deltagarna ska prioritera det (2–3 meningar)?";

const PQ2 =
  "Tack! Ofta finns också ett djupare syfte. För att hitta det kan ni tänka på: " +
  "1) Varför är det viktigt att ses just nu? " +
  "2) Vilken förändring vill ni se bortom själva eventet? " +
  "3) Vad skulle gå förlorat om eventet inte genomförs? " +
  "Beskriv detta med 2–3 meningar.";

async function synthesizePurpose(why1: string, why2: string) {
  const system =
  "Du är Ugglan, en svensk eventassistent. " +
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
    input: [{ role: "system", content: system }, { role: "user", content: user }],
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

    if (hasPurpose === true && step === 0) {
      return res.status(200).json({
        ok: true,
        ui: [{ role: "assistant", id: "purpose_refine_intro", text: "Eventet har redan ett syfte. Vill ni förtydliga eller omformulera det?" }],
        next_step: "refine_prompt",
      });
    }

    if (step === 0) {
      return res.status(200).json({
        ok: true,
        ui: [{ role: "assistant", id: "pq1", text: PQ1 }],
        next_step: 1
      });
    }

    if (step === 1) {
      if (!input) return res.status(400).json({ error: "Missing input (why1)" });
      return res.status(200).json({
        ok: true,
        ui: [{ role: "assistant", id: "pq2", text: PQ2 }],
        state: { ...state, why1: input },
        next_step: 2
      });
    }

    if (step === 2) {
      if (!input) return res.status(400).json({ error: "Missing input (why2)" });
      if (!state?.why1) return res.status(400).json({ error: "Missing why1" });

      const purpose = await synthesizePurpose(state.why1, input);
      const finalMsg = `Snyggt! Då skulle vi kunna formulera syftet så här: ${purpose}\n\nVill du ändra något, eller vill du spara detta som syfte?`;

      return res.status(200).json({
        ok: true,
        ui: [{ role: "assistant", id: "purpose_final", text: finalMsg }],
        data: { purpose_candidate: purpose },
        actions: [{ type: "offer_save", field: "purpose" }],
        next_step: "done"
      });
    }

    return res.status(400).json({ error: "Invalid step" });
  } catch (err: any) {
    return res.status(500).json({ error: String(err?.message ?? err) });
  }
}
