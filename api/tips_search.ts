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
    res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    return res.status(200).end();
  }

  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ error: "Use POST or GET" });
  }

  try {
    // Hämta query från body eller query params
    const bodyQuery = req.body?.query;
    const urlQuery = (req.query as any)?.query;
    const query = bodyQuery || urlQuery;

    if (!query || typeof query !== "string") {
      return res.status(400).json({ error: "Missing query string" });
    }

    // Sök i tabellen Tipsbank (endast title + content)
    const { data, error } = await supabase
      .from("Tipsbank")
      .select("id, title, content, tags, source, created_at")
      .or(`title.ilike.%${query}%,content.ilike.%${query}%`)
      .limit(5);

    if (error) throw error;

    return res.status(200).json({
      ok: true,
      results: data ?? [],
    });
  } catch (err: any) {
    return res.status(500).json({ error: String(err?.message ?? err) });
  }
}
