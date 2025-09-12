// api/audience_flow.ts
import OpenAI from "openai";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

type AudienceBody = {
  step: 0 | 1 | 2 | 3 | 4;
  input?: string;
  state?: {
    who?: string;
    needs?: string;
    special?: string;
    archetype?: string;
  };
  context?: { program_id?: string | null; has_audience?: boolean | null };
};

function q(id: string, text: string) {
  return [{ role: "assistant", id, text }];
}

async function synthesizeAudience(state: Required<AudienceBody>["state"]) {
  const system =
    `Du är Ugglan. Skriv en kort svensk deltagarprofil (2–3 meningar). ` +
    `Integrera WHO, NEEDS, SPECIAL och ARCHETYPE. Skriv i neutralt tonfall.`;

  const user =
    `WHO: ${state.who}\nNEEDS: ${state.needs}\nSPECIAL: ${state.special}\nARCHETYPE: ${state.archetype}`;

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
    const body = req.body as AudienceBody;
    const step = body?.step ?? 0;
    const input = body?.input?.trim();
    const state = body?.state ?? {};
    const hasAudience = body?.context?.has_audience ?? false;

    if (hasAudience === true && step === 0) {
      return res.status(200).json({
        ok: true,
        ui: [{ role: "assistant", id: "audience_refine_intro", text: "Eventet har redan en deltagarbeskrivning. Vill ni förtydliga eller definiera om den?" }],
        next_step: "refine_prompt",
      });
    }

    if (step === 0) {
      return res.status(200).json({
        ok: true,
        ui: q("audience_pq1", "Lyckade event bygger på formeln: varför och för vem ger svaret på var, när och vad. Låt oss nu beskriva för vem eventet planeras, så att vi sedan kan välja upplägg och aktiviteter på ett bättre sätt. Beskriv vilka de förväntade deltagarna är, med 2–3 meningar."),
        next_step: 1
      });
    }

    if (step === 1) {
      if (!input) return res.status(400).json({ error: "Missing input (who)" });
      return res.status(200).json({
        ok: true,
        ui: q("audience_pq2", "Tack! Har du eller ni någon idé om några särskilda behov, önskningar eller förväntningar dessa kan ha? Exempelvis aktiviteter de gillar, saker de vill lära sig mer om, få chans att träna på eller annat. Beskriv med några meningar."),
        state: { ...state, who: input },
        next_step: 2
      });
    }

    if (step === 2) {
      if (!input) return res.status(400).json({ error: "Missing input (needs)" });
      return res.status(200).json({
        ok: true,
        ui: q("audience_pq3", "Tack! Finns det några andra detaljer, exempelvis önskemål i utvärderingar från tidigare, eller andra hänsyn vi bör ha koll på?"),
        state: { ...state, needs: input },
        next_step: 3
      });
    }

    if (step === 3) {
      if (!input) return res.status(400).json({ error: "Missing input (special)" });
      return res.status(200).json({
        ok: true,
        ui: q("audience_pq4", "Bentigo bygger på tre deltagartyper: Analytiker (jobbar och tänker gärna enskilt, strukturerat), Interaktörer (jobbar och tänker gärna tillsammans, mer spontant), och Visionärer (jobbar och tänker gärna på systemnivå, med tydligt syfte och verkliga utmaningar). Skulle du/ni säga att någon av dessa grupper kommer vara i majoritet, och i så fall vilken?"),
        state: { ...state, special: input },
        next_step: 4
      });
    }

    if (step === 4) {
      if (!input) return res.status(400).json({ error: "Missing input (archetype)" });
      const fullState = { ...state, archetype: input } as Required<AudienceBody>["state"];
      const profile = await synthesizeAudience(fullState);
      const finalMsg = `Då föreslår jag att vi gör denna deltagarbeskrivning:\n${profile}\n\nVill du spara den?`;
      return res.status(200).json({
        ok: true,
        ui: [{ role: "assistant", id: "audience_final", text: finalMsg }],
        data: { audience_candidate: profile },
        actions: [{ type: "offer_save", field: "audience_profile" }],
        next_step: "done"
      });
    }

    return res.status(400).json({ error: "Invalid step" });
  } catch (err: any) {
    return res.status(500).json({ error: String(err?.message ?? err) });
  }
}
