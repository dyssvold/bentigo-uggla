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
    const { message, context, last_message } = req.body ?? {};
    if (!message) return res.status(400).json({ error: "Missing user message" });

    // 🔒 Säkerställ att syfte- och målgruppsflöden ALDRIG körs här
    if (
      context?.focus_field === "program.purpose" ||
      context?.focus_field === "program.audience_profile"
    ) {
      return res.status(200).json({
        reply:
          "Det här steget hanteras av ett separat flöde i appen. Klicka på Uggle-knappen bredvid fältet för att starta rätt process.",
      });
    }

    // 1. Hämta tips från Tipsbank
    const tips = await fetchTips(message);

    // 2. Formatera tipsen
    const inspiredTips = tips.length
      ? tips.map((t: any, i: number) => `${i + 1}. ${t.title}: ${t.content}`).join("\n")
      : "Inga relevanta interna tips hittades.";

    // 3. Systemprompt
    const SYSTEM_PROMPT = `
Du är "Ugglan", en svensk eventdesign-assistent i Bentigo.

- Du svarar bara på frågor som har koppling till event, möten, aktiviteter eller inkludering.
- Tolka alltid ord som "föreläsare", "talare", "moderator", "program", "inslag", "övning" eller "aktivitet" som eventrelaterade, även om ämnet i sig (t.ex. AI, hållbarhet, hälsa) är brett.
- Om en fråga verkligen inte går att koppla till event, möten, aktiviteter eller inkludering:
  • Ge svaret: "Jag fokuserar på event, möten och inkludering. Vill du att jag hjälper dig koppla din fråga till det området?"
  • Om användaren därefter svarar "ja" eller något liknande:
    – Omformulera den ursprungliga frågan till event-kontext.
    – Ge sedan ett konkret och användbart svar inom domänen.

- Svara alltid på svenska, aldrig på engelska.
- Svara kortfattat, vänligt och praktiskt.
- Använd enkelt, vardagligt språk men korrekt grammatik.
- Undvik metaforer eller konstiga uttryck som 'tända motivationen'.
- Använd i stället vanliga ord som 'öka motivationen', 'stärka gemenskapen', 'att arbetet känns mer inspirerande'.
- Använd [APP CONTEXT] för att anpassa svaren.
- Hantera inte syfte- eller målgruppsprocesser här; de körs via separata API:er (/api/purpose_flow och /api/audience_flow). 

- Om användaren ber om analys av ett program:
  • Räkna ut eller be om genomsnittligt engagemang och NFI-index för alla frames (om tillgängligt i context).
  • Ge alltid exakt 3 konkreta justeringar.
  • Håll råden enkla och handlingsbara.

- Om användaren ber om förslag på en aktivitet, övning, inslag eller upplägg:
  • Ge ett huvudförslag.
  • Lägg till variationer för olika deltagartyper (Analytiker, Interaktörer, Visionärer).
  • Lägg till NPF-anpassningar (med eller utan diagnos).
  • Eventuellt en kompletterande aktivitet om någon riskerar att exkluderas.
  • Håll språket enkelt och positivt.

- Om användaren istället ställer en faktabaserad fråga (t.ex. "hur många pennor behövs?"):
  • Ge ett kort, rakt och praktiskt svar.
  • Använd inte aktivitetsstrukturen i dessa fall.

- Om du använder generell kunskap, se alltid till att formulera den kopplad till event, aktiviteter, möten eller inkludering. 
  Om det inte går: svara kort att du fokuserar på event, möten och inkludering, och erbjud hjälp att koppla frågan till det området.

HOPA – Human Oriented Participation Architecture:
- Analytiker uppskattar struktur och reflektion.
- Interaktörer gillar samarbete och energi.
- Visionärer drivs av syfte och helhet.
En bra design blandar aktiviteter för alla tre typer, bygger trygghet först och skapar inkludering genom variation och tydlighet.

[APP CONTEXT]
${JSON.stringify(context ?? {}, null, 2)}

[INSPIRED TIPS]
${inspiredTips}

Använd tipsen som inspiration, men formulera svaret med egna ord anpassat till frågan.
    `.trim();

    // 4. Skicka till OpenAI
    const rsp = await client.responses.create({
      model: "gpt-4o-mini",
      input: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "developer", content: "APP CONTEXT: " + JSON.stringify(context) },
        { role: "user", content: String(message ?? "") },
        last_message
          ? { role: "assistant", content: "Föregående svar: " + last_message }
          : null,
      ].filter(Boolean),
    });

    const reply = (rsp as any).output_text ?? "Ho-ho-hooray, hur kan jag hjälpa dig?";
    res.status(200).json({ reply, tips_used: tips.length });
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message ?? err) });
  }
}
