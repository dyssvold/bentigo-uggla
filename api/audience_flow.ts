// api/audience_flow.ts
import OpenAI from "openai";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

type AudienceBody = {
  step: 0 | 1 | 2 | 3 | 4 | "final_edit";
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
    "Du är Ugglan, en svensk eventassistent.\n\n" +
    "HOPA – Human Oriented Participation Architecture:\n" +
    "HOPA är en modell för att designa möten och event så att fler deltagare kan känna sig inkluderade, trygga och engagerade. " +
    "Människor tar till sig, deltar och bidrar på olika sätt, och därför är det viktigt att utgå från olika deltagartyper.\n\n" +
    "Tre deltagartyper (arketyper):\n" +
    "- **Analytiker** – uppskattar struktur, tydliga ramar och att tänka enskilt. De gillar fördjupning, detaljer och reflektion. Viktigt med tid, struktur och lugna återhämtningsmöjligheter.\n" +
    "- **Interaktörer** – trivs bäst när de får tänka tillsammans, prata, testa och samarbeta. De får energi av interaktion, rörelse och gemensamt skapande. Viktigt med inslag där de är aktiva.\n" +
    "- **Visionärer** – gillar att tänka stort, koppla syfte till verkliga utmaningar och se helheten. De drivs av mening, systemperspektiv och relevans. Viktigt att visa syftet, nyttan och verklighetsanknytningen.\n\n" +
    "Principer: blanda aktiviteter för att passa alla tre typer. Undvik att utgå från en norm. Skapa trygghet först. Anpassa efter olika funktionssätt och variera energi.\n\n" +
    "Instruktion för texten: skriv en kort svensk deltagarprofil (2–3 meningar) baserat på användarens input (WHO, NEEDS, SPECIAL, ARCHETYPE). " +
    "Använd enkelt och vardagligt språk. Undvik svåra ord som 'beakta' eller 'variabilitet'. " +
    "Undvik också uttryck som kan låta negativt, som 'gräva ner sig i detaljer'. " +
    "Använd istället positiva formuleringar som 'uppskattar fördjupning', 'har sinne för detaljer' eller 'trivs med att analysera information noggrant'. " +
    "När du beskriver ARCHETYPE:\n" +
    "- Om ARCHETYPE är en av 'Analytiker', 'Interaktörer' eller 'Visionärer': skriv att deltagarprofilen kan luta mot den typen, och förklara kort vad det innebär i praktiken.\n" +
    "- Om ARCHETYPE är 'ingen', 'alla', 'osäker' eller något annat: skriv istället att deltagarna har en blandad profil och förklara att upplägget bör innehålla variation.\n" +
    "Beskriv aldrig att deltagarna är 'klassificerade som' en typ. Ge alltid en praktisk förklaring.";

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
        ui: [{ role: "assistant", id: "audience_refine_intro", text: "Eventet har redan en deltagarbeskrivning. Vill du eller ni förtydliga eller ändra på den?" }],
        next_step: "refine_prompt",
      });
    }

    if (step === 0) {
      return res.status(200).json({
        ok: true,
        ui: q("audience_pq1",
          "Lyckade event bygger på formeln: **varför** och **för vem** ger svar på **var**, **när** och **vad**.\n\n" +
          "Nu ska vi göra en tydlig deltagarbeskrivning som i kommande steg kan guida oss till rätt upplägg och aktiviteter.\n\n" +
          "Börja med att kort beskriva vilka som ska delta i eventet."
        ),
        next_step: 1
      });
    }

    if (step === 1) {
      if (!input) return res.status(400).json({ error: "Missing input (who)" });
      return res.status(200).json({
        ok: true,
        ui: q("audience_pq2",
          "Tack! Finns det några särskilda behov, önskningar eller förväntningar deltagarna kan ha? " +
          "Exempelvis aktiviteter de gillar, saker de vill lära sig mer om, få chans att träna på eller något annat?"
        ),
        state: { ...state, who: input },
        next_step: 2
      });
    }

    if (step === 2) {
      if (!input) return res.status(400).json({ error: "Missing input (needs)" });
      return res.status(200).json({
        ok: true,
        ui: q("audience_pq3",
          "Finns det andra detaljer, exempelvis önskemål i utvärderingar från tidigare som vi bör ha koll på?"
        ),
        state: { ...state, needs: input },
        next_step: 3
      });
    }

    if (step === 3) {
      if (!input) return res.status(400).json({ error: "Missing input (special)" });
      return res.status(200).json({
        ok: true,
        ui: q("audience_pq4",
          "En sista fråga!\n\n" +
          "Bentigo bygger på tre deltagartyper:\n" +
          "- **Analytiker** *(jobbar och tänker gärna enskilt, strukturerat)*\n" +
          "- **Interaktörer** *(jobbar och tänker gärna tillsammans, mer spontant)*\n" +
          "- **Visionärer** *(jobbar och tänker gärna på systemnivå, med tydligt syfte och verkliga utmaningar)*\n\n" +
          "Tror du eller ni att någon eller några av dessa kommer vara i majoritet? Ange i så fall vilken."
        ),
        state: { ...state, special: input },
        next_step: 4
      });
    }

    if (step === 4) {
      if (!input) return res.status(400).json({ error: "Missing input (archetype)" });
      const fullState = { ...state, archetype: input } as Required<AudienceBody>["state"];
      const profile = await synthesizeAudience(fullState);

      const finalMsg =
        `Då föreslår jag denna deltagarbeskrivning:\n\n${profile}\n\n` +
        `Vill du eller ni ändra något, eller ska vi spara denna deltagarbeskrivning?`;

      return res.status(200).json({
        ok: true,
        ui: [{ role: "assistant", id: "audience_final", text: finalMsg }],
        data: { audience_candidate: profile },
        actions: [{ type: "offer_edit_or_save", field: "audience_profile" }],
        next_step: "done"
      });
    }

    if (step === "final_edit") {
      if (!input) return res.status(400).json({ error: "Missing edited audience profile" });

      const finalMsg =
        `Uppdaterat förslag på deltagarbeskrivning:\n\n${input}\n\n` +
        `Vill du eller ni ändra något mer, eller ska vi spara denna deltagarbeskrivning?`;

      return res.status(200).json({
        ok: true,
        ui: [{ role: "assistant", id: "audience_final_edit", text: finalMsg }],
        data: { audience_candidate: input },
        actions: [{ type: "offer_edit_or_save", field: "audience_profile" }],
        next_step: "done"
      });
    }

    return res.status(400).json({ error: "Invalid step" });
  } catch (err: any) {
    return res.status(500).json({ error: String(err?.message ?? err) });
  }
}
