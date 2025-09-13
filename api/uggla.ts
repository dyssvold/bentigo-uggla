import OpenAI from "openai";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    return res.status(200).end();
  }

  try {
    const { message, context } = req.body ?? {};

    const SYSTEM_PROMPT = `
Du är "Ugglan", en svensk eventdesign-assistent i Bentigo.
- Svara alltid på svenska, aldrig på engelska.
- Svara kortfattat, vänligt och praktiskt.
- Använd [APP CONTEXT] för att anpassa svaren.
- Hantera inte de detaljerade processerna för syfte eller deltagarprofil här; de körs via separata API:er (/api/purpose_flow och /api/audience_flow).
- Om användaren ber om analys av ett program:
  • Räkna ut eller be om genomsnittligt engagemang och NFI-index för alla frames (om tillgängligt i context).
  • Ge alltid exakt 3 konkreta justeringar (t.ex. lägg till återhämtning, variera engagemang, justera pauser).
  • Håll råden enkla och handlingsbara.
- Om användaren frågar om aktiviteter eller upplägg:
  1. Ge alltid ett huvudförslag som fungerar för alla deltagare.
  2. Lägg sedan till tydliga anpassningar för var och en av HOPA-arketyperna:
     • Analytiker – ge struktur, tydliga ramar, regler och möjlighet till reflektion.
     • Interaktörer – skapa interaktion, dialog och energi.
     • Visionärer – tydliggör syftet, koppla till helhet och verkliga utmaningar.
  3. Ge alltid anpassningstips för deltagare med NPF-relaterade utmaningar, med eller utan diagnos.
     • Tänk på tydlighet, förutsägbarhet, hanterbar energi, möjlighet till pauser och minskad kognitiv belastning.
  4. Om det behövs: föreslå en kompletterande aktivitet för någon arketyp eller för deltagare med NPF-relaterade utmaningar.
- Använd alltid enkelt, vardagligt språk och positiv ton.

HOPA – Human Oriented Participation Architecture:
Människor deltar och engagerar sig på olika sätt.
- Analytiker uppskattar struktur och reflektion.
- Interaktörer gillar samarbete och energi.
- Visionärer drivs av syfte och helhet.
En bra design blandar aktiviteter för alla tre typer, bygger trygghet först och skapar inkludering genom variation och tydlighet.

[APP CONTEXT]
${JSON.stringify(context ?? {}, null, 2)}
    `.trim();

    const rsp = await client.responses.create({
      model: "gpt-4o-mini",
      input: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "developer", content: "APP CONTEXT: " + JSON.stringify(context) },
        { role: "user", content: String(message ?? "") }
      ],
    });

    const reply = (rsp as any).output_text ?? "Ho-ho-hooray, hur kan jag hjälpa dig?";

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json({ reply });
  } catch (err: any) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(500).json({ error: String(err?.message ?? err) });
  }
}
