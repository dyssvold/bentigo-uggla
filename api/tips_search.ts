// api/tips_search.ts
import { createClient } from "@supabase/supabase-js";
import type { VercelRequest, VercelResponse } from "@vercel/node";

// Initiera Supabase-klient med anon key
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
    // Tillåt både POST body och GET query string
    const query =
      (req.method === "POST" ? req.body?.query : req.query?.query) ?? null;

    if (!query || typeof query !== "string") {
      return res.status(400).json({
        error: "Missing 'query'. Provide it in JSON body or query param."
      });
    }

    const { data, error } = await supabase
      .from("tipsbank_search") // viewen vi skapade
      .select("id, title, content, tags, tags_text, source, created_at")
      .or(
        `title.ilike.%${query}%,content.ilike.%${query}%,tags_text.ilike.%${query}%`
      )
      .limit(5);

    if (error) throw error;

    return res.status(200).json({
      ok: true,
      results: data ?? []
    });
  } catch (err: any) {
    return res.status(500).json({ error: String(err?.message ?? err) });
  }
}
