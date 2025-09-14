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
    const { message, context, last_message, original_question } = req.body ?? {};
    if (!message) return res.status(400).json({ error: "Missing user message" });

    // 🔒 Blockera syfte- och målgruppsflöden här
    if (
      context?.focus_field === "program.purpose" ||
      context?.focus_field === "program.audience_profile"
    ) {
      return res.status(200).json({
        reply:
          "Det här steget hanteras av ett separat flöde i appen. Klicka på Uggle-knappen bredvid fältet för att starta rätt process.",
      });
    }

    // 🚦 Kolla om användaren just bekräftat ("ja" etc) efter fallback
    const lowerMsg = String(message).trim().toLowerCase();
    const isAffirmative = ["ja", "ja gärna", "absolut", "okej", "gör det"].includes(lowerMsg);

    if (
      isAffirmative &&
      last_message?.includes("Jag fokuserar på event, möten och inkludering") &&
      (original_question || context?.original_question)
    ) {
      const baseQuestion = original_question || context?.original_question;

      const prompt = `
Du är Ugglan, en svensk eventdesign-assistent. 
Utgångsfråga: "${baseQuestion}".

Gör följande:
- Omformulera frågan så att den tydligt handlar om event, möten, aktiviteter eller inkludering. 
- Ge sedan ett kort och praktiskt svar som GUIDAR användaren (t.ex. vad de kan tänka på, vilka steg de kan ta, eller en enkel mall).
- Ge aldrig ett färdigt svar som om du själv vore leverantören (t.ex. skriv inte offertbrev, inbjudningar eller färdiga mail).
- Skriv alltid på svenska, enkelt och praktiskt.
      `.trim();

      const rsp2 = await client.responses.create({
        model: "gpt-4o-mini",
        input: [{ role: "system", content: prompt }],
      });

      const reply2 = (rsp2 as any).output_text ?? "Jag har tyvärr inget bra svar just nu.";
      return res.status(200).json({ reply: reply2, tips_used: 0 });
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
- Tolka alltid ord som "föreläsare", "talare", "moderator", "program", "inslag", "övning" eller "aktivitet" som eventrelaterade.
- Om en fråga verkligen inte går att koppla till dessa områden:
  • Ge svaret: "Jag fokuserar på event, möten och inkludering. Vill du att jag hjälper dig koppla din fråga till det området?"
  • Spara den ursprungliga frågan i context.original_question för nästa steg.
- Om användaren sedan bekräftar ("ja" etc): omformulera frågan till event-kontext och ge ett guidande, inte levererande, svar.

- Svara alltid på svenska, aldrig på engelska.
- Svara kortfattat, vänligt och praktiskt.
- Använd enkelt, vardagligt språk men korrekt grammatik.
- Undvik konstiga uttryck som 'tända motivationen'.
- Använd istället vanliga ord som 'öka motivationen', 'stärka gemenskapen', 'att arbetet känns mer inspirerande'.

- Hantera inte syfte- eller målgruppsprocesser här.
- Om användaren ber om analys av ett program: ge exakt 3 konkreta justeringar.
- Om användaren ber om aktivitet/övning/inslag: ge huvudförslag + variationer för HOPA + NPF-anpassningar.
- Om frågan är faktabaserad: svara kort och praktiskt.

- Ge aldrig ett färdigt leverantörssvar (t.ex. offert eller mail). Hjälp bara användaren med guidning, exempel eller mallar.

HOPA – Human Oriented Participation Architecture:
- Analytiker uppskattar struktur och reflektion.
- Interaktörer gillar samarbete och energi.
- Visionärer drivs av syfte och helhet.

[APP CONTEXT]
${JSON.stringify(context ?? {}, null, 2)}

[INSPIRED TIPS]
${inspiredTips}
    `.trim();

    // 4. Skicka till OpenAI
    const rsp = await client.responses.create({
      model: "gpt-4o-mini",
      input: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "developer", content: "APP CONTEXT: " + JSON.stringify(context) },
        { role: "user", content: String(message ?? "") },
      ],
    });

    const reply = (rsp as any).output_text ?? "Ho-ho-hooray, hur kan jag hjälpa dig?";
    res
      .status(200)
      .json({ reply, tips_used: tips.length, original_question: message });
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message ?? err) });
  }
}
