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
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST" });
  }

  try {
    // Försök alltid parsa body korrekt
    let body: any = {};
    if (req.body) {
      if (typeof req.body === "string") {
        try {
          body = JSON.parse(req.body);
        } catch {
          body = {};
        }
      } else {
        body = req.body;
      }
    }

    // Tillåt även query-param
    const query =
      body?.query ||
      (typeof req.query.query === "string" ? req.query.query : null);

    if (!query || typeof query !== "string") {
      return res
        .status(400)
        .json({ error: "Missing 'query'. Provide it in JSON body or query param." });
    }

    // Kör sökning i Supabase
    const { data, error } = await supabase
      .from("Tipsbank")
      .select("id, title, content, tags")
      .or(
        `title.ilike.%${query}%,content.ilike.%${query}%,tags.ilike.%${query}%`
      )
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
