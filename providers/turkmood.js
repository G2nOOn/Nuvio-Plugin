/**
 * TurkMood provider for Nuvio — STRICT 1080p ONLY
 * Version: 1.0.0
 *
 * Flow:
 *   /show/                → find series
 *   /{slug}-الحلقة-N/     → get /see/ URL
 *   /{slug}-الحلقة-N/see/ → iframe srcs (cdnplus.org, vdesk.live, mp4plus)
 *   cdnplus iframe        → cdnplus.space page with master.m3u8
 *   master.m3u8           → x = 1080p variant
 */

"use strict";

var cheerio = require("cheerio-without-node-native");

var VERSION = "1.0.0";
var TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
var TMDB_API_BASE = "https://api.themoviedb.org/3";
var TMDB_BASE = "https://www.themoviedb.org";
var SITE_BASE = "https://krmz.onl";
var UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
var MAX_SERIES_PAGES = 8;
var MAX_PROBES = 4;

var seasonBoundariesCache = {};

function log(key, value) {
  var s = value === undefined || value === null || value === "" ? "" : " " + String(value);
  console.log("[TurkMood v" + VERSION + "] " + key + s);
}
function logFailure(reason, detail) {
  console.log("[TurkMood v" + VERSION + "] failure=" + reason + (detail ? " detail=" + detail : ""));
}
function errMsg(e) { return e && e.message ? e.message : String(e || "unknown"); }

function originOf(url) {
  var m = String(url || "").match(/^(https?:\/\/[^\/]+)/i);
  return m ? m[1] : "";
}

function decodeHtml(v) {
  return String(v || "")
    .replace(/&amp;/gi, "&").replace(/&#0*38;/gi, "&")
    .replace(/&quot;/gi, "\"").replace(/&#0*39;|'/gi, "'")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&#x([0-9a-f]+);/gi, function (_, h) { return String.fromCharCode(parseInt(h, 16)); })
    .replace(/&#([0-9]+);/g, function (_, d) { return String.fromCharCode(parseInt(d, 10)); });
}

function cleanUrl(v) {
  return decodeHtml(v).replace(/\\u0026/gi, "&").replace(/\\u003d/gi, "=").replace(/\\\//g, "/").trim();
}

function absUrl(v, base) {
  var url = cleanUrl(v);
  if (!url || /^javascript:/i.test(url) || url.charAt(0) === "#") return "";
  if (url.indexOf("//") === 0) return "https:" + url;
  if (/^https?:\/\//i.test(url)) return url;
  var origin = originOf(base || SITE_BASE);
  if (url.charAt(0) === "/") return origin + url;
  var b = String(base || SITE_BASE).split("#")[0].split("?")[0];
  if (b.charAt(b.length - 1) !== "/") b = b.substring(0, b.lastIndexOf("/") + 1);
  return b + url;
}

function urlKey(url) {
  var v = String(url || "").split("#")[0].split("?")[0].replace(/\/+$/, "");
  try { v = decodeURIComponent(v); } catch (_) {}
  return v.toLowerCase();
}

function headers(referer, origin, accept) {
  var h = {
    "User-Agent": UA,
    "Accept": accept || "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ar,en-US;q=0.8,en;q=0.7,tr;q=0.6"
  };
  if (referer) h.Referer = referer;
  if (origin) h.Origin = origin;
  return h;
}

function isChallenge(html) {
  var t = String(html || "").toLowerCase();
  return t.indexOf("cf-chl-") >= 0 || t.indexOf("challenge-platform") >= 0 ||
    t.indexOf("just a moment") >= 0 || t.indexOf("checking your browser") >= 0;
}

function fetchText(url, referer, origin, accept) {
  return fetch(url, { headers: headers(referer, origin, accept), skipSizeCheck: true })
    .then(function (res) {
      if (!res) throw new Error("http_no_response " + url);
      return res.text().then(function (body) {
        if (isChallenge(body)) throw new Error("cloudflare_challenge " + url);
        if (!res.ok) throw new Error("http_" + res.status + " " + url);
        return { html: String(body || ""), url: res.url || url, status: res.status };
      });
    });
}

function fetchJson(url, referer, origin) {
  return fetchText(url, referer, origin, "application/json,text/plain,*/*").then(function (r) {
    try { return JSON.parse(r.html); } catch (_) { throw new Error("invalid_json " + url); }
  });
}

function wrap($, el) { return el && typeof el.attr === "function" ? el : $(el); }

function normalize(v) {
  return decodeHtml(v).toLowerCase()
    .replace(/[إأآٱا]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
    .replace(/[ؤئ]/g, "ء").replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[ـ\u200B-\u200D\uFEFF]/g, "")
    .replace(/[ıİ]/g, "i").replace(/[şŞ]/g, "s").replace(/[ğĞ]/g, "g")
    .replace(/[üÜ]/g, "u").replace(/[öÖ]/g, "o").replace(/[çÇ]/g, "c")
    .replace(/[^a-z0-9\u0600-\u06FF]+/gi, " ").replace(/\s+/g, " ").trim();
}

function compactTitle(v) {
  return normalize(v)
    .replace(/(^|\s)(مسلسل|المسلسل|series|tv|show|مترجم|مترجمه|كامل|كامله|قرمزي|krmzi|turkmood)(?=\s|$)/g, " ")
    .replace(/\s+\d{4}\s*$/, "").replace(/\s+/g, " ").trim();
}

function cleanTmdbTitle(v) {
  return decodeHtml(v)
    .replace(/\s*\(TV Series\s+\d{4}[^)]*\).*$/i, "")
    .replace(/\s*\(\d{4}\)\s*$/, "")
    .replace(/\s*[-—]\s*The Movie Database.*$/i, "")
    .replace(/\s*\|\s*TMDB.*$/i, "")
    .replace(/\s+/g, " ").trim();
}

function addTitle(list, seen, v) {
  var c = cleanTmdbTitle(v);
  if (!c || compactTitle(c).length < 2) return;
  var k = normalize(c);
  if (!seen[k]) { seen[k] = true; list.push(c); }
  var w = c.replace(/^(?:[A-Z]{1,3}\s+){1,4}/, "").trim();
  var dk = normalize(w);
  if (w && dk.length >= 2 && !seen[dk]) { seen[dk] = true; list.push(w); }
}

function contains(h, n) {
  if (!h || !n || n.length < 3) return false;
  return (" " + h + " ").indexOf(" " + n + " ") >= 0;
}

function matchScore(field, titles) {
  var nf = normalize(field), cf = compactTitle(field);
  if (!nf) return 0;
  var best = 0;
  for (var i = 0; i < titles.length; i++) {
    var t = compactTitle(titles[i]);
    if (!t || t.length < 2) continue;
    if (cf === t) best = Math.max(best, 120);
    else if (nf === normalize(titles[i])) best = Math.max(best, 115);
    else if (contains(nf, t)) best = Math.max(best, 80);
  }
  return best;
}

function episodeNumber(v) {
  var t = decodeHtml(v);
  var m = t.match(/(?:الحلقة|الحلقه|حلقة|حلقه)\s*[:\-]?\s*(\d{1,4})/i);
  if (!m) m = t.match(/\bS\d{1,2}E(\d{1,4})\b/i);
  if (!m) m = t.match(/\bep(?:isode)?[\s._-]*(\d{1,4})\b/i);
  if (!m) m = t.match(/[-_\/]e(\d{1,4})(?:[\/?._-]|$)/i);
  return m ? parseInt(m[1], 10) : NaN;
}

function seasonFromText(t) {
  var v = String(t || "");
  if (!v) return NaN;
  var ord = { "الاول": 1, "الأول": 1, "الثاني": 2, "الثالث": 3, "الرابع": 4, "الخامس": 5, "السادس": 6, "السابع": 7, "الثامن": 8, "التاسع": 9, "العاشر": 10 };
  var m = v.match(/(?:الجزء|الموسم|موسم)\s+(الأول|الاول|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر)/i);
  if (m) { if (ord[m[1]]) return ord[m[1]]; var n = m[1].replace(/أ/g, "ا"); if (ord[n]) return ord[n]; }
  m = v.match(/(?:الجزء|الموسم|موسم)\s*[:\-]?\s*(\d{1,2})/i);
  if (m) return parseInt(m[1], 10);
  m = v.match(/(?:season|part)\s*[:\-]?\s*(\d{1,2})/i);
  if (m) return parseInt(m[1], 10);
  m = v.match(/\bS(\d{1,2})(?![\dEe])/i);
  if (m) return parseInt(m[1], 10);
  return NaN;
}

// ====== TMDB ======
function getTmdbBoundaries(tmdbId) {
  var ck = String(tmdbId);
  if (seasonBoundariesCache[ck]) return Promise.resolve(seasonBoundariesCache[ck]);
  var showUrl = TMDB_API_BASE + "/tv/" + encodeURIComponent(tmdbId) + "?api_key=" + TMDB_API_KEY + "&language=en-US";
  return fetchJson(showUrl, "", "").then(function (show) {
    var seasons = (show && show.seasons) || [];
    seasons = seasons.filter(function (s) { return s && typeof s.season_number === "number" && s.season_number > 0; });
    seasons.sort(function (a, b) { return a.season_number - b.season_number; });
    if (!seasons.length) return [];
    var jobs = [];
    for (var i = 0; i < seasons.length; i++) {
      (function (sn) {
        var url = TMDB_API_BASE + "/tv/" + encodeURIComponent(tmdbId) + "/season/" + sn + "?api_key=" + TMDB_API_KEY + "&language=en-US";
        jobs.push(fetchJson(url, "", "").then(function (d) { return d && d.episodes ? d.episodes.length : 0; }).catch(function () { return 0; }));
      })(seasons[i].season_number);
    }
    return Promise.all(jobs).then(function (counts) {
      var b = [], cum = 0;
      for (var j = 0; j < counts.length; j++) { cum += counts[j]; b.push(cum); }
      log("tmdb_boundaries", b.join(","));
      seasonBoundariesCache[ck] = b;
      return b;
    });
  }).catch(function (e) { logFailure("tmdb_boundaries_failed", errMsg(e)); return []; });
}

function siteEpisodeNumber(ws, we, boundaries) {
  if (ws <= 1) return we;
  var off = 0;
  if (boundaries.length >= ws - 1) { for (var i = 0; i < ws - 1; i++) off += boundaries[i]; }
  else if (boundaries.length > 0) { for (var j = 0; j < boundaries.length; j++) off += boundaries[j]; off += (ws - 1 - boundaries.length) * 13; }
  else { off = (ws - 1) * 13; }
  return off + we;
}

function parseTmdbPage(html) {
  var $ = cheerio.load(html);
  var pt = $("title").first().text() || "";
  var title = cleanTmdbTitle(
    $('meta[property="og:title"]').attr("content") || $("section.inner_content h2 a").first().text() || $("h2 a").first().text() || pt
  );
  var ym = pt.match(/(?:TV Series\s+|\()(\d{4})/i);
  return { title: title, year: ym ? parseInt(ym[1], 10) : 0 };
}

function parseTmdbAltTitles(html) {
  var $ = cheerio.load(html), titles = [];
  $("table.titles tbody tr").each(function (_, el) {
    var row = wrap($, el), cells = row.find("td"), v = cells.first().text();
    if (v) titles.push(v.replace(/\s+/g, " ").trim());
  });
  return titles;
}

function getTmdbMetadata(tmdbId) {
  var langs = ["tr-TR", "en-US", "ar-SA"], jobs = [];
  for (var i = 0; i < langs.length; i++) {
    jobs.push(fetchText(TMDB_BASE + "/tv/" + encodeURIComponent(tmdbId) + "?language=" + langs[i], "", "")
      .then(function (r) { return parseTmdbPage(r.html); }).catch(function () { return { title: "", year: 0 }; }));
  }
  var aliasesJob = fetchText(TMDB_BASE + "/tv/" + encodeURIComponent(tmdbId) + "/titles?language=en-US", "", "")
    .then(function (r) { return parseTmdbAltTitles(r.html); }).catch(function () { return []; });
  return Promise.all([Promise.all(jobs), aliasesJob]).then(function (parts) {
    var pages = parts[0] || [], aliases = parts[1] || [], titles = [], seen = {}, year = 0;
    for (var p = 0; p < pages.length; p++) { addTitle(titles, seen, pages[p].title); if (!year && pages[p].year) year = pages[p].year; }
    for (var a = 0; a < aliases.length && titles.length < 50; a++) addTitle(titles, seen, aliases[a]);
    return { titles: titles, year: year };
  });
}

// ====== SEARCH SERIES ======
function fetchShowPage(pageNum) {
  var url = SITE_BASE + "/show/" + (pageNum > 1 ? "?paged=" + pageNum : "");
  return fetchText(url, SITE_BASE + "/", "").then(function (r) {
    var $ = cheerio.load(r.html);
    var cards = [], seen = {};
    $('a[href*="/series/"]').each(function (_, el) {
      var a = wrap($, el);
      var u = absUrl(a.attr("href"), r.url);
      if (!u || seen[urlKey(u)]) return;
      var title = a.attr("title") || a.text() || "";
      var img = a.find("img").first();
      var alt = img.attr("alt") || "";
      seen[urlKey(u)] = true;
      cards.push({ url: u, title: title.trim(), combined: title + " " + alt });
    });
    return { cards: cards, url: r.url };
  });
}

function findSeries(metadata) {
  var results = [], seen = {};
  function tryPage(pageNum) {
    if (pageNum > MAX_SERIES_PAGES) {
      results.sort(function (a, b) { return b.score - a.score; });
      log("series_candidates", results.length);
      return results.length ? results[0] : null;
    }
    return fetchShowPage(pageNum).then(function (r) {
      var matched = 0;
      for (var i = 0; i < r.cards.length; i++) {
        var c = r.cards[i];
        var score = matchScore(c.combined, metadata.titles);
        if (score >= 100 && !seen[urlKey(c.url)]) {
          seen[urlKey(c.url)] = true;
          results.push({ url: c.url, title: c.title, score: score });
          matched++;
        }
      }
      log("page_" + pageNum + "_matches", matched);
      if (results.length > 0 && pageNum >= 3) {
        results.sort(function (a, b) { return b.score - a.score; });
        return results[0];
      }
      return tryPage(pageNum + 1);
    }).catch(function (e) {
      logFailure("show_page_failed", "page=" + pageNum + " " + errMsg(e));
      return tryPage(pageNum + 1);
    });
  }
  return tryPage(1);
}

// ====== FIND EPISODE URL ======
function findEpisodeUrl(series, siteEp) {
  return fetchText(series.url, SITE_BASE + "/", "").then(function (r) {
    var $ = cheerio.load(r.html);
    var candidates = [], seen = {};
    $('a[href*="الحلقة"], a[href*="-الحلقة-"]').each(function (_, el) {
      var a = wrap($, el);
      var u = absUrl(a.attr("href"), r.url);
      if (!u || seen[urlKey(u)]) return;
      if (u.indexOf("/see/") >= 0) return;
      var text = (a.text() || "") + " " + (a.attr("title") || "");
      var epNum = episodeNumber(text);
      if (!isNaN(epNum) && epNum === siteEp) {
        seen[urlKey(u)] = true;
        candidates.push({ url: u, text: text.trim(), epNum: epNum });
      }
    });
    log("episode_candidates_from_series", candidates.length);
    if (candidates.length > 0) return candidates[0];
    var slugMatch = series.url.match(/\/series\/([^\/]+)\/?$/);
    if (slugMatch) {
      var baseSlug = decodeURIComponent(slugMatch[1]).replace(/^مسلسل-/, "");
      var guess = SITE_BASE + "/" + encodeURIComponent(baseSlug + "-الحلقة-" + siteEp) + "/";
      log("episode_url_guess", guess);
      return { url: guess, text: "guess", epNum: siteEp };
    }
    return null;
  }).catch(function (e) {
    logFailure("series_page_failed", errMsg(e));
    return null;
  });
}

// ====== EXTRACT /see/ URL ======
function extractSeeUrl(episodeUrl) {
  return fetchText(episodeUrl, SITE_BASE + "/", "").then(function (r) {
    var $ = cheerio.load(r.html);
    var seeUrl = "";
    $('a[href*="/see/"]').each(function (_, el) {
      if (seeUrl) return;
      var u = absUrl($(el).attr("href"), r.url);
      if (u) seeUrl = u;
    });
    if (!seeUrl) seeUrl = episodeUrl.replace(/\/$/, "") + "/see/";
    var heading = [$("h1").first().text(), $("title").first().text()].join(" ");
    log("episode_heading", heading.slice(0, 80));
    return { seeUrl: seeUrl, episodeUrl: r.url, html: r.html };
  }).catch(function (e) {
    logFailure("episode_page_failed", errMsg(e));
    return null;
  });
}

// ====== EXTRACT IFRAMES FROM /see/ PAGE ======
function extractIframes(seeUrl, episodeUrl) {
  return fetchText(seeUrl, episodeUrl, originOf(episodeUrl)).then(function (r) {
    var $ = cheerio.load(r.html);
    var iframes = [], seen = {};

    $("iframe[src]").each(function (_, el) {
      var u = absUrl($(el).attr("src"), r.url);
      if (!u || seen[urlKey(u)]) return;
      seen[urlKey(u)] = true;
      iframes.push({ url: u, label: "iframe" });
    });

    if (!iframes.length) {
      var html = r.html;
      var patterns = [
        /https?:\/\/[^"'\\\s<>]*vdesk[^"'\\\s<>]*/gi,
        /https?:\/\/[^"'\\\s<>]*cdnplus[^"'\\\s<>]*/gi,
        /https?:\/\/[^"'\\\s<>]*mp4plus[^"'\\\s<>]*/gi
      ];
      for (var p = 0; p < patterns.length; p++) {
        var m;
        while ((m = patterns[p].exec(html)) !== null) {
          var u2 = cleanUrl(m[0]);
          if (seen[urlKey(u2)]) continue;
          seen[urlKey(u2)] = true;
          iframes.push({ url: u2, label: "player" });
        }
      }
    }

    log("iframes_found", iframes.length);
    return { iframes: iframes, html: r.html, url: r.url };
  }).catch(function (e) {
    logFailure("see_page_failed", errMsg(e));
    return null;
  });
}

// ====== EXTRACT MASTER M3U8 FROM PLAYER PAGE ======
function extractMasterUrl(playerUrl, referer) {
  return fetchText(playerUrl, referer, "").then(function (r) {
    var html = r.html;
    var masterUrls = [];
    var m;

    var re = /https?:\/\/[^"'\\\s<>]+?\.urlset\/master\.m3u8(?:\?[^"'\\\s<>]*)?/gi;
    while ((m = re.exec(html)) !== null) {
      var u = cleanUrl(m[0]);
      if (masterUrls.indexOf(u) < 0) masterUrls.push(u);
    }

    if (!masterUrls.length) {
      var re2 = /https?:\/\/[^"'\\\s<>]+?brqz\.online[^"'\\\s<>]*/gi;
      while ((m = re2.exec(html)) !== null) {
        var u2 = cleanUrl(m[0]);
        if (u2.indexOf(".m3u8") >= 0 && masterUrls.indexOf(u2) < 0) masterUrls.push(u2);
      }
    }

    if (!masterUrls.length) {
      var re3 = /https?:\/\/[^"'\\\s<>]+?master\.m3u8(?:\?[^"'\\\s<>]*)?/gi;
      while ((m = re3.exec(html)) !== null) {
        var u3 = cleanUrl(m[0]);
        if (masterUrls.indexOf(u3) < 0) masterUrls.push(u3);
      }
    }

    log("masters_found", masterUrls.length);
    return { masterUrls: masterUrls, playerUrl: r.url, html: html };
  }).catch(function (e) {
    logFailure("player_fetch_failed", playerUrl + " " + errMsg(e));
    return { masterUrls: [], playerUrl: playerUrl, html: "" };
  });
}

// ====== PARSE ENCODED MASTER ======
function variantsFromEncodedMaster(masterUrl) {
  var value = String(masterUrl || "");
  var match = value.match(/^(https?:\/\/.+\/)([a-zA-Z0-9]+)_((?:,[a-z0-9]+)+),?\.urlset\/master\.m3u8(\?[^#]*)?$/i);
  if (!match) return [];

  var qualities = { l: "360p", n: "480p", h: "720p", x: "1080p" };
  var codes = match[3].split(",").filter(function (c) { return c.length > 0; });
  var variants = [];
  var seen = {};

  for (var i = 0; i < codes.length; i++) {
    var code = String(codes[i] || "").toLowerCase();
    if (code !== "x") continue;
    if (!qualities[code] || seen[code]) continue;
    seen[code] = true;
    variants.push({
      url: match[1] + match[2] + "_" + code + "/index-v1-a1.m3u8" + (match[4] || ""),
      quality: qualities[code]
    });
  }
  return variants;
}

// ====== RESOLVE PLAYER ======
function resolvePlayer(iframe, seeUrl, episodeUrl) {
  return extractMasterUrl(iframe.url, seeUrl).then(function (r) {
    var streams = [];
    for (var i = 0; i < r.masterUrls.length; i++) {
      var variants = variantsFromEncodedMaster(r.masterUrls[i]);
      for (var j = 0; j < variants.length; j++) {
        streams.push({
          url: variants[j].url,
          quality: variants[j].quality,
          referer: "https://cdnplus.space/",
          label: iframe.label
        });
      }
    }
    log("player_resolved", iframe.label + " → " + streams.length);
    return streams;
  });
}

// ====== QUALITY ======
function qualityRank(q) {
  var r = { "4K": 7000, "1080p": 6000, "720p": 5000, "576p": 4000, "480p": 3000, "360p": 2000, "320p": 1000 };
  return r[q] || 0;
}

// ====== STREAM OBJECT ======
function streamObject(url, quality, serverName) {
  var q = quality || "1080p";
  var label = String(serverName || "Server").replace(/\s+/g, " ").trim();
  var h = {
    "User-Agent": UA,
    "Referer": "https://cdnplus.space/",
    "Origin": "https://cdnplus.space"
  };
  return {
    name: "TurkMood",
    title: "TurkMood • " + label + " • " + q,
    url: url,
    provider: "TurkMood",
    language: "🇮🇶",
    quality: q,
    type: "m3u8",
    headers: h
  };
}

function sortStreams(streams) {
  return (streams || []).sort(function (a, b) {
    var d = qualityRank(b.quality || "") - qualityRank(a.quality || "");
    if (d) return d;
    return String(a.title || "").localeCompare(String(b.title || ""));
  });
}

// ====== MAIN ======
function getStreams(tmdbId, mediaType, season, episode) {
  var type = String(mediaType || "").toLowerCase();
  var ws = parseInt(season, 10);
  var we = parseInt(episode, 10);
  var id = String(tmdbId || "").trim();

  if (type !== "tv" && type !== "series" && type !== "show") return Promise.resolve([]);
  if (!/^\d+$/.test(id) || !ws || !we || ws < 1 || we < 1) {
    logFailure("invalid_request");
    return Promise.resolve([]);
  }

  log("tmdb_id", id);
  log("request", "S" + ws + "E" + we);

  var ctx = { metadata: null, series: null, siteEp: 0, episodeUrl: null, seeUrl: null, iframes: null };

  return getTmdbMetadata(id)
    .then(function (meta) {
      ctx.metadata = meta;
      log("titles", meta.titles.join(" | "));
      if (!meta.titles.length) { logFailure("no_titles"); return null; }
      return getTmdbBoundaries(id).then(function (b) {
        ctx.siteEp = siteEpisodeNumber(ws, we, b);
        log("site_episode", "S" + ws + "E" + we + " → " + ctx.siteEp);
        return findSeries(meta);
      });
    })
    .then(function (series) {
      if (!series) { logFailure("series_not_found"); return null; }
      ctx.series = series;
      log("matched_series", series.url);
      return findEpisodeUrl(series, ctx.siteEp);
    })
    .then(function (ep) {
      if (!ep) { logFailure("episode_not_found"); return null; }
      ctx.episodeUrl = ep.url;
      log("episode_url", ep.url);
      return extractSeeUrl(ep.url);
    })
    .then(function (see) {
      if (!see) return null;
      ctx.seeUrl = see.seeUrl;
      log("see_url", see.seeUrl);
      return extractIframes(see.seeUrl, see.episodeUrl);
    })
    .then(function (fr) {
      if (!fr || !fr.iframes.length) { logFailure("no_iframes"); return []; }
      ctx.iframes = fr.iframes;
      var jobs = [];
      for (var i = 0; i < fr.iframes.length && i < MAX_PROBES; i++) {
        jobs.push(resolvePlayer(fr.iframes[i], ctx.seeUrl, ctx.episodeUrl));
      }
      return Promise.all(jobs).then(function (lists) {
        var flat = [];
        var seen = {};
        for (var k = 0; k < lists.length; k++) {
          for (var j = 0; j < lists[k].length; j++) {
            var item = lists[k][j];
            if (seen[item.url]) continue;
            seen[item.url] = true;
            flat.push(streamObject(item.url, item.quality, item.label));
          }
        }
        return flat;
      });
    })
    .then(function (streams) {
      var filtered = (streams || []).filter(function (s) { return (s.quality || "") === "1080p"; });
      var sorted = sortStreams(filtered);
      if (!sorted.length) logFailure("no_1080p_sources");
      log("streams_found", sorted.length);
      return sorted;
    })
    .catch(function (e) {
      var m = errMsg(e);
      if (m.indexOf("cloudflare_challenge") === 0) logFailure("cloudflare_challenge");
      else logFailure("fatal", m);
      return [];
    });
}

module.exports = { getStreams: getStreams };
