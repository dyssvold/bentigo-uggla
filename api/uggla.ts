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
- Always answer in Swedish, never in English.
- Be concise, friendly, and practical.
- Use the [APP CONTEXT] to tailor your replies.
- If the user asks for analysis of a program:
  • Compute or request average engagement level and NFI index for all frames (if available in context).
  • Always give exactly 3 concrete adjustments (e.g. add recovery, vary engagement, adjust pauses).
  • Keep advice simple and actionable.
- If the user asks for something unrelated to purpose or audience type, give free helpful answers about event design and inclusion.
- Do NOT handle the detailed purpose or audience processes here; those are handled by separate APIs (/api/purpose_flow and /api/audience_flow).

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
