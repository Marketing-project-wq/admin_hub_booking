// ───────────────────────────────────────────────────────────────────────────
// ⚠️  MIRROR dari Supabase Edge Function "rss-proxy" (project cpvzwqptzcxnwzfzgrmt, verify_jwt=false).
// Snapshot untuk git. Repo ini TIDAK auto-deploy edge functions — kalau ada
// perubahan, WAJIB deploy ulang manual ke Supabase (supabase functions deploy rss-proxy,
// atau Supabase MCP deploy_edge_function). Jangan edit lalu lupa deploy.
// ───────────────────────────────────────────────────────────────────────────

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

const RSS_SOURCES: Record<string, string[]> = {
  health: [
    "https://www.healthline.com/rss/health-news",
    "https://feeds.webmd.com/rss/rss.aspx?RSSSource=RSS_PUBLIC",
  ],
  wellness: [
    "https://www.mindbodygreen.com/rss.xml",
    "https://greatist.com/feed",
  ],
  fitness: [
    "https://www.menshealth.com/rss/all.xml",
    "https://www.womenshealthmag.com/rss/all.xml",
  ],
  nutrition: [
    "https://www.eatthis.com/feed/",
    "https://www.nutritionaction.com/feed/",
  ],
  hyrox: [
    "https://hyrox.com/feed/",
    "https://www.runnersworld.com/feed/",
  ],
  finance: [
    "https://feeds.bbci.co.uk/news/business/rss.xml",
    "https://feeds.reuters.com/reuters/businessNews",
  ],
  global: [
    "https://feeds.bbci.co.uk/news/world/rss.xml",
    "https://feeds.reuters.com/Reuters/worldNews",
  ],
}

interface RSSItem {
  id: string
  title: string
  summary: string
  link: string
  image: string | null
  pubDate: string
  readTime: string
  category: string
}

function extractImage(itemXml: string): string | null {
  // media:content
  const m1 = itemXml.match(/<media:content[^>]+url=["']([^"']+)["'][^>]*>/i)
  if (m1) return m1[1]

  // media:thumbnail
  const m2 = itemXml.match(/<media:thumbnail[^>]+url=["']([^"']+)["'][^>]*>/i)
  if (m2) return m2[1]

  // enclosure image
  const m3 = itemXml.match(/<enclosure[^>]+url=["']([^"']+)["'][^>]*type=["']image[^"']*["']/i)
  if (m3) return m3[1]

  // itunes:image
  const m4 = itemXml.match(/<itunes:image[^>]+href=["']([^"']+)["'][^>]*>/i)
  if (m4) return m4[1]

  // og:image in content
  const m5 = itemXml.match(/property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
  if (m5) return m5[1]

  // First <img src> in content:encoded or description
  const contentEncoded = itemXml.match(/<content:encoded>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/content:encoded>/i)?.[1] ?? ''
  const description = itemXml.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i)?.[1] ?? ''
  const htmlContent = contentEncoded || description
  const m6 = htmlContent.match(/<img[^>]+src=["']([^"']+)["']/i)
  if (m6 && m6[1].startsWith('http')) return m6[1]

  return null
}

function cleanText(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function estimateReadTime(text: string): string {
  const words = text.split(/\s+/).length
  const minutes = Math.max(1, Math.round(words / 200))
  return `${minutes} min read`
}

function parseRSS(xml: string, category: string): RSSItem[] {
  const items: RSSItem[] = []
  const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)
  let idx = 0

  for (const match of itemMatches) {
    const itemXml = match[1]

    const title = cleanText(
      itemXml.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i)?.[1] ?? ''
    )

    // Prefer content:encoded for longer description
    const contentEncoded = itemXml.match(/<content:encoded>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/content:encoded>/i)?.[1]
    const rawDesc = itemXml.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i)?.[1]
    const summary = cleanText(contentEncoded ?? rawDesc ?? '').slice(0, 500)

    const link = cleanText(
      itemXml.match(/<link>([\s\S]*?)<\/link>/i)?.[1] ?? ''
    )

    const pubDate = cleanText(
      itemXml.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1] ?? ''
    )

    const image = extractImage(itemXml)

    if (title && link && summary) {
      items.push({
        id: `${category}_${idx++}`,
        title,
        summary,
        link,
        image,
        pubDate,
        readTime: estimateReadTime(summary),
        category,
      })
    }

    if (items.length >= 8) break
  }

  return items
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })

  try {
    const { category, complaint } = await req.json()
    const cat = (category ?? 'health') as string

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    )

    // Check DB cache (skip if complaint provided)
    if (!complaint) {
      const { data: cached } = await supabase
        .from('discover_cache')
        .select('articles, expires_at')
        .eq('category', cat)
        .single()

      if (cached && new Date(cached.expires_at) > new Date()) {
        console.log(`Cache hit: ${cat}`)
        return new Response(JSON.stringify({ articles: cached.articles, cached: true }), {
          headers: { ...CORS, "Content-Type": "application/json" }
        })
      }
    }

    // Fetch RSS sources in parallel
    const sources = RSS_SOURCES[cat] ?? RSS_SOURCES.health
    console.log(`Fetching RSS for category: ${cat}, sources: ${sources.length}`)

    const results = await Promise.allSettled(
      sources.map(url =>
        fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
            'Accept': 'application/rss+xml, application/xml, text/xml, */*',
          },
          signal: AbortSignal.timeout(8000),
        }).then(r => r.text())
      )
    )

    let allItems: RSSItem[] = []
    for (const result of results) {
      if (result.status === 'fulfilled') {
        const items = parseRSS(result.value, cat)
        console.log(`Parsed ${items.length} items from source`)
        allItems = [...allItems, ...items]
      } else {
        console.error(`RSS fetch failed: ${result.reason}`)
      }
    }

    console.log(`Total items: ${allItems.length}`)

    let finalArticles: RSSItem[] = []

    if (complaint && allItems.length > 0) {
      // Use Claude to rank by relevance to complaint
      const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!
      try {
        const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 200,
            messages: [{
              role: "user",
              content: `User complaint: "${complaint}". Return ONLY a JSON array of up to 3 most relevant article IDs. Example: ["health_0","health_2"]. Articles:\n${allItems.map(a => `${a.id}: ${a.title}`).join('\n')}`
            }]
          })
        })
        const claudeData = await claudeRes.json()
        const text = claudeData.content?.[0]?.text ?? '[]'
        const relevantIds = JSON.parse(text.replace(/```json|```/g, '').trim()) as string[]
        const relevant = allItems.filter(a => relevantIds.includes(a.id))
        const rest = allItems.filter(a => !relevantIds.includes(a.id))
        finalArticles = [...relevant, ...rest].slice(0, 8)
      } catch (e) {
        console.error('Claude ranking failed:', e)
        finalArticles = allItems.slice(0, 8)
      }
    } else {
      finalArticles = allItems.slice(0, 8)
    }

    // Save to DB cache
    if (!complaint && finalArticles.length > 0) {
      const { error: upsertErr } = await supabase
        .from('discover_cache')
        .upsert({
          category: cat,
          articles: finalArticles,
          cached_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        }, { onConflict: 'category' })
      if (upsertErr) console.error('Cache upsert error:', upsertErr)
      else console.log(`Cache saved: ${cat}, ${finalArticles.length} articles`)
    }

    return new Response(JSON.stringify({ articles: finalArticles }), {
      headers: { ...CORS, "Content-Type": "application/json" }
    })

  } catch (err) {
    console.error("rss-proxy error:", err)
    return new Response(JSON.stringify({ error: String(err), articles: [] }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" }
    })
  }
})