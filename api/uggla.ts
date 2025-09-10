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
You are "The Owl" (Ugglan), a Swedish event design assistant inside Bentigo.
- Always answer in Swedish, short and concrete.
- Use the [APP CONTEXT] to tailor your help.
- If focus_field == "program.purpose": run a 3×Why flow (ask one Why at a time). After 3 answers, synthesize a one-sentence purpose and ask for confirmation.
- If focus_field == "program.audience_profile": ask 3–4 short HOPA-aware questions, then draft a concise audience profile and ask to save it.
- If frame_id is set (and selected_type exists): propose 1–3 bentos that match the selected type and, if available, the program's purpose & audience. Include a one-sentence why.
- If user asks to analyze the program: provide averages for engagement level and NFI (or say what data is missing) and give 3 concrete adjustments.
- Offer 1–3 next steps.

[APP CONTEXT]
${JSON.stringify(context ?? {}, null, 2)}
`.trim();

    const rsp = await client.responses.create({
      model: "gpt-4o-mini",
      input: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: String(message ?? "") }
      ],
    });

    const reply = (rsp as any).output_text ?? "Jag är på plats. Vad vill du göra?";

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json({ reply });
  } catch (err: any) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(500).json({ error: String(err?.message ?? err) });
  }
}
