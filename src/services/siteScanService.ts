// ═══════════════════════════════════════════════════════════════════════════
//  siteScanService — scanner controlado da página inicial da loja.
//
//  Limites rígidos:
//  - 1 página apenas (homepage)
//  - Timeout: 10s
//  - Sem download de imagens pesadas (só HTML)
//  - Só acessa a URL configurada no bot_settings — nunca URL externa
//  - Sem loop, sem recursão, sem crawler agressivo
// ═══════════════════════════════════════════════════════════════════════════

const SCAN_TIMEOUT_MS = 10_000;
const MAX_VISIBLE_TEXT = 3_000;
const MAX_HEADINGS = 10;
const MAX_LINKS = 8;

export interface SiteScanResult {
  url:              string;
  title?:           string;
  metaDescription?: string;
  headings:         string[];
  internalLinks:    string[];
  rawSummary:       string;
  extractedFacts:   Record<string, string>;
  scannedAt:        string;
  pagesScanned:     number;
}

// ── Helpers de extração ─────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTitle(html: string): string | undefined {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? stripHtml(m[1]).trim() : undefined;
}

function extractMeta(html: string, name: string): string | undefined {
  const patterns = [
    new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']{1,300})["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']{1,300})["'][^>]+name=["']${name}["']`, 'i'),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return m[1].trim();
  }
  return undefined;
}

function extractHeadings(html: string): string[] {
  const matches = [...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)];
  return matches
    .map(m => stripHtml(m[1]).trim())
    .filter(h => h.length > 1 && h.length < 120)
    .slice(0, MAX_HEADINGS);
}

function extractInternalLinks(html: string, baseUrl: string): string[] {
  let base: URL;
  try { base = new URL(baseUrl); } catch { return []; }

  const matches = [...html.matchAll(/href=["']([^"'#?]{2,200})["']/gi)];
  const links = new Set<string>();
  for (const m of matches) {
    try {
      const url = new URL(m[1], baseUrl);
      if (url.hostname === base.hostname && url.pathname !== '/' && url.pathname !== '') {
        links.add(url.origin + url.pathname);
      }
    } catch { /* ignora href inválido */ }
  }
  return [...links].slice(0, MAX_LINKS);
}

// ── Scanner principal ────────────────────────────────────────────────────────

export async function scanSite(siteUrl: string): Promise<SiteScanResult> {
  // Valida URL antes de fazer qualquer request
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(siteUrl);
  } catch {
    throw new Error(`URL inválida: ${siteUrl}`);
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('Apenas URLs http/https são permitidas.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SCAN_TIMEOUT_MS);

  let html = '';
  try {
    const res = await fetch(siteUrl, {
      signal:  controller.signal,
      headers: {
        'User-Agent': 'FluxoBot/1.0 (site-scanner; single-page; no-crawl)',
        'Accept':     'text/html',
      },
    });
    if (!res.ok) throw new Error(`Servidor retornou HTTP ${res.status}`);
    html = await res.text();
  } finally {
    clearTimeout(timer);
  }

  const title           = extractTitle(html);
  const metaDescription = extractMeta(html, 'description');
  const headings        = extractHeadings(html);
  const internalLinks   = extractInternalLinks(html, siteUrl);
  const visibleText     = stripHtml(html).slice(0, MAX_VISIBLE_TEXT);

  const rawSummary = [
    title           ? `Título: ${title}`                : '',
    metaDescription ? `Descrição: ${metaDescription}`   : '',
    headings.length ? `Seções: ${headings.join(' | ')}`  : '',
    visibleText     ? `Conteúdo: ${visibleText.slice(0, 1000)}` : '',
  ].filter(Boolean).join('\n');

  const extractedFacts: Record<string, string> = { url: siteUrl };
  if (title)           extractedFacts.title           = title;
  if (metaDescription) extractedFacts.metaDescription = metaDescription;
  if (headings.length) extractedFacts.sections        = headings.join(', ');
  if (internalLinks.length) extractedFacts.links      = internalLinks.join(', ');

  return {
    url:            siteUrl,
    title,
    metaDescription,
    headings,
    internalLinks,
    rawSummary,
    extractedFacts,
    scannedAt:      new Date().toISOString(),
    pagesScanned:   1,
  };
}
