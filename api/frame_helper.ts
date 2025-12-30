// api/frame_helper.ts
import OpenAI from "openai";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    return res.status(200).end();
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  try {
    const {
      frame_id,
      existing_data = {},
      context = {},
    }: {
      frame_id: string;
      existing_data?: {
        reflection?: string;
        interaction?: string;
        steps?: { label: string; duration: number }[];
      };
      context: {
        purpose: string;
        audience: string;
        theme?: string;
      };
    } = req.body;

    const system =
      "Du är Ugglan, en svensk AI-assistent som hjälper arrangörer att förbättra en programpunkt i ett eventprogram.\n" +
      "Ge praktiska, konkreta förslag för hur man kan lägga till reflektion, interaktion och bygga upp ett steg-för-steg-upplägg.\n" +
      "Använd enkelt språk. Anpassa förslagen utifrån syfte, deltagarprofil och eventtema.\n" +
      "Minst ett inslag av reflektion och ett av interaktion ska finnas. Inget steg får vara längre än 20 minuter.\n" +
      "Beräkna ett NFI-index (1–5) där 5 är mest neurovänligt, samt engagemangsnivå (1–5).\n" +
      "Returnera ENDAST ett JSON-objekt med följande fält: reflection_suggestion, interaction_suggestion, steps (med label och duration), nfi_index, engagement_level.";

    const user =
      `Eventets syfte: ${context.purpose}\n` +
      `Deltagarprofil: ${context.audience}\n` +
      (context.theme ? `Tema: ${context.theme}\n` : "") +
      `Befintlig data: ${JSON.stringify(existing_data)}`;

    const rsp = await client.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: "json",
    });

    const json = JSON.parse(rsp.choices[0].message.content || "{}");

    return res.status(200).json({ ok: true, frame_id, suggestions: json });
  } catch (err: any) {
    return res.status(500).json({ error: String(err?.message ?? err) });
  }
}
