/**
 * 4KHDHub Provider for Nuvio — Improved Anime Search Edition
 * - يجلب الأسماء البديلة من TMDB
 * - يجرب عدة استعلامات متسلسلة
 * - تطبيع عناوين الأنمي (يحذف Season/Part/OVA)
 * - عتبة أقل للأسماء البديلة
 */

"use strict";

const cheerio = require("cheerio-without-node-native");

const PROVIDER_NAME = "4KHDHub";
const BASE_URL = "https://4khdhub.one";
const TMDB_URL = "https://api.themoviedb.org/3";
const TMDB_KEY = "439c478a771f35c05022f9feabcca01c";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const HEADERS = { "User-Agent": USER_AGENT, "Referer": BASE_URL + "/" };

/* =================== SETTINGS =================== */

function resolveSettings(input) {
  let out = { sortBy: "quality" };
  try {
    let s = input;
    if (!s && typeof globalThis !== "undefined") s = globalThis.SCRAPER_SETTINGS || globalThis.SETTINGS || globalThis.settings;
    if (!s && typeof global !== "undefined") s = global.SCRAPER_SETTINGS || global.SETTINGS || global.settings;
    if (!s && typeof window !== "undefined") s = window.SCRAPER_SETTINGS || window.SETTINGS || window.settings;
    if (s) {
      let v = s.sortBy || s.sort_by || s.sort || "";
      if (typeof v === "object" && v !== null) v = v.value || v.label || "";
      const sv = String(v).toLowerCase();
      out.sortBy = (sv.includes("size") || sv.includes("largest")) ? "size" : "quality";
    }
  } catch (e) { console.error("[" + PROVIDER_NAME + "] settings error", e); }
  return out;
}

function onSettings() {
  return [{
    type: "select", key: "sortBy", name: "sort_by", label: "Sort By",
    options: [{ label: "Quality", value: "quality" }, { label: "Size", value: "size" }],
    default: "quality"
  }];
}

/* =================== HTTP =================== */

async function fetchText(url, referer = BASE_URL) {
  const res = await fetch(url, { headers: Object.assign({}, HEADERS, { Referer: referer + "/" }) });
  if (!res.ok) throw new Error("HTTP " + res.status + ": " + url);
  return res.text();
}

async function fetchJson(url, headers = {}) {
  const res = await fetch(url, { headers: Object.assign({}, HEADERS, { Accept: "application/json" }, headers) });
  if (!res.ok) throw new Error("HTTP " + res.status + ": " + url);
  return res.json();
}

function absoluteUrl(u, base = BASE_URL) {
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;
  try { return new URL(u, base).toString(); } catch (e) { return ""; }
}

/* =================== TEXT UTILS =================== */

function decodeBase64(s) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
  const clean = String(s || "").replace(/=+$/, "");
  let out = "", bs = 0, buf, idx = 0, i = 0;
  while ((buf = clean.charAt(i++))) {
    buf = chars.indexOf(buf);
    if (buf < 0) continue;
    idx = bs % 4 ? idx * 64 + buf : buf;
    bs++;
    if (bs % 4) out += String.fromCharCode(idx >> (-2 * bs & 6) & 0xff);
  }
  return out;
}

function rot13(s) {
  return String(s || "").replace(/[a-zA-Z]/g, c => {
    const n = c.charCodeAt(0) + 13;
    const lim = c <= "Z" ? 90 : 122;
    return String.fromCharCode(n <= lim ? n : n - 26);
  });
}

function decodeEntities(s) {
  if (!s) return "";
  const map = { nbsp: " ", amp: "&", quot: '"', lt: "<", gt: ">", "#038": "&" };
  return s.replace(/&(nbsp|amp|quot|lt|gt|#038);/g, (_, k) => map[k])
          .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n));
}

/** تطبيع أساسي: أحرف صغيرة، إزالة التشكيل، إزالة الرموز */
function normalizeTitle(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\[[^\]]*]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(the|a|an|directors?|cut)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** تطبيع للأنمي: يحذف Season/Part/OVA/Cour/Cour 2/TV/Final */
function normalizeAnimeTitle(s) {
  return normalizeTitle(s)
    .replace(/\b(season|part|cour|ova|ona|special|tv|movie|final|the|edition|version)\b/g, " ")
    .replace(/\b\d+(st|nd|rd|th)\b/g, " ")  // 1st, 2nd, 3rd, 4th
    .replace(/\s+/g, " ")
    .trim();
}

/** تطابق كلمات مع دعم اسم الأنمي البديل */
function titleScore(target, candidate) {
  const tNorm = normalizeTitle(target);
  const cNorm = normalizeTitle(candidate);
  if (!tNorm || !cNorm) return 0;

  // تطابق تام
  if (tNorm === cNorm) return 1.0;

  // احتواء مباشر
  if (cNorm.includes(tNorm)) return 0.9;
  if (tNorm.includes(cNorm)) return 0.85;

  const tWords = tNorm.split(" ").filter(Boolean);
  const cSet = new Set(cNorm.split(" ").filter(Boolean));
  const hits = tWords.filter(w => cSet.has(w)).length;
  let score = hits / tWords.length;

  // محاولة مع تطبيع الأنمي (يخلي "Attack on Titan Final Season" = "Attack on Titan")
  const tA = normalizeAnimeTitle(target);
  const cA = normalizeAnimeTitle(candidate);
  if (tA && cA) {
    if (tA === cA) return Math.max(score, 1.0);
    if (cA.includes(tA) || tA.includes(cA)) return Math.max(score, 0.9);
    const tAw = tA.split(" ").filter(Boolean);
    const cAwSet = new Set(cA.split(" ").filter(Boolean));
    const hitsA = tAw.filter(w => cAwSet.has(w)).length;
    const scoreA = hitsA / tAw.length;
    score = Math.max(score, scoreA);
  }

  return Math.min(score, 1.0);
}

/* =================== QUALITY / SIZE =================== */

function parseQuality(s) {
  const v = String(s || "").toLowerCase();
  if (v.includes("2160") || v.includes("4k")) return "2160p";
  if (v.includes("1080")) return "1080p";
  if (v.includes("720")) return "720p";
  if (v.includes("480")) return "480p";
  return "1080p";
}

function getQualityRank(q) {
  const v = String(q).toLowerCase();
  if (v.includes("2160") || v.includes("4k") || v.includes("uhd")) return 4;
  if (v.includes("1080") || v.includes("fhd")) return 3;
  if (v.includes("720") || v.includes("hd")) return 2;
  if (v.includes("480") || v.includes("sd")) return 1;
  return 0;
}

function parseSize(s) {
  const m = String(s || "").match(/([\d.]+)\s*(GB|MB|KB)/i);
  return m ? m[1] + " " + m[2].toUpperCase() : "N/A";
}

function isDirectVideo(url) {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h.includes("hubcloud") || h.endsWith(".r2.cloudflarestorage.com");
  } catch (e) { return false; }
}

function getInvertedSortTag(n, max = 999999) {
  const safe = Math.max(0, parseInt(n, 10) || 0);
  const inv = Math.max(0, max - safe);
  return inv.toString(2).padStart(20, "0").split("").map(b => b === "1" ? "\ufeff" : "\u200b").join("");
}

/* =================== METADATA (مع أسماء بديلة) =================== */

async function getMetadata(tmdbId, mediaType) {
  const type = (mediaType === "tv" || mediaType === "series") ? "tv" : "movie";
  const url = TMDB_URL + "/" + type + "/" + encodeURIComponent(tmdbId) +
              "?api_key=" + TMDB_KEY + "&language=en-US";
  const data = await fetchJson(url);
  const date = type === "tv" ? data.first_air_date : data.release_date;
  const year = date ? Number(date.slice(0, 4)) : null;
  const title = type === "tv" ? data.name : data.title;
  const originalTitle = type === "tv" ? data.original_name : data.original_title;

  // جلب الأسماء البديلة (مهم جداً للأنمي)
  let altTitles = [];
  try {
    const altUrl = TMDB_URL + "/" + type + "/" + encodeURIComponent(tmdbId) +
                   "/alternative_titles?api_key=" + TMDB_KEY;
    const altData = await fetchJson(altUrl);
    const results = altData.results || altData.titles || [];
    for (const r of results) {
      const t = r.title || r.name;
      if (t && r.iso_3166_1 === "US" || r.iso_3166_1 === "JP" || r.iso_3166_1 === "GB") {
        altTitles.push(t);
      } else if (t) {
        altTitles.push(t);
      }
    }
  } catch (e) { /* تجاهل */ }

  // أيضاً جرب الترجمات (بعضها فيه أسماء بديلة)
  try {
    const trUrl = TMDB_URL + "/" + type + "/" + encodeURIComponent(tmdbId) +
                  "/translations?api_key=" + TMDB_KEY;
    const trData = await fetchJson(trUrl);
    const translations = trData.translations || [];
    for (const tr of translations) {
      const t = tr.data && (tr.data.title || tr.data.name);
      if (t) altTitles.push(t);
    }
  } catch (e) { /* تجاهل */ }

  // بناء قائمة عناوين فريدة
  const titles = [];
  const seen = new Set();
  for (const t of [title, originalTitle].concat(altTitles)) {
    if (!t) continue;
    const k = normalizeTitle(t);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    titles.push(t);
  }

  console.log("[" + PROVIDER_NAME + "] available titles=" + titles.length);
  return { title, originalTitle, titles, year, tmdbId };
}

/* =================== SEARCH =================== */

function pickBestResult($, metadata, isSeries, season) {
  let best = null;
  $(".post-item, article, .item, .post").each((_, el) => {
    const $el = $(el);
    const title = $el.find(".entry-title, h2, h3, .post-title").first().text().trim();
    const category = $el.find(".category, .post-category, .cat-links").text().trim();
    const meta = $el.find(".meta, .entry-meta, .post-meta").text().trim() || $el.text();
    const href = $el.attr("href") || $el.find("a[href]").first().attr("href");

    if (!title || !href) return;
    // فلتر النوع (لكن مرن)
    if (isSeries && category && !/series|tv|anime/i.test(category)) return;
    if (!isSeries && category && !/movies?|film/i.test(category)) return;

    const ym = meta.match(/\b(19|20)\d{2}\b/);
    const year = ym ? Number(ym[0]) : null;

    // احسب أفضل نتيجة بين كل الأسماء
    let score = 0;
    for (const t of metadata.titles) {
      score = Math.max(score, titleScore(t, title));
    }

    if (metadata.year && year === metadata.year) score += 0.35;
    else if (metadata.year && year && Math.abs(year - metadata.year) > 1) score -= 0.5;

    if (isSeries && season) {
      const sm = title.match(/(?:season\s*|s)(\d+)/i);
      if (sm && Number(sm[1]) === Number(season)) score += 0.4;
      else if (sm) score -= 0.6;
    }

    if (!best || score > best.score) {
      best = { url: absoluteUrl(href), score, title };
    }
  });
  return best;
}

async function findPage(metadata, isSeries, season) {
  // بناء قائمة استعلامات مرتبة
  const queries = [];
  const seen = new Set();
  function addQuery(q) {
    const k = String(q || "").trim().toLowerCase();
    if (!k || seen.has(k)) return;
    seen.add(k);
    queries.push(String(q).trim());
  }

  const primary = metadata.title || metadata.originalTitle || "";

  // 1. العنوان + الموسم
  if (isSeries && season) {
    addQuery(primary + " season " + season);
    addQuery(primary + " s" + String(season).padStart(2, "0"));
    addQuery(primary + " " + season);
  } else {
    addQuery(primary + " " + (metadata.year || ""));
  }
  addQuery(primary);

  // 2. الأسماء البديلة
  for (const t of metadata.titles) {
    if (isSeries && season) addQuery(t + " season " + season);
    addQuery(t);
  }

  // 3. بدون سنة (احتياطي)
  if (metadata.year) {
    for (const q of queries.slice()) {
      const cleaned = q.replace(String(metadata.year), "").trim();
      if (cleaned) addQuery(cleaned);
    }
  }

  console.log("[" + PROVIDER_NAME + "] trying " + queries.length + " queries");

  // جرب كل استعلام
  let bestMatch = null;
  for (const q of queries) {
    try {
      const html = await fetchText(BASE_URL + "/?s=" + encodeURIComponent(q));
      const $ = cheerio.load(html);
      const m = pickBestResult($, metadata, isSeries, season);
      if (m && (!bestMatch || m.score > bestMatch.score)) {
        bestMatch = m;
        console.log("[" + PROVIDER_NAME + "] query '" + q + "' → " + m.title + " (score=" + m.score.toFixed(2) + ")");
        if (m.score >= 0.85) break;  // توقف مبكر إذا التطابق قوي
      }
    } catch (e) { /* جرب التالي */ }
  }

  // عتبة مخففة للأنمي (0.5 بدلاً من 0.7)
  if (bestMatch && bestMatch.score >= 0.5) {
    console.log("[" + PROVIDER_NAME + "] selected " + bestMatch.url);
    return bestMatch.url;
  }
  return "";
}

/* =================== STREAM EXTRACTION =================== */

async function decodeRedirect(url) {
  if (/hubcloud|hubdrive/i.test(url)) return url;
  try {
    const html = await fetchText(url);
    let enc = (html.match(/['"]o['"]\s*,\s*['"]([^'"]+)['"]/) || [])[1]
           || (html.match(/'o','([^']+)'/) || [])[1];
    if (!enc) return url;
    const json = JSON.parse(decodeBase64(rot13(decodeBase64(decodeBase64(enc)))));
    return json.o ? decodeBase64(json.o).trim() : url;
  } catch (e) { return url; }
}

async function findHubCloud($el, pageUrl, $) {
  const links = $el.find("a[href]").get();
  for (const a of links) {
    const $a = $(a);
    const href = $a.attr("href");
    const text = $a.text();
    if (!href) continue;
    if (/hubcloud/i.test(text) || /hubcloud/i.test(href)) {
      return await decodeRedirect(absoluteUrl(href, pageUrl));
    }
    if (/hubdrive/i.test(text) || /hubdrive/i.test(href)) {
      const redirect = await decodeRedirect(absoluteUrl(href, pageUrl));
      try {
        const inner = await fetchText(redirect, pageUrl);
        const $inner = cheerio.load(inner);
        const hubLink = $inner("a[href]").filter((_, el) =>
          /hubcloud/i.test($inner(el).text() + " " + ($inner(el).attr("href") || ""))
        ).first().attr("href");
        if (hubLink) return absoluteUrl(hubLink, redirect);
      } catch (e) { /* تجاهل */ }
    }
  }
  return "";
}

async function extractHubCloud(url, meta) {
  try {
    let html = await fetchText(url, url);
    let finalUrl = url;

    const varUrl = (html.match(/var url\s*=\s*['"]([^'"]+)['"]/) || [])[1];
    const hrefLink = cheerio.load(html)("a[href]").attr("href");
    const redirect = varUrl || hrefLink;
    if (redirect) {
      finalUrl = absoluteUrl(redirect, url);
      html = await fetchText(finalUrl, url);
    }

    const $ = cheerio.load(html);
    const header = $("div.card-header").text().replace(/\s+/g, " ").trim()
                || $("title").text().trim()
                || meta.title;
    const size = parseSize($("li").first().text()) !== "N/A"
                 ? parseSize($("li").first().text())
                 : meta.size;
    const quality = parseQuality(header);

    const streams = [];
    $("a[href]").each((_, el) => {
      const h = $(el).attr("href");
      if (!h || !isDirectVideo(h)) return;
      streams.push({ url: h, title: header, quality, size });
    });
    return streams;
  } catch (e) { return []; }
}

async function extractStreams(pageUrl, isSeries, season, episode) {
  const html = await fetchText(pageUrl);
  const $ = cheerio.load(html);
  const candidates = [];

  if (isSeries && season && episode) {
    const sTag = "S" + String(season).padStart(2, "0");
    const eTag = "Episode-" + String(episode).padStart(2, "0");
    $(".episode-item").each((_, el) => {
      const $el = $(el);
      if (!$el.find(".episode-number, .ep-num, .number").text().includes(sTag)) return;
      $el.find(".episode-download-item").each((__, item) => {
        if ($(item).text().includes(eTag)) candidates.push($(item));
      });
    });
  } else {
    $(".download-item, .dl-item, .episode-download-item").each((_, el) => candidates.push($(el)));
  }

  const results = await Promise.all(candidates.map(async ($el) => {
    const text = $el.text().replace(/\s+/g, " ").trim();
    const meta = {
      title: $el.find(".file-title, .title").text().trim() || text,
      quality: parseQuality(text),
      size: parseSize(text)
    };
    const hub = await findHubCloud($el, pageUrl, $);
    return hub ? await extractHubCloud(hub, meta) : [];
  }));

  return results.flat();
}

/* =================== STREAM OBJECT =================== */

function buildStreamObject(mediaTitle, fileTitle, url, quality, size, headers, episodeTag, metadata, sortBy) {
  let decodedUrl = url;
  try { decodedUrl = decodeURIComponent(url || ""); } catch (e) { decodedUrl = url || ""; }

  const cleanTitle = decodeEntities(fileTitle || "").replace(/[\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
  const search = (cleanTitle + " " + decodedUrl).toLowerCase();
  let q = quality;

  const qm = search.match(/\b(2160p|4k|1080p|720p|480p)\b/i);
  if (qm) {
    const t = qm[1].toLowerCase();
    q = (t === "4k" || t === "2160p") ? "2160p" : t;
  }
  if (!q || q === "N/A") q = parseQuality(search);

  const qRank = getQualityRank(q);

  let audio = "Single-Audio";
  if (/\b(multi|multi\-audio)\b/i.test(search)) audio = "Multi-Audio";
  else if (/\b(dual|dual\-audio|dubbed|hindi)\b/i.test(search)) audio = "Dual-Audio";

  let sizeLabel = size && size !== "N/A" ? size : "N/A";
  const sizeMatch = cleanTitle.match(/\[\s*(\d+(?:\.\d+)?\s*[MG]B)\s*\]/i)
                 || cleanTitle.match(/(\d+(?:\.\d+)?\s*[MG]B)/i)
                 || decodedUrl.match(/(\d+(?:\.\d+)?\s*[MG]B)/i);
  if (sizeMatch) sizeLabel = sizeMatch[1].toUpperCase().replace(/\s+/g, "");

  let sizeMB = 0;
  if (sizeLabel !== "N/A") {
    const sm = sizeLabel.match(/([\d.]+)\s*(GB|MB)/i);
    if (sm) {
      const n = parseFloat(sm[1]);
      const unit = sm[2].toUpperCase();
      sizeMB = Math.round(unit.includes("GB") ? n * 1024 : n);
    }
  }

  let sortTag = "";
  if (sortBy === "size") sortTag = getInvertedSortTag(sizeMB, 999999);
  else sortTag = getInvertedSortTag(qRank * 100000 + sizeMB, 999999);

  const name = sortTag + PROVIDER_NAME + " | " + q + " | " + sizeLabel + " | " + audio;
  const mediaT = metadata && metadata.title ? metadata.title : mediaTitle;
  const year = metadata && metadata.year ? metadata.year : "N/A";

  const epLabel = episodeTag && (episodeTag.startsWith("S") || episodeTag.includes("E"))
    ? "🎬 " + mediaT + " - (" + year + ") " + episodeTag.replace(/E0*(\d+)/i, "E$1").replace(/S0*(\d+)/i, "S$1")
    : "🎬 " + mediaT + " (" + year + ")";

  const qIcon = q === "2160p" ? "⚡" : q === "720p" ? "💎" : "🔥";
  const ext = /\.mp4($|\?)/i.test(decodedUrl) || /\.mp4\b/i.test(cleanTitle) ? "MP4" : "MKV";
  const line1 = qIcon + " " + q + " | " + sizeLabel + " | 📼 " + ext;

  const hdr = /\bhdr10\+/i.test(search) ? "HDR10+" : /\bhdr10\b/i.test(search) ? "HDR10" : "HDR";
  const codec = /\b(h\.?265|x265|hevc)\b/i.test(search) ? "H.265" : "H.264";
  const hdrTags = ["🌈 " + hdr, "🎞️ " + codec];
  if (/\b(dolby\s*vision|dovi|\.dv\.)\b/i.test(search) || /[\.\-_]dv[\.\-_]/i.test(search)) hdrTags.push("👁️ DV");
  const line2 = hdrTags.join(" | ");

  const audioCodec = /\btruehd\s*7\.1\b/i.test(search) ? "TrueHD 7.1"
                  : /\bddp5\.1\b/i.test(search) || /\beac3\b/i.test(search) ? "DDP5.1"
                  : "DD5.1";
  const atmos = /\batmos\b/i.test(search) ? " Atmos" : "";
  const line3 = "🔊 " + audio + " | 🎧 " + audioCodec + atmos;

  const source = /\b(bluray|blu\-ray)\b/i.test(search) ? "BluRay" : "WEB-DL";
  const line4 = "📡 " + source;

  const title = [epLabel, line1, line2, line3, line4].join("\n");

  // فلترة نهائية: فقط 2160p و 1080p
  if (!/2160p|1080p/i.test(q)) return null;

  return {
    qualityRank: qRank,
    sizeInMB: sizeMB,
    data: {
      name,
      title,
      size: title,
      description: title,
      url: url || "",
      behaviorHints: {
        notWebReady: true,
        proxyHeaders: { request: headers || { Referer: BASE_URL + "/" } }
      }
    }
  };
}

/* =================== MAIN =================== */

async function getStreams(tmdbId, mediaType, season = null, episode = null, settings = {}) {
  const isSeries = mediaType === "tv" || mediaType === "series";
  if (!tmdbId || (!isSeries && mediaType !== "movie")) return [];

  try {
    const opts = resolveSettings(settings);
    console.log("[" + PROVIDER_NAME + "] tmdb=" + tmdbId + " type=" + mediaType + " S=" + season + " E=" + episode);

    const metadata = await getMetadata(tmdbId, mediaType);
    console.log("[" + PROVIDER_NAME + "] titles=" + metadata.titles.join(" | "));

    const pageUrl = await findPage(metadata, isSeries, season);
    if (!pageUrl) {
      console.log("[" + PROVIDER_NAME + "] no page found");
      return [];
    }
    console.log("[" + PROVIDER_NAME + "] page=" + pageUrl);

    const raw = await extractStreams(pageUrl, isSeries, season, episode);

    let epTag = "";
    if (isSeries) {
      const s = parseInt(season, 10) || 1;
      const e = parseInt(episode, 10) || 1;
      epTag = "S" + (s < 10 ? "0" : "") + s + "E" + (e < 10 ? "0" : "") + e;
    }

    const seen = {};
    const out = [];
    for (const r of raw) {
      if (!isDirectVideo(r.url) || seen[r.url]) continue;
      seen[r.url] = true;
      const fileT = r.title + " [" + r.quality + "] " + r.size;
      const obj = buildStreamObject(
        metadata.title, fileT, r.url, r.quality, r.size,
        { Referer: BASE_URL + "/", "User-Agent": USER_AGENT },
        epTag.toLowerCase(), metadata, opts.sortBy
      );
      if (obj) out.push(obj);
    }

    out.sort((a, b) => {
      if (opts.sortBy === "size") return b.sizeInMB - a.sizeInMB;
      if (b.qualityRank !== a.qualityRank) return b.qualityRank - a.qualityRank;
      return b.sizeInMB - a.sizeInMB;
    });

    console.log("[" + PROVIDER_NAME + "] returning " + out.length + " stream(s)");
    return out.map(o => o.data);
  } catch (e) {
    console.error("[" + PROVIDER_NAME + "] error " + e.message);
    return [];
  }
}

module.exports = { getStreams, onSettings };
