// api/uggla.ts
import OpenAI from "openai";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Funktion för att hämta relevanta tips från Tipsbank via vårt tips_search-API
async function fetchTips(query: string) {
  try {
    const rsp = await fetch(`${process.env.VERCEL_URL}/api/tips_search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    const json = await rsp.json();
    return json?.results ?? [];
  } catch (err) {
    console.error("Tips fetch error:", err);
    return [];
  }
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
    const { message, context } = req.body ?? {};
    if (!message) return res.status(400).json({ error: "Missing user message" });

    // 1. Hämta tips från Tipsbank
    const tips = await fetchTips(message);

    // 2. Formatera tipsen
    const inspiredTips = tips.length
      ? tips.map((t: any, i: number) => `${i + 1}. ${t.title}: ${t.content}`).join("\n")
      : "Inga relevanta interna tips hittades.";

    // 3. Systemprompt
    const SYSTEM_PROMPT = `
Du är "Ugglan", en svensk eventdesign-assistent i Bentigo.
- Svara alltid på svenska, aldrig på engelska.
- Svara kortfattat, vänligt och praktiskt.
– Använd enkelt, vardagligt språk men med korrekt svensk grammatik.
– Undvik metaforer eller onaturliga uttryck som 'tända motivationen', 'allow'.
– Använd i stället vanliga ord som 'öka motivationen', 'att arbetet känns mer inspirerande', 'stärka gemenskapen'.
- Använd [APP CONTEXT] för att anpassa svaren.
- Hantera inte de detaljerade processerna för syfte eller deltagarprofil här; de körs via separata API:er (/api/purpose_flow och /api/audience_flow).

- Om användaren ber om analys av ett program:
  • Räkna ut eller be om genomsnittligt engagemang och NFI-index för alla frames (om tillgängligt i context).
  • Ge alltid exakt 3 konkreta justeringar (t.ex. lägg till återhämtning, variera engagemang, justera pauser).
  • Håll råden enkla och handlingsbara.

- Om användaren uttryckligen ber om **förslag på en aktivitet, övning, inslag eller upplägg**:
  1. Ge alltid **ett huvudförslag** (en aktivitet som fungerar för alla).
  2. Lägg till sektionen "### Förslag på anpassningar och variation", med tips för olika deltagartyper:
     - För analytiker: struktur, ramar, reflektion.
     - För interaktörer: samarbete, dialog, energi.
     - För visionärer: syfte, helhet, verkliga utmaningar.
     Tipsen ska vara variationer av huvudförslaget, inte helt nya aktiviteter.
  3. Lägg alltid till "### NPF-anpassningar:" med anpassningar för **deltagare med NPF-relaterade utmaningar, med eller utan diagnos**:
     - tydlighet, förutsägbarhet, hanterbar energi, möjlighet till pauser, minskad kognitiv belastning.
  4. Lägg ev. till en sektion "### Kompletterande aktivitet" om någon arketyp eller deltagare annars riskerar att inte bli inkluderade.
  5. Använd alltid enkelt, vardagligt språk och en positiv ton.

- Om frågan istället handlar om **fakta, logistik eller kunskap** (t.ex. "hur många pennor behövs?", "hur minskar vi matsvinnet?"):
  • Ge ett kort, rakt och praktiskt svar.
  • Använd inte aktivitetsstrukturen i dessa fall.

HOPA – Human Oriented Participation Architecture:
Människor deltar och engagerar sig på olika sätt.
- Analytiker uppskattar struktur och reflektion.
- Interaktörer gillar samarbete och energi.
- Visionärer drivs av syfte och helhet.
En bra design blandar aktiviteter för alla tre typer, bygger trygghet först och skapar inkludering genom variation och tydlighet.

[APP CONTEXT]
${JSON.stringify(context ?? {}, null, 2)}

[INSPIRED TIPS]
${inspiredTips}

Använd alltid dessa tips som inspiration när du svarar, men formulera svaret med egna ord, anpassat till frågan.
    `.trim();

    // 4. Skicka till OpenAI
    const rsp = await client.responses.create({
      model: "gpt-4o-mini",
      input: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "developer", content: "APP CONTEXT: " + JSON.stringify(context) },
        { role: "user", content: String(message ?? "") }
      ],
    });

    const reply = (rsp as any).output_text ?? "Ho-ho-hooray, hur kan jag hjälpa dig?";

    res.status(200).json({ reply, tips_used: tips.length });
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message ?? err) });
  }
}
