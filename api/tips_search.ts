// api/tips_search.ts
import { createClient } from "@supabase/supabase-js";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    return res.status(200).end();
  }

  try {
    const query = String(req.method === "GET" ? req.query.query : req.body?.query ?? "").trim();
    if (!query) return res.status(400).json({ error: "Missing query string" });

    const { data, error } = await supabase
      .from("tipsbank_search") // din view
      .select("id, title, content, tags_text, source")
      .ilike("combined_text", `%${query}%`) // combined_text = title + content + tags_text
      .limit(5);

    if (error) throw error;

    return res.status(200).json({ ok: true, results: data ?? [] });
  } catch (err: any) {
    return res.status(500).json({ error: String(err?.message ?? err) });
  }
}
