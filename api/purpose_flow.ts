async function synthesizePurpose(
  why1: string,
  why2: string,
  previous_feedback?: string | null
) {
  const system = `
Du är Ugglan, en svensk eventassistent.

🧠 DITT UPPDRAG:
Skriv en syftesbeskrivning som FÖLJER MALLEN NEDAN – utan att lägga till något eget. Använd BARA ord och intentioner från WHY1 och WHY2.

📐 MALL:
Eventet arrangeras i syfte att … [formulera baserat på WHY1, max 15 ord per mening, lägg till en andra mening som börjar med “Dessutom …” om det behövs].
Eventet ska också bidra till … [formulera baserat på WHY2, max 15 ord per mening, lägg till en andra mening som börjar med “Slutligen att …” om det behövs].

📌 FORMREGLER:
- Texten måste börja exakt med “Eventet arrangeras i syfte att”
- Endast 1–3 meningar, 20–50 ord
- Endast löpande text (inga rubriker, inga listor)
- Endast vardagligt språk – inga abstrakta, professionella eller fluffiga uttryck

🚫 FÖRBJUDET:
- Du får INTE lägga till: talare, ämnen, innehåll, logistik, program, resultat, verktyg, insikter, kunskap, värde
- Du får INTE skriva något som inte finns i WHY1 eller WHY2

✅ SLUTKOLL INNAN DU SVARAR:
1. Har du speglat både WHY1 och WHY2?
2. Innehåller texten inga förbjudna ord?
3. Följer du exakt mallen?
4. Är texten 20–50 ord lång?

✉️ SVAR:
Svara ENDAST med den färdiga syftesbeskrivningen (ingen rubrik, ingen förklaring).
`;

  const user = `WHY1: ${why1}\nWHY2: ${why2}` +
    (previous_feedback?.trim()
      ? `\nTIDIGARE FEEDBACK: ${previous_feedback.trim()}`
      : "");

  const rsp = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.1, // extremt låg temperatur för att öka lydnad
  });

  const text = rsp.choices[0].message.content?.trim() || "";

  // Validering
  const wordCount = text.split(/\s+/).length;
  const forbidden =
    /\b(inspirerande|lärorik|högkvalitativ|sömlös|effektivisera|optimera|maximera|talare|ämnen|innehåll|logistik|garderob|program|resultat|utveckling|verktyg|insikter|kunskap|värde)\b/i;
  const valid =
    text.startsWith("Eventet arrangeras i syfte att") &&
    wordCount >= 20 &&
    wordCount <= 50 &&
    !forbidden.test(text);

  if (!valid) {
    // Sista utväg
    return (
      "Eventet arrangeras i syfte att deltagarna ska ha roligt tillsammans. " +
      "Eventet ska också bidra till att de vill samarbeta mer med varandra."
    );
  }

  return text;
}
