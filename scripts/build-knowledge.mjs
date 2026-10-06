// Builds data/knowledge.json from the public WordPress REST API of worksmarto.com.
// Runs daily in GitHub Actions (see .github/workflows/sync-knowledge.yml).
// Usage: node scripts/build-knowledge.mjs
import { writeFile, readFile, mkdir } from "node:fs/promises";

const SITE = process.env.SITE_URL || "https://worksmarto.com";
const OUT = "data/knowledge.json";
const CHUNK_WORDS = 160; // ~1 paragraph per chunk
const SKIP_SLUGS = new Set(["blog"]); // listing pages with no real content

function decode(s = "") {
  return s
    .replace(/&#8217;|&#8216;|&rsquo;|&lsquo;/g, "'")
    .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"')
    .replace(/&#8211;|&ndash;/g, "-")
    .replace(/&#8212;|&mdash;/g, "-")
    .replace(/&#038;|&amp;/g, "&")
    .replace(/&hellip;|&#8230;/g, "...")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
}

function htmlToText(html = "") {
  return decode(
    html
      .replace(/<(script|style|noscript|svg|form)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<\/(p|h[1-6]|li|div|tr|br)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\[[^\]]*\]/g, " ") // shortcodes
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

function chunk(text) {
  const paras = text.split("\n").map((p) => p.trim()).filter((p) => p.length > 30);
  const chunks = [];
  let buf = [];
  let words = 0;
  for (const p of paras) {
    const w = p.split(/\s+/).length;
    if (words + w > CHUNK_WORDS && buf.length) {
      chunks.push(buf.join(" "));
      buf = [];
      words = 0;
    }
    buf.push(p);
    words += w;
  }
  if (buf.length) chunks.push(buf.join(" "));
  return chunks;
}

async function fetchAll(type) {
  const items = [];
  for (let page = 1; page < 50; page++) {
    const url = `${SITE}/wp-json/wp/v2/${type}?per_page=100&page=${page}&status=publish&_fields=id,slug,link,title,content,excerpt,modified`;
    const res = await fetch(url, { headers: { "User-Agent": "worksmarto-chatbot-sync" } });
    if (res.status === 400) break; // past last page
    if (!res.ok) throw new Error(`${type} page ${page}: HTTP ${res.status}`);
    const batch = await res.json();
    items.push(...batch);
    const total = +res.headers.get("x-wp-totalpages") || 1;
    if (page >= total) break;
  }
  return items;
}

async function main() {
  const [posts, pages] = await Promise.all([fetchAll("posts"), fetchAll("pages")]);
  const docs = [];
  for (const [kind, list] of [["post", posts], ["page", pages]]) {
    for (const item of list) {
      if (SKIP_SLUGS.has(item.slug)) continue;
      const title = decode(item.title?.rendered || "").trim();
      const text = htmlToText(item.content?.rendered || "");
      const excerpt = htmlToText(item.excerpt?.rendered || "");
      const pieces = chunk(text);
      if (!pieces.length && excerpt) pieces.push(excerpt);
      pieces.forEach((body, i) =>
        docs.push({ id: `${kind}-${item.id}-${i}`, kind, title, url: item.link, text: body })
      );
    }
  }

  // FAQ entries are part of the knowledge too
  try {
    const faq = JSON.parse(await readFile("data/faq.json", "utf8"));
    faq.forEach((f, i) =>
      docs.push({ id: `faq-${i}`, kind: "faq", title: f.q, url: f.url || SITE, text: `${f.q} ${f.a}` })
    );
  } catch {}

  const out = {
    site: SITE,
    generated: new Date().toISOString(),
    counts: { posts: posts.length, pages: pages.length, chunks: docs.length },
    docs,
  };
  await mkdir("data", { recursive: true });
  await writeFile(OUT, JSON.stringify(out));
  console.log(`Wrote ${OUT}: ${posts.length} posts, ${pages.length} pages, ${docs.length} chunks`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
