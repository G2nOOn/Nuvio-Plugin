/**
 * Krmizi / Qrmzi provider for Nuvio
 * Version: 0.21.1
 *
 * Accuracy-first flow:
 * TMDB localized + alternative titles -> parallel source searches -> verified
 * series page -> exact episode inside that page -> page-owned player ->
 * AlbaPlayer servers for that episode only -> public HLS/MP4 sources.
 * Search Krmizi, ShoofLive and Qisat independently; combine every source result.
 * Arabic translation is required: only Arabic-tagged streams are returned, and
 * the original-Turkish catalogs NOW, DDizi and TVDiziler are not registered.
 *
 * 1080p ONLY: only streams whose detected quality is exactly "1080p" are
 * returned. Every other resolution is discarded. The language tag on each
 */

"use strict";

var cheerio = require("cheerio-without-node-native");

var VERSION = "0.21.1";
var TARGET_QUALITY = "1080p";
var TMDB_BASE = "https://www.themoviedb.org";
var SOURCES = [
  { name: "Krmizi", bases: ["https://qrmizitv.com", "https://krmzitv.com", "https://www.qrmzi.tv", "https://w3.qrmzi.cyou", "https://v2.qrmzi.website"], index: "/all-turkish-series/" },
  { name: "ShoofLive", bases: ["https://s5.shooflive.cyou", "https://s2.shooflive.cyou", "https://s6.shooflive.cyou", "https://shooflive.net"], index: "/turkish-series/" },
  { name: "Qisat", bases: ["https://www.qisat.tv", "https://v2.qisat.sbs", "https://v1.qisat.sbs"], index: "/turkish-series/" }
];
var SITE_BASES = SOURCES[0].bases;
var MAX_INDEX_PAGES = 6;
var UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
var MAX_SERIES_PROBES = 6;
var MAX_SERVERS = 8;

function log(key, value) {
  var suffix = value === undefined || value === null || value === "" ? "" : " " + String(value);
  console.log("[Krmizi v" + VERSION + "] " + key + suffix);
}

function logFailure(reason, detail) {
  var suffix = detail ? " detail=" + String(detail) : "";
  console.log("[Krmizi v" + VERSION + "] failure=" + reason + suffix);
}

function errorMessage(error) {
  return error && error.message ? error.message : String(error || "unknown_error");
}

function originOf(url) {
  var match = String(url || "").match(/^(https?:\/\/[^\/]+)/i);
  return match ? match[1] : "";
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&#0*38;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x([0-9a-f]+);/gi, function (_, hex) {
      return String.fromCharCode(parseInt(hex, 16));
    })
    .replace(/&#([0-9]+);/g, function (_, decimal) {
      return String.fromCharCode(parseInt(decimal, 10));
    });
}

function cleanUrlValue(value) {
  return decodeHtml(value)
    .replace(/\\u0026/gi, "&")
    .replace(/\\u003d/gi, "=")
    .replace(/\\\//g, "/")
    .trim();
}

function absUrl(value, base) {
  var url = cleanUrlValue(value);
  if (!url || /^javascript:/i.test(url) || url.charAt(0) === "#") return "";
  if (url.indexOf("//") === 0) return "https:" + url;
  if (/^https?:\/\//i.test(url)) return url;

  var origin = originOf(base || SITE_BASES[0]);
  if (url.charAt(0) === "/") return origin + url;

  var cleanBase = String(base || SITE_BASES[0]).split("#")[0].split("?")[0];
  if (cleanBase.charAt(cleanBase.length - 1) !== "/") {
    cleanBase = cleanBase.substring(0, cleanBase.lastIndexOf("/") + 1);
  }
  var combined = cleanBase + url;
  var prefix = originOf(combined);
  var parts = combined.substring(prefix.length).split("/");
  var resolved = [];
  for (var i = 0; i < parts.length; i++) {
    if (parts[i] === "..") resolved.pop();
    else if (parts[i] !== ".") resolved.push(parts[i]);
  }
  return prefix + resolved.join("/");
}

function urlKey(url) {
  var value = String(url || "").split("#")[0].split("?")[0].replace(/\/+$/, "");
  try {
    value = decodeURIComponent(value);
  } catch (_) {}
  return value.toLowerCase();
}

function pathKey(url) {
  var match = urlKey(url).match(/^https?:\/\/[^\/]+(\/.*)$/i);
  return match ? match[1] : "";
}

function requestHeaders(referer, origin, accept) {
  var headers = {
    "User-Agent": UA,
    "Accept": accept || "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ar,en-US;q=0.8,en;q=0.7,tr;q=0.6"
  };
  if (referer) headers.Referer = referer;
  if (origin) headers.Origin = origin;
  return headers;
}

function isChallenge(html) {
  var text = String(html || "").toLowerCase()
    .replace(/\/cdn-cgi\/challenge-platform\/scripts\/jsd\/main\.js/g, "");
  return text.indexOf("cf-chl-") >= 0 ||
    text.indexOf("challenge-platform") >= 0 ||
    text.indexOf("just a moment") >= 0 ||
    text.indexOf("checking your browser") >= 0 ||
    text.indexOf("cloudflare ray id") >= 0;
}

function withDeadline(promise, ms, errorMessage) {
  var work = Promise.resolve(promise);
  if (typeof setTimeout !== "function" || typeof clearTimeout !== "function") return work;
  return new Promise(function (resolve, reject) {
    var settled = false;
    var elapsed = 0, timer;
    function tick() {
      var delay = Math.min(250, Math.max(1, ms - elapsed));
      timer = setTimeout(function () {
        if (settled) return;
        elapsed += delay;
        if (elapsed < ms) { tick(); return; }
        settled = true;
        clearTimeout(timer);
        reject(new Error(errorMessage || "request_timeout"));
      }, delay);
    }
    tick();
    work.then(function (value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    }, function (error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
  });
}

function fetchTextInfo(url, referer, origin, accept) {
  var work = Promise.resolve().then(function () {
    return fetch(url, {
      headers: requestHeaders(referer, origin, accept),
      skipSizeCheck: true
    });
  }).then(function (response) {
    if (!response) throw new Error("http_no_response " + url);
    return response.text().then(function (body) {
      if (isChallenge(body)) throw new Error("cloudflare_challenge " + url);
      if (!response.ok) throw new Error("http_" + response.status + " " + url);
      return {
        html: String(body || ""),
        url: response.url || url,
        status: response.status
      };
    });
  });
  return withDeadline(work, 6000, "http_timeout " + url);
}

function fetchJson(url, referer, origin) {
  return fetchTextInfo(url, referer, origin, "application/json,text/plain,*/*")
    .then(function (result) {
      try {
        return JSON.parse(result.html);
      } catch (_) {
        throw new Error("invalid_json " + url);
      }
    });
}

function wrap($, element) {
  if (element && typeof element.attr === "function") return element;
  return $(element);
}

function normalize(value) {
  return decodeHtml(value)
    .replace(/İ/g, "I")
    .toLowerCase()
    .replace(/[إأآٱا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[ؤئ]/g, "ء")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[ـ\u200B-\u200D\uFEFF]/g, "")
    .replace(/[\u060C\u061B\u061F\u066A-\u066D\u06D4]/g, " ")
    .replace(/[ıİ]/g, "i")
    .replace(/[şŞ]/g, "s")
    .replace(/[ğĞ]/g, "g")
    .replace(/[üÜ]/g, "u")
    .replace(/[öÖ]/g, "o")
    .replace(/[çÇ]/g, "c")
    .replace(/[^a-z0-9\u0600-\u06FF]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactTitle(value) {
  return normalize(value)
    .replace(/(^|\s)(مسلسل|المسلسل|series|tv|show|مترجم|مترجمه|كامل|كامله|قرمزي|qrmzi|krmizi)(?=\s|$)/g, " ")
    .replace(/\s+\d{4}\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanTmdbTitle(value) {
  return decodeHtml(value)
    .replace(/\s*\(TV Series\s+\d{4}[^)]*\).*$/i, "")
    .replace(/\s*\(\d{4}\)\s*$/, "")
    .replace(/\s*[-—]\s*The Movie Database.*$/i, "")
    .replace(/\s*\|\s*TMDB.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function addTitle(list, seen, value) {
  var clean = cleanTmdbTitle(value);
  if (!clean || compactTitle(clean).length < 2) return;
  var key = normalize(clean);
  if (!seen[key]) {
    seen[key] = true;
    list.push(clean);
  }

  var withoutCodes = clean.replace(/^(?:[A-Z]{1,3}\s+){1,4}/, "").trim();
  var derivedKey = normalize(withoutCodes);
  if (withoutCodes && derivedKey.length >= 2 && !seen[derivedKey]) {
    seen[derivedKey] = true;
    list.push(withoutCodes);
  }
}

function phraseContains(haystack, needle) {
  if (!haystack || !needle || needle.length < 3) return false;
  return (" " + haystack + " ").indexOf(" " + needle + " ") >= 0;
}

function arabicBaseToken(token) {
  return token.indexOf("\u0627\u0644") === 0 && token.length > 2 ? token.slice(2) : token;
}

function fieldMatchScore(field, titles) {
  var normalizedField = normalize(field);
  var compactField = compactTitle(field);
  if (!normalizedField) return 0;
  var best = 0;
  var fieldTokens = normalizedField.split(" "), fieldKeys = {};
  for (var f = 0; f < fieldTokens.length; f++) fieldKeys[arabicBaseToken(fieldTokens[f])] = true;

  for (var i = 0; i < titles.length; i++) {
    var title = compactTitle(titles[i]);
    if (!title || title.length < 2) continue;
    if (compactField === title) best = Math.max(best, 120);
    else if (normalizedField === normalize(titles[i])) best = Math.max(best, 115);
    else if (phraseContains(normalizedField, title)) best = Math.max(best, 80);
    else {
      var tokens = title.split(" ");
      if (tokens.length >= 2) {
        var all = true;
        for (var t = 0; t < tokens.length; t++) if (!fieldKeys[arabicBaseToken(tokens[t])]) { all = false; break; }
        if (all) best = Math.max(best, 80);
      }
    }
  }
  return best;
}

function slugTitleTokenMatch(url, titles) {
  var tokens = String(url || "").toLowerCase().split(/[^a-z0-9]+/).filter(function (token) {
    return token.length >= 5;
  });
  if (!tokens.length) return false;
  for (var i = 0; i < titles.length; i++) {
    var words = normalize(titles[i]).split(" ").filter(function (word) {
      return /^[a-z0-9]{5,}$/.test(word);
    });
    for (var w = 0; w < words.length; w++) if (tokens.indexOf(words[w]) >= 0) return true;
  }
  return false;
}

function episodeNumber(value) {
  var text = decodeHtml(value);
  var match = text.match(/(?:الحلقة|الحلقه|حلقة|حلقه)\s*[:\-]?\s*(\d{1,4})/i);
  if (!match) match = text.match(/\bS\d{1,2}E(\d{1,4})\b/i);
  if (!match) match = text.match(/\bep(?:isode)?[\s._-]*(\d{1,4})\b/i);
  if (!match) match = text.match(/[-_\/]e(\d{1,4})(?:[\/?._-]|$)/i);
  return match ? parseInt(match[1], 10) : NaN;
}

var ARABIC_SEASON_ORDINALS = {
  "الحادي عشر": 11, "الثاني عشر": 12, "الثالث عشر": 13, "الرابع عشر": 14,
  "الخامس عشر": 15, "السادس عشر": 16, "السابع عشر": 17, "الثامن عشر": 18,
  "التاسع عشر": 19, "العشرون": 20,
  "الاول": 1, "الثاني": 2, "الثالث": 3, "الرابع": 4, "الخامس": 5,
  "السادس": 6, "السابع": 7, "الثامن": 8, "التاسع": 9, "العاشر": 10
};

function explicitSeasonEpisode(value) {
  var match = String(value || "").match(/\bS(\d{1,2})E(\d{1,4})\b/i);
  if (!match) match = String(value || "").match(/(?:season|الموسم)[\s._-]*(\d{1,2})[\s._-]*(?:episode|الحلقة)[\s._-]*(\d{1,4})/i);
  if (match) return { season: parseInt(match[1], 10), episode: parseInt(match[2], 10) };
  var text = normalize(value);
  var ordinal = text.match(/الموسم\s+(الحادي عشر|الثاني عشر|الثالث عشر|الرابع عشر|الخامس عشر|السادس عشر|السابع عشر|الثامن عشر|التاسع عشر|العشرون|الاول|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر)\s*(?:الحلقه\s*)?(?:رقم\s*)?(\d{1,4})/);
  if (ordinal && ARABIC_SEASON_ORDINALS[ordinal[1]]) {
    return { season: ARABIC_SEASON_ORDINALS[ordinal[1]], episode: parseInt(ordinal[2], 10) };
  }
  return null;
}

function parseTmdbPage(html) {
  var $ = cheerio.load(html);
  var pageTitle = $("title").first().text() || "";
  var title = cleanTmdbTitle(
    $('meta[property="og:title"]').attr("content") ||
    $("section.inner_content h2 a").first().text() ||
    $("h2 a").first().text() ||
    pageTitle
  );
  var yearMatch = pageTitle.match(/(?:TV Series\s+|\()(\d{4})/i);
  return { title: title, year: yearMatch ? parseInt(yearMatch[1], 10) : 0 };
}

function parseTmdbAlternativeTitles(html) {
  var $ = cheerio.load(html);
  var titles = [];
  $("table.titles tbody tr").each(function (_, element) {
    var row = wrap($, element);
    var cells = row.find("td");
    var value = cells.first().text();
    if (value) titles.push(value.replace(/\s+/g, " ").trim());
  });
  return titles;
}

function parseTmdbSeasonCounts(html, tmdbId) {
  var $ = cheerio.load(html), seasons = [], counts = {}, conflicts = {};
  $(".season_wrapper .season").each(function (_, element) {
    var card = wrap($, element);
    var url = absUrl(card.find('h2 a[href*="/season/"]').first().attr("href"), TMDB_BASE);
    if (originOf(url) !== TMDB_BASE) return;
    var match = url.match(/\/tv\/(\d+)(?:-[^\/?#]*)?\/season\/(\d+)(?:[\/?#]|$)/i);
    if (!match || parseInt(match[1], 10) !== parseInt(tmdbId, 10)) return;
    var number = parseInt(match[2], 10);
    var countMatch = card.find("h4").first().text().match(/(?:^|\D)(\d{1,4})\s+Episodes?\b/i);
    if (!number || !countMatch) return;
    var count = parseInt(countMatch[1], 10);
    if (!count) return;
    if (counts[number] && counts[number] !== count) conflicts[number] = true;
    counts[number] = count;
  });
  Object.keys(counts).forEach(function (number) {
    if (!conflicts[number]) seasons.push({ season_number: parseInt(number, 10), episode_count: counts[number] });
  });
  return seasons.sort(function (left, right) { return left.season_number - right.season_number; });
}

function getTmdbHtmlMetadata(tmdbId) {
  var languages = ["tr-TR", "en-US", "ar-SA"];
  var pageJobs = [];
  for (var i = 0; i < languages.length; i++) {
    pageJobs.push(
      fetchTextInfo(TMDB_BASE + "/tv/" + encodeURIComponent(tmdbId) + "?language=" + languages[i], "", "")
        .then(function (result) { return parseTmdbPage(result.html); })
        .catch(function () { return { title: "", year: 0 }; })
    );
  }

  var aliasesJob = fetchTextInfo(
    TMDB_BASE + "/tv/" + encodeURIComponent(tmdbId) + "/titles?language=en-US",
    "",
    ""
  ).then(function (result) {
    return parseTmdbAlternativeTitles(result.html);
  }).catch(function () {
    return [];
  });

  var seasonsJob = fetchTextInfo(
    TMDB_BASE + "/tv/" + encodeURIComponent(tmdbId) + "/seasons?language=en-US", "", ""
  ).then(function (result) {
    return parseTmdbSeasonCounts(result.html, tmdbId);
  }).catch(function () { return []; });

  return Promise.all([Promise.all(pageJobs), aliasesJob, seasonsJob]).then(function (parts) {
    var pages = parts[0] || [];
    var aliases = parts[1] || [];
    var titles = [];
    var seen = {};
    var year = 0;

    for (var p = 0; p < pages.length; p++) {
      addTitle(titles, seen, pages[p].title);
      if (!year && pages[p].year) year = pages[p].year;
    }
    for (var a = 0; a < aliases.length && titles.length < 50; a++) {
      addTitle(titles, seen, aliases[a]);
    }

    return { titles: titles, year: year, seasons: parts[2] || [] };
  });
}

function getTmdbMetadata(tmdbId) {
  var key = typeof TMDB_API_KEY !== "undefined" ? String(TMDB_API_KEY || "").trim() : "";
  if (!key) return getTmdbHtmlMetadata(tmdbId);
  var languages = ["ar-SA", "tr-TR", "en-US"];
  var jobs = [];
  for (var i = 0; i < languages.length; i++) {
    jobs.push(fetchJson("https://api.themoviedb.org/3/tv/" + encodeURIComponent(tmdbId) +
      "?api_key=" + encodeURIComponent(key) + "&language=" + languages[i] +
      "&append_to_response=alternative_titles", "", "").catch(function () { return null; }));
  }
  return Promise.all(jobs).then(function (pages) {
    var titles = [], seen = {}, seasons = [], year = 0;
    for (var p = 0; p < pages.length; p++) {
      var data = pages[p];
      if (!data) continue;
      addTitle(titles, seen, data.name);
      addTitle(titles, seen, data.original_name);
      if (!year && data.first_air_date) year = parseInt(data.first_air_date, 10) || 0;
      if (!seasons.length && data.seasons) seasons = data.seasons;
      var aliases = data.alternative_titles && data.alternative_titles.results || [];
      for (var a = 0; a < aliases.length && titles.length < 50; a++) addTitle(titles, seen, aliases[a].title);
    }
    if (!titles.length) return getTmdbHtmlMetadata(tmdbId);
    return { titles: titles, year: year, seasons: seasons };
  });
}

function catalogTitleMatches(value, titles) {
  var text = " " + normalize(value) + " ", aliases = [];
  for (var i = 0; i < titles.length; i++) {
    var alias = compactTitle(titles[i]);
    if (alias.length >= 2 && aliases.indexOf(alias) < 0) aliases.push(alias);
  }
  aliases.sort(function (a, b) { return b.length - a.length; });
  var matched = false;
  for (var a = 0; a < aliases.length; a++) {
    var tokens = aliases[a].split(" "), parts = [];
    for (var tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
      var token = tokens[tokenIndex].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      var base = arabicBaseToken(token);
      parts.push("(?:(?:\u0627\u0644)?" + base + ")");
    }
    var pattern = new RegExp("(^|\\s)" + parts.join("(?:\\s+(?:\u0647\u0648|\u0647\u064a|\u0647\u0645\u0627|\u0647\u0645|\u0647\u0646))?\\s+") + "(?=\\s|$)", "g");
    text = text.replace(pattern, function (_, prefix) { matched = true; return prefix + " "; });
  }
  if (!matched) return false;
  text = text
    .replace(/\b(?:19|20)\d{2}\b/g, " ")
    .replace(/\bs\d{1,2}e\d{1,4}\b/g, " ")
    .replace(/(?:الموسم)\s+(?:الاول|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر|\d{1,2})/g, " ")
    .replace(/(?:الحلقه|حلقه)\s+(?:رقم\s+)?\d{1,4}(?:\s+(?:و?الاخيره|الاولي))?/g, " ")
    .replace(/\b(?:season|episode|ep)\s*\d{1,4}\b/g, " ")
    .replace(/\b\d{1,4}\s*bolum\b|\bbolum\s*\d{1,4}\b/g, " ")
    .replace(/\b(?:full|tek|parca|izle|final|finali|finale|hd\d?|hq|online|series|tv|show|shahid4u)\b/g, " ")
    .replace(/(?:^|\s)(?:مسلسل|المسلسل|مشاهده|تحميل|مترجم|مترجمه|مدبلج|مدبلجه|كامل|كامله|الحلقات|جميع|اونلاين|قرمزي|شوف لايف|شاهد فور يو|قصه عشق|الاخيره|والاخيره|الاصلي|الأصلي|الاصلية|الأصلية|موقع|حصري|الحصري)(?=\s|$)/g, " ")
    .replace(/\s+/g, " ").trim();
  return !text;
}

function parseSeriesCards(html, pageUrl, titles, includeWeak) {
  var $ = cheerio.load(html);
  var cards = [];
  var seen = {};

  $('a[href*="/series/"]').each(function (_, element) {
    var anchor = wrap($, element);
    var url = absUrl(anchor.attr("href"), pageUrl);
    if (!url || originOf(url) !== originOf(pageUrl) || seen[urlKey(url)]) return;

    var image = anchor.find("img").first();
    var headingFields = [
      anchor.attr("title") || "",
      anchor.find(".title").first().text() || "",
      image.attr("alt") || ""
    ];
    var heading = headingFields.join(" ");
    var poster = image.attr("data-src") || image.attr("src") || "";
    var headingScore = 0;
    for (var h = 0; h < headingFields.length; h++) {
      headingScore = Math.max(headingScore, fieldMatchScore(headingFields[h], titles));
    }
    var posterScore = Math.max(fieldMatchScore(urlKey(poster), titles), fieldMatchScore(urlKey(url), titles));
    var score = headingScore;
    if (posterScore >= 80) score = Math.max(score, 105);

    var weak = !!includeWeak && score < 100 && slugTitleTokenMatch(url, titles);
    if (score >= 100 || weak) {
      seen[urlKey(url)] = true;
      cards.push({
        url: url,
        heading: heading.replace(/\s+/g, " ").trim(),
        poster: poster,
        score: weak ? 80 : score,
        weak: weak
      });
    }
  });

  cards.sort(function (left, right) { return right.score - left.score; });
  return cards;
}

function seriesSelfIdentity($) {
  return {
    headings: [
      $(".singleSeries h1").first().text() || "",
      $("h1").first().text() || "",
      $("title").first().text() || ""
    ],
    details: [
      $('meta[name="description"]').attr("content") || "",
      $('meta[property="og:description"]').attr("content") || "",
      $(".singleSeries .story").first().text() || "",
      $(".singleSeries img").first().attr("data-src") || "",
      $(".singleSeries img").first().attr("src") || ""
    ]
  };
}

function verifySeriesCard(card, titles, indexUrl) {
  return fetchTextInfo(card.url, indexUrl, "").then(function (result) {
    var $ = cheerio.load(result.html);
    var identity = seriesSelfIdentity($);
    if (/مدبلج|dubbed|dublaj/i.test(identity.headings.join(" "))) return null;
    var headingScore = 0;
    var detailScore = fieldMatchScore(result.url, titles);
    var i;
    for (i = 0; i < identity.headings.length; i++) {
      headingScore = Math.max(headingScore, fieldMatchScore(identity.headings[i], titles));
    }
    for (i = 0; i < identity.details.length; i++) {
      detailScore = Math.max(detailScore, fieldMatchScore(identity.details[i], titles));
    }
    var verified = false;
    for (var h = 0; h < identity.headings.length; h++) {
      if (catalogTitleMatches(identity.headings[h], titles)) verified = true;
    }
    if (!verified) return null;

    return {
      url: result.url,
      html: result.html,
      heading: $(".singleSeries h1").first().text() || $("h1").first().text() || card.heading,
      score: Math.max(card.score, headingScore, detailScore)
    };
  }).catch(function (error) {
    if (errorMessage(error).indexOf("cloudflare_challenge") === 0) {
      logFailure("cloudflare_challenge", originOf(card.url));
    }
    return null;
  });
}

function verifyRankedCards(cards, titles, indexUrl) {
  var index = 0;
  function next() {
    if (index >= cards.length || index >= MAX_SERIES_PROBES) return Promise.resolve(null);
    var card = cards[index++];
    return verifySeriesCard(card, titles, indexUrl).then(function (series) {
      if (series) return series;
      return next();
    });
  }
  return next();
}

function verifySeriesCardWeak(card, titles, indexUrl) {
  if (!card || !card.weak) return Promise.resolve(null);
  return fetchTextInfo(card.url, indexUrl, "").then(function (result) {
    var $ = cheerio.load(result.html);
    var heading = ($(".singleSeries h1").first().text() || $("h1").first().text() || "").replace(/\s+/g, " ").trim();
    if (!heading || /مدبلج|dubbed|dublaj/i.test(heading)) return null;
    return { url: result.url, html: result.html, heading: heading, score: card.score, weakAlias: heading };
  }).catch(function () { return null; });
}

function verifyRankedCardsWeak(cards, titles, indexUrl) {
  var index = 0;
  function next() {
    if (index >= cards.length || index >= MAX_SERIES_PROBES) return Promise.resolve(null);
    var card = cards[index++];
    if (!card.weak) return next();
    return verifySeriesCardWeak(card, titles, indexUrl).then(function (series) {
      if (series) return series;
      return next();
    });
  }
  return next();
}

function nextIndexPage(html, pageUrl, indexPath) {
  var $ = cheerio.load(html);
  var next = "", current = pathKey(pageUrl);
  var currentMatch = current.match(/\/page\/(\d+)$/);
  var currentNumber = currentMatch ? parseInt(currentMatch[1], 10) : 1;
  $('a[href]').each(function (_, element) {
    var url = absUrl(wrap($, element).attr("href"), pageUrl);
    var path = pathKey(url);
    var match = path.match(/\/page\/(\d+)$/);
    if (originOf(url) === originOf(pageUrl) && path.indexOf(indexPath.replace(/\/$/, "")) === 0 &&
        match && parseInt(match[1], 10) === currentNumber + 1) next = url;
  });
  return next;
}

function firstSeries(jobs) {
  return new Promise(function (resolve) {
    if (!jobs.length) { resolve(null); return; }
    var remaining = jobs.length, done = false;
    jobs.forEach(function (job) {
      Promise.resolve(job).catch(function () { return null; }).then(function (series) {
        if (done) return;
        if (series) { done = true; resolve(series); return; }
        if (!--remaining) resolve(null);
      });
    });
  });
}

var CORE_SEARCH_STOPWORDS = {
  "ما": 1, "هو": 1, "هي": 1, "هم": 1, "في": 1, "من": 1, "على": 1, "عن": 1,
  "الى": 1, "مع": 1, "او": 1, "و": 1, "يا": 1, "كل": 1, "هذا": 1, "هذه": 1,
  "التي": 1, "التى": 1, "ذلك": 1, "قصة": 1, "قصه": 1, "عشق": 1, "مسلسل": 1,
  "المسلسل": 1, "الحلقة": 1, "الحلقه": 1, "حلقة": 1, "حلقه": 1, "مترجم": 1,
  "مترجمة": 1, "مترجمه": 1, "مدبلج": 1, "مدبلجة": 1, "مدبلجه": 1, "كامل": 1,
  "كاملة": 1, "كامله": 1, "جميع": 1, "الحلقات": 1, "الاول": 1, "الاولى": 1,
  "الثاني": 1, "الثانية": 1, "الثالث": 1, "الرابع": 1, "الخامس": 1
};

function catalogSearchTitles(metadata) {
  var titles = metadata && metadata.titles || [], arabic = [], other = [], result = [], seen = {};
  function add(value) {
    var title = cleanTmdbTitle(value), key = title.toLowerCase().replace(/\s+/g, " ").trim();
    if (!key || seen[key]) return;
    seen[key] = true; result.push(title);
  }
  for (var i = 0; i < titles.length; i++) {
    if (/[\u0600-\u06ff]/.test(titles[i])) arabic.push(titles[i]); else other.push(titles[i]);
  }
  if (arabic.length) add(arabic[0]);
  if (other.length) add(other[0]);
  if (other.length > 1) add(other[1]);
  for (var a = 1; a < arabic.length; a++) add(arabic[a]);
  for (var o = 2; o < other.length; o++) add(other[o]);
  for (var v = 0; v < Math.min(titles.length, 4); v++) {
    var plain = String(titles[v]).replace(/[\u0625\u0623\u0622\u0671]/g, "\u0627");
    if (!/[\u0600-\u06ff]/.test(plain)) plain = normalize(plain);
    add(plain);
  }
  var variants = 0;
  for (var v1 = 0; v1 < result.length && variants < 4; v1++) {
    var original = String(result[v1] || "");
    if (!/^[\u0600-\u06ff]/.test(original)) continue;
    var words = original.split(" ");
    if (!words[0]) continue;
    var variant = words.slice(0);
    if (words[0].indexOf("\u0627\u0644") === 0 && words[0].length > 3) variant[0] = words[0].slice(2);
    else if (words[0].length >= 3) variant[0] = "\u0627\u0644" + words[0];
    else continue;
    add(variant.join(" "));
    variants++;
  }
  var tokenAdded = 0;
  for (var t = 0; t < result.length && tokenAdded < 6; t++) {
    var titleText = String(result[t] || "");
    if (!/[\u0600-\u06ff]/.test(titleText)) continue;
    var parts = titleText.replace(/[^\u0600-\u06ff\s]/g, " ").split(" ");
    for (var p = 0; p < parts.length && tokenAdded < 6; p++) {
      var word = parts[p];
      if (!/^[\u0600-\u06ff]{3,}$/.test(word)) continue;
      if (CORE_SEARCH_STOPWORDS[normalize(word)]) continue;
      var before = result.length;
      add(word);
      if (result.length > before) tokenAdded++;
    }
  }
  return result.slice(0, 12);
}

function resolveSeries(metadata, source) {
  source = source || SOURCES[0];
  var baseIndex = 0;
  function nextBase() {
    if (baseIndex >= source.bases.length) return Promise.resolve(null);
    var base = source.bases[baseIndex++], firstIndex = null;
    function verify(result) {
      return verifyRankedCards(parseSeriesCards(result.html, result.url, metadata.titles), metadata.titles, result.url).then(function (series) {
        if (series) return series;
        return verifyRankedCardsWeak(parseSeriesCards(result.html, result.url, metadata.titles, true), metadata.titles, result.url);
      });
    }
    var jobs = [fetchTextInfo(base + source.index, base + "/", "").then(function (page) {
      firstIndex = page;
      return verify(page);
    })];
    var searchTitles = catalogSearchTitles(metadata);
    searchTitles.slice(0, 3).forEach(function (title) {
      jobs.push(fetchTextInfo(base + "/?s=" + encodeURIComponent(title), base + "/", "").then(verify));
    });
    function nextIndex(url, count) {
      if (!url || count >= MAX_INDEX_PAGES) return Promise.resolve(null);
      return fetchTextInfo(url, base + "/", "").then(function (page) {
        return verify(page).then(function (series) {
          return series || nextIndex(nextIndexPage(page.html, page.url, source.index), count + 1);
        });
      }).catch(function () { return null; });
    }
    return firstSeries(jobs).then(function (series) {
      if (series) return series;
      var remaining = searchTitles.slice(3).map(function (title) {
        return fetchTextInfo(base + "/?s=" + encodeURIComponent(title), base + "/", "").then(verify);
      });
      remaining.push(nextIndex(firstIndex ? nextIndexPage(firstIndex.html, firstIndex.url, source.index) : "", 1));
      return firstSeries(remaining);
    }).then(function (series) { return series || nextBase(); });
  }
  return nextBase();
}

function siteEpisodeRequests(series, metadata, season, episode) {
  if (!(season > 0 && episode > 0)) return [];
  if (season === 1) return [{ season: season, episode: episode }];
  var $ = cheerio.load(series.html), endings = [], seen = {}, explicitEpisodes = {};
  $('.sec-line article.postEp a[href*="/episode/"]').each(function (_, element) {
    var anchor = wrap($, element);
    var identity = (anchor.attr("title") || "") + " " + anchor.text() + " " + (anchor.attr("href") || "");
    var explicit = explicitSeasonEpisode(identity);
    if (explicit && explicit.season === season) explicitEpisodes[explicit.episode] = true;
    var number = episodeNumber(identity);
    if (/نهايه الموسم/.test(normalize(identity)) && number > 0 && !seen[number]) {
      endings.push(number); seen[number] = true;
    }
  });
  endings.sort(function (a, b) { return a - b; });
  var offset = 0, counts = metadata && metadata.seasons || [], complete = true;
  for (var n = 1; n < season; n++) {
    var count = 0;
    for (var i = 0; i < counts.length; i++) {
      if (counts[i].season_number === n) count = parseInt(counts[i].episode_count, 10) || 0;
    }
    if (!count) { complete = false; break; }
    offset += count;
  }
  var boundary = endings[season - 2] || 0;
  if (!complete) offset = boundary;
  var dubbed = /مدبلج/.test(normalize(series.heading || $("h1").first().text()));
  if (!offset || (boundary && boundary !== offset) || dubbed) {
    return explicitEpisodes[episode] ? [{ season: season, episode: episode }] : [];
  }
  var absolute = episode > offset ? episode : offset + episode;
  var local = absolute - offset;
  var identities = [{ season: season, episode: local }, { season: 1, episode: absolute }];
  var requests = [];
  if (explicitEpisodes[local]) requests.push({ season: season, episode: local, identities: identities });
  requests.push({ season: 1, episode: absolute, mapped: true, identities: identities });
  log("episode_mapping", "S" + season + "E" + episode + " -> " + absolute);
  return requests;
}

function siteEpisodeRequest(series, metadata, season, episode) {
  return siteEpisodeRequests(series, metadata, season, episode)[0] || null;
}

function episodeIdentityMatches(identity, season, episode, identities) {
  if (identity.season === season && identity.episode === episode) return true;
  for (var i = 0; i < (identities || []).length; i++) {
    if (identity.season === identities[i].season && identity.episode === identities[i].episode) return true;
  }
  return false;
}

function episodeIdentityFieldsMatch(fields, season, episode, identities) {
  for (var i = 0; i < fields.length; i++) {
    var identity = explicitSeasonEpisode(fields[i]);
    if (identity && !episodeIdentityMatches(identity, season, episode, identities)) return false;
  }
  return true;
}

function findExactEpisode(series, wantedSeason, wantedEpisode) {
  var $ = cheerio.load(series.html);
  var matches = [];
  var seen = {};

  $('.sec-line article.postEp a[href*="/episode/"]').each(function (_, element) {
    var anchor = wrap($, element);
    var url = absUrl(anchor.attr("href"), series.url);
    if (!url || seen[urlKey(url)]) return;
    var identity = [
      anchor.attr("title") || "",
      anchor.find(".episodeNum").first().text() || "",
      anchor.find(".title").first().text() || "",
      anchor.find("img").first().attr("alt") || "",
      url
    ].join(" ");
    if (episodeNumber(identity) !== wantedEpisode) return;
    var explicit = explicitSeasonEpisode(identity);
    if (explicit && explicit.season !== wantedSeason) return;
    seen[urlKey(url)] = true;
    matches.push({ url: url, identity: identity, explicit: explicit });
  });

  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    var seasonMatches = [];
    for (var i = 0; i < matches.length; i++) {
      if (matches[i].explicit && matches[i].explicit.season === wantedSeason) seasonMatches.push(matches[i]);
    }
    if (seasonMatches.length === 1) return seasonMatches[0];
  }
  return null;
}

function anaPlayerAllowed(url) {
  return /^https?:\/\/(?:[a-z0-9-]+\.)*(?:anaplayer\.online|shoof\.site|shooof\.site|shooof\.online|shooof\.cyou|shooflive\.watch|shadwo\.pro)\/albaplayer\//i.test(String(url || ""));
}

function directMedia(url) {
  return !!mediaTypeFromUrl(url);
}

function verifyEpisodePage(series, episodeCandidate, wantedSeason, wantedEpisode, request) {
  return fetchTextInfo(episodeCandidate.url, series.url, "").then(function (result) {
    var $ = cheerio.load(result.html);
    var headingFields = [
      $(".singleInfo h1").first().text() || "",
      $("h1").first().text() || "",
      $("title").first().text() || ""
    ];
    var heading = headingFields.join(" ");
    if (/مدبلج|dubbed|dublaj/i.test(heading)) return null;
    if (episodeNumber(heading) !== wantedEpisode) {
      logFailure("episode_identity_mismatch", "number");
      return null;
    }

    var seriesLink = $("h2 a[href*=\"/series/\"]").first();
    var linkedSeriesUrl = absUrl(seriesLink.attr("href"), result.url);
    if (!linkedSeriesUrl || urlKey(linkedSeriesUrl) !== urlKey(series.url)) {
      logFailure("episode_identity_mismatch", "series");
      return null;
    }

    var playerUrl = "";
    $(".getEmbed iframe[src], .getEmbed video[src], .getEmbed source[src], iframe[src], video[src], source[src]").each(function (_, element) {
      if (playerUrl) return;
      var candidate = absUrl(wrap($, element).attr("src"), result.url);
      if (candidate && (anaPlayerAllowed(candidate) || directMedia(candidate) || sameOriginEmbedAllowed(candidate, result.url))) playerUrl = candidate;
    });
    if (!playerUrl) {
      logFailure("player_not_found", "page_container");
      return null;
    }

    var identities = request && request.identities;
    var headingIdentity = explicitSeasonEpisode(heading);
    if (!episodeIdentityFieldsMatch(headingFields, wantedSeason, wantedEpisode, identities)) {
      logFailure("episode_identity_mismatch", "season");
      return null;
    }
    var explicit = explicitSeasonEpisode(playerUrl);
    if (explicit) {
      if (!episodeIdentityMatches(explicit, wantedSeason, wantedEpisode, identities)) {
        logFailure("player_identity_mismatch", "S" + explicit.season + "E" + explicit.episode);
        return null;
      }
    } else if (wantedSeason !== 1 && !headingIdentity) {
      logFailure("player_identity_mismatch", "season_unverifiable");
      return null;
    }

    return {
      episodeUrl: result.url,
      playerUrl: playerUrl,
      season: wantedSeason,
      episode: wantedEpisode,
      identities: identities || (headingIdentity ? [headingIdentity] : undefined)
    };
  }).catch(function (error) {
    if (errorMessage(error).indexOf("cloudflare_challenge") === 0) {
      logFailure("cloudflare_challenge", originOf(episodeCandidate.url));
    }
    return null;
  });
}

function qualityFromText(value) {
  var text = String(value || "").toLowerCase();
  function hasResolutionToken(height) {
    return new RegExp("(^|[^a-z0-9])" + height + "p?(?=$|[^a-z0-9])", "i").test(text);
  }
  if (hasResolutionToken("2160") || /(^|[^a-z0-9])4k(?=$|[^a-z0-9])|\buhd\b/.test(text)) return "4K";
  if (hasResolutionToken("1080") || /full\s*hd|\bfhd\b/.test(text)) return "1080p";
  if (hasResolutionToken("720")) return "720p";
  if (hasResolutionToken("576")) return "576p";
  if (hasResolutionToken("480") || /\bsd\b/.test(text)) return "480p";
  if (hasResolutionToken("360") || /\bmobile\b/.test(text)) return "360p";
  if (hasResolutionToken("320")) return "320p";
  return "";
}

function qualityFromResolution(widthValue, heightValue) {
  var width = parseInt(widthValue, 10) || 0;
  var height = parseInt(heightValue, 10) || 0;
  if (height >= 2000 || width >= 3800) return "4K";
  if (height >= 1000 || width >= 1900) return "1080p";
  if (height >= 700 || width >= 1200) return "720p";
  if (height >= 560) return "576p";
  if (height >= 460) return "480p";
  if (height >= 340) return "360p";
  return height ? height + "p" : "";
}

function qualityRank(quality) {
  var ranks = { "4K": 7000, "2160p": 7000, "1080p": 6000, "720p": 5000, "576p": 4000, "480p": 3000, "360p": 2000, "320p": 1000 };
  return ranks[quality] || 0;
}

function mediaTypeFromUrl(url) {
  if (/\.m3u8(?:[?#]|$)/i.test(url)) return "m3u8";
  if (/\.mp4(?:[?#]|$)/i.test(url)) return "mp4";
  var decoded = String(url || "");
  try { decoded = decodeURIComponent(decoded); } catch (_) {}
  if (/^https?:\/\//i.test(decoded) && /[?&]mime=video\/mp4(?:&|$)/i.test(decoded)) return "mp4";
  return "";
}

function playbackHeaders(referer) {
  return requestHeaders(referer, originOf(referer), "*/*");
}

function streamObject(url, referer, quality, serverName) {
  var resolvedQuality = quality || qualityFromText(url);
  var label = String(serverName || "Server").replace(/\s+/g, " ").trim();
  var headers = playbackHeaders(referer);

  var stream = {
    name: "Krmizi • " + label,
    title: "Krmizi • " + label + (resolvedQuality ? " • " + resolvedQuality : ""),
    url: url,
    provider: "Krmizi",
    language: "🇮🇶",
    headers: headers
  };
  if (resolvedQuality) stream.quality = resolvedQuality;
  var type = mediaTypeFromUrl(url);
  if (type) stream.type = type;
  return stream;
}

function parseHlsMaster(text, masterUrl) {
  var lines = String(text || "").replace(/\r/g, "").split("\n");
  var variants = [];

  for (var i = 0; i < lines.length; i++) {
    if (lines[i].indexOf("#EXT-X-STREAM-INF:") !== 0) continue;
    var info = lines[i];
    var resolution = info.match(/RESOLUTION=(\d+)x(\d+)/i);
    var quality = resolution ? qualityFromResolution(resolution[1], resolution[2]) : qualityFromText(info);

    var next = i + 1;
    while (next < lines.length && (!lines[next].trim() || lines[next].charAt(0) === "#")) next++;
    if (next >= lines.length) continue;
    var url = absUrl(lines[next].trim(), masterUrl);
    if (url) variants.push({ url: url, quality: quality || qualityFromText(url) });
  }
  return variants;
}

function isHlsPlaylistText(text) {
  return /^\s*#EXTM3U(?:\s|$)/i.test(String(text || "").replace(/^\uFEFF/, ""));
}

function unescapePackedString(value) {
  return String(value || "")
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, "\\")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t");
}

function unpackDeanEdwards(source) {
  var text = String(source || "");
  var pattern = /eval\(function\(p,a,c,k,e,d\)\{[\s\S]*?\}\('((?:\\.|[^'])*)',(\d+),(\d+),'((?:\\.|[^'])*)'\.split\('\|'\)\)\)/g;
  var output = "";
  var match;
  var decodedCount = 0;

  while ((match = pattern.exec(text)) !== null && decodedCount < 4) {
    var payload = unescapePackedString(match[1]);
    var radix = parseInt(match[2], 10);
    var count = parseInt(match[3], 10);
    var keys = unescapePackedString(match[4]).split("|");
    if (radix < 2 || radix > 36 || count > 2000 || payload.length > 250000) continue;

    while (count--) {
      if (!keys[count]) continue;
      payload = payload.replace(new RegExp("\\b" + count.toString(radix) + "\\b", "g"), keys[count]);
    }
    output += "\n" + payload;
    decodedCount++;
  }
  return output;
}

function mediaEntriesFromHtml(html) {
  var normalized = cleanUrlValue(html);
  var unpacked = unpackDeanEdwards(html);
  if (unpacked) normalized += "\n" + cleanUrlValue(unpacked);

  var entries = [];
  var seen = {};

  function add(urlValue, labelValue) {
    var url = cleanUrlValue(urlValue).replace(/[),;]+$/, "");
    if (!directMedia(url) || seen[url]) return;
    seen[url] = true;
    entries.push({ url: url, quality: qualityFromText(labelValue) || qualityFromText(url) });
  }

  var pairedPatterns = [
    /(?:file|src|source|hls|playlist|url)\s*:\s*["'](https?:[^"']+)["']\s*(?:,\s*label\s*:\s*["']([^"']+)["'])?/gi,
    /["'](?:file|src|source|hls|playlist|url)["']\s*:\s*["'](https?:[^"']+)["']\s*(?:,\s*["']label["']\s*:\s*["']([^"']+)["'])?/gi
  ];

  for (var p = 0; p < pairedPatterns.length; p++) {
    var paired = pairedPatterns[p];
    var pairedMatch;
    while ((pairedMatch = paired.exec(normalized)) !== null) add(pairedMatch[1], pairedMatch[2] || "");
  }

  var generic = /https?:\/\/[^"'\\\s<>]+?\.(?:m3u8|mp4)(?:\?[^"'\\\s<>]*)?/gi;
  var genericMatch;
  while ((genericMatch = generic.exec(normalized)) !== null) add(genericMatch[0], "");
  return entries;
}

function canonicalEmbedUrl(url) {
  var value = cleanUrlValue(url);
  var match = value.match(/^https?:\/\/(?:www\.)?(v\.albrq\.news|anaturk\.cc|vidoba\.cc|vidspeed\.cc)(\/embed-[a-z0-9]{8,24}\.html)([?#].*)?$/i);
  if (!match) return value;
  var hosts = {
    "v.albrq.news": "cdnplus.sbs",
    "anaturk.cc": "anafast.cyou",
    "vidoba.cc": "vidoba.cyou",
    "vidspeed.cc": "vidspeed.space"
  };
  return "https://" + hosts[match[1].toLowerCase()] + match[2] + (match[3] || "");
}

function supportedDirectEmbed(url) {
  return /^https?:\/\/(?:[a-z0-9-]+\.)*(?:cdnplus\.(?:space|sbs|org)|mp4plus\.cyou|anafast\.cyou|vidoba\.cyou|vidspeed\.space|larhu\.website|morencius\.com|miravd\.com|mwdy\.cc|arabhd\.onl)\//i.test(canonicalEmbedUrl(url));
}

function dailymotionId(url) {
  var value = String(url || "");
  var match = value.match(/dailymotion\.com\/(?:embed\/)?video\/([A-Za-z0-9]+)/i);
  if (!match) match = value.match(/dai\.ly\/([A-Za-z0-9]+)/i);
  return match ? match[1] : "";
}

function primaryServerEmbed(html, serverUrl) {
  var $ = cheerio.load(html);
  var node = $(".aplr-player-content iframe#iframe[src], .video-con iframe#iframe[src], iframe#iframe[src]").first();
  var url = absUrl(node.attr("src"), serverUrl);
  if (!url || urlKey(url) === urlKey(serverUrl)) return "";
  return url;
}

function collectAnaServers(html, playerUrl) {
  var $ = cheerio.load(html);
  var servers = [];
  var seen = {};
  var playerOrigin = originOf(playerUrl);
  var playerPath = pathKey(playerUrl);

  $('a.aplr-link[href*="?serv="], a[href*="?serv="]').each(function (_, element) {
    var anchor = wrap($, element);
    var url = absUrl(anchor.attr("href"), playerUrl);
    if (!url || originOf(url) !== playerOrigin || pathKey(url) !== playerPath || seen[url]) return;
    var servMatch = url.match(/[?&]serv=(\d+)/i);
    if (!servMatch) return;
    seen[url] = true;
    servers.push({
      url: url,
      label: (anchor.text() || "Server " + servMatch[1]).replace(/\s+/g, " ").trim()
    });
  });

  return servers.slice(0, MAX_SERVERS);
}

function responseHeader(response, name) {
  return response && response.headers && typeof response.headers.get === "function" ?
    String(response.headers.get(name) || "") : "";
}

function probeMediaFile(url, referer, isMp4) {
  var headers = playbackHeaders(referer);
  if (!isMp4) headers.Range = "bytes=0-511";
  var work = Promise.resolve().then(function () {
    return fetch(url, { method: isMp4 ? "HEAD" : "GET", headers: headers, skipSizeCheck: true });
  })
    .then(function (response) {
      if (!response || !response.ok) return false;
      var type = responseHeader(response, "content-type").toLowerCase();
      if (/text\/|html|json|xml/.test(type)) return false;
      var length = responseHeader(response, "content-length");
      if (length && parseInt(length, 10) === 0) return false;
      if (/^(?:video|audio)\//.test(type) || /application\/(?:octet-stream|mp2t|mp4)/.test(type)) return true;
      if (!isMp4 && typeof response.arrayBuffer === "function") {
        return response.arrayBuffer().then(function (buffer) {
          var bytes = new Uint8Array(buffer);
          return bytes.length > 8 && (bytes[0] === 0x47 ||
            (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) ||
            (bytes[4] === 0x73 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70));
        });
      }
      return false;
    });
  return withDeadline(work, 6000, "media_probe_timeout " + url).catch(function () { return false; });
}

function validateMediaPlaylist(result, referer) {
  if (!isHlsPlaylistText(result.html) || !/#EXTINF:/i.test(result.html)) return Promise.resolve(false);
  var lines = result.html.replace(/\r/g, "").split("\n");
  var segment = "", init = "";
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (line.indexOf("#EXT-X-MAP:") === 0) {
      var match = line.match(/URI="([^"]+)"/i);
      if (match) init = absUrl(match[1], result.url);
    }
    if (!segment && line && line.charAt(0) !== "#") segment = absUrl(line, result.url);
  }
  if (!segment) return Promise.resolve(false);
  var jobs = [probeMediaFile(segment, referer, false)];
  if (init) jobs.push(probeMediaFile(init, referer, false));
  return Promise.all(jobs).then(function (valid) {
    for (var j = 0; j < valid.length; j++) if (!valid[j]) return false;
    return true;
  });
}

function readMediaPlaylist(url, referer) {
  return fetchTextInfo(url, referer, originOf(referer),
    "application/vnd.apple.mpegurl,application/x-mpegURL,text/plain,*/*")
    .then(function (result) {
      return validateMediaPlaylist(result, referer).then(function (valid) { return valid ? result : null; });
    }).catch(function () { return null; });
}

function addMediaEntry(entry, referer, serverName, streams, seenStreams) {
  var url = entry && entry.url ? entry.url : "";
  if (!directMedia(url) || seenStreams[url]) return Promise.resolve();
  seenStreams[url] = true;
  var declaredQuality = entry.quality || qualityFromText(url);
  function add(mediaUrl, quality) {
    if (mediaUrl !== url && seenStreams[mediaUrl]) return;
    seenStreams[mediaUrl] = true;
    streams.push(streamObject(mediaUrl, referer, quality, serverName));
  }
  if (!/\.m3u8(?:[?#]|$)/i.test(url)) {
    return probeMediaFile(url, referer, true).then(function (valid) { if (valid) add(url, declaredQuality); });
  }
  return fetchTextInfo(url, referer, originOf(referer),
    "application/vnd.apple.mpegurl,application/x-mpegURL,text/plain,*/*")
    .then(function (result) {
      if (!isHlsPlaylistText(result.html)) return;
      var variants = parseHlsMaster(result.html, result.url);
      if (!variants.length) {
        return validateMediaPlaylist(result, referer).then(function (valid) { if (valid) add(result.url, declaredQuality); });
      }
      var jobs = variants.map(function (variant) {
        return readMediaPlaylist(variant.url, referer).then(function (media) {
          return media ? { url: media.url, quality: variant.quality } : null;
        });
      });
      return Promise.all(jobs).then(function (verified) {
        var audio = result.html.match(/#EXT-X-MEDIA:[^\n]*TYPE=AUDIO[^\n]*URI="([^"]+)"/i);
        if (audio) {
          for (var a = 0; a < verified.length; a++) if (!verified[a]) return;
          return readMediaPlaylist(absUrl(audio[1], result.url), referer).then(function (media) {
            if (media) add(result.url, "");
          });
        }
        for (var i = 0; i < verified.length; i++) if (verified[i]) add(verified[i].url, verified[i].quality);
      });
    }).catch(function () { logFailure("media_unavailable", originOf(url)); });
}

function resolveDailymotion(url, referer, serverName, streams, seenStreams) {
  var id = dailymotionId(url);
  if (!id) return Promise.resolve();

  return fetchJson("https://www.dailymotion.com/player/metadata/video/" + id, referer, originOf(referer))
    .then(function (data) {
      var jobs = [];
      var qualities = data && data.qualities ? data.qualities : {};
      var keys = Object.keys(qualities);
      for (var i = 0; i < keys.length; i++) {
        var list = qualities[keys[i]] || [];
        for (var j = 0; j < list.length; j++) {
          if (!list[j] || !list[j].url) continue;
          jobs.push(addMediaEntry(
            { url: list[j].url, quality: qualityFromText(keys[i]) },
            url,
            serverName,
            streams,
            seenStreams
          ));
        }
      }
      if (!jobs.length && data && data.stream_hls_url) {
        jobs.push(addMediaEntry({ url: data.stream_hls_url, quality: "" }, url, serverName, streams, seenStreams));
      }
      return Promise.all(jobs);
    }).catch(function () {});
}

function resolveEmbedTarget(target, expected, streams, seenStreams) {
  if (!target || !target.url) return Promise.resolve();
  var url = canonicalEmbedUrl(target.url);

  if (directMedia(url)) {
    return addMediaEntry({ url: url, quality: qualityFromText(url) }, target.referer, target.label, streams, seenStreams);
  }
  if (dailymotionId(url)) {
    return resolveDailymotion(url, target.referer, target.label, streams, seenStreams);
  }
  if (!supportedDirectEmbed(url)) return Promise.resolve();

  return fetchTextInfo(url, target.referer, originOf(target.referer)).then(function (result) {
    if (!episodeIdentityFieldsMatch([result.url, cheerio.load(result.html)("title").first().text()], expected.season, expected.episode, expected.identities)) {
      logFailure("player_identity_mismatch", target.label);
      return;
    }
    var entries = mediaEntriesFromHtml(result.html);
    var jobs = [];
    for (var i = 0; i < entries.length; i++) {
      jobs.push(addMediaEntry(entries[i], result.url, target.label, streams, seenStreams));
    }
    return Promise.all(jobs);
  }).catch(function () {});
}

function resolveAnaPlayer(playerUrl, episodeUrl, wantedSeason, wantedEpisode, identities) {
  var streams = [];
  var seenStreams = {};

  return fetchTextInfo(playerUrl, episodeUrl, originOf(episodeUrl)).then(function (player) {
    var title = cheerio.load(player.html)("title").first().text();
    var explicit = explicitSeasonEpisode(player.url + " " + title);
    if (!episodeIdentityFieldsMatch([player.url, title], wantedSeason, wantedEpisode, identities)) {
      logFailure("player_identity_mismatch", "AnaPlayer");
      return [];
    }
    if (!explicit && wantedSeason !== 1 && !(identities && identities.length)) {
      logFailure("player_identity_mismatch", "season_unverifiable");
      return [];
    }

    var servers = collectAnaServers(player.html, player.url);
    if (!servers.length) {
      var fallbackEmbed = primaryServerEmbed(player.html, player.url);
      if (fallbackEmbed) {
        servers.push({ url: player.url, label: "Main", inlineEmbed: fallbackEmbed });
      }
    }

    var serverJobs = [];
    for (var i = 0; i < servers.length; i++) {
      (function (server) {
        if (server.inlineEmbed) {
          serverJobs.push(Promise.resolve({
            url: server.inlineEmbed,
            label: server.label,
            referer: server.url
          }));
          return;
        }
        serverJobs.push(
          fetchTextInfo(server.url, player.url, originOf(player.url)).then(function (serverPage) {
            var embed = primaryServerEmbed(serverPage.html, serverPage.url);
            if (!embed) return null;
            return { url: embed, label: server.label, referer: serverPage.url };
          }).catch(function () { return null; })
        );
      })(servers[i]);
    }

    return Promise.all(serverJobs).then(function (resolvedTargets) {
      var targets = [];
      var seenTargets = {};
      for (var t = 0; t < resolvedTargets.length; t++) {
        var target = resolvedTargets[t];
        if (!target || !target.url || seenTargets[target.url]) continue;
        seenTargets[target.url] = true;
        targets.push(target);
        log("server", target.label);
      }

      var jobs = [];
      var expected = { season: wantedSeason, episode: wantedEpisode, identities: identities };
      for (var j = 0; j < targets.length; j++) {
        jobs.push(resolveEmbedTarget(targets[j], expected, streams, seenStreams));
      }
      return Promise.all(jobs).then(function () { return streams; });
    });
  }).catch(function (error) {
    if (errorMessage(error).indexOf("cloudflare_challenge") === 0) {
      logFailure("cloudflare_challenge", originOf(playerUrl));
    }
    return [];
  });
}

function sameOriginEmbedAllowed(url, pageUrl) {
  return !!url && !!pageUrl && originOf(url) === originOf(pageUrl) && /\/(?:embed|player|watch)\//i.test(pathKey(url));
}

function resolveSameOriginEmbed(embedUrl, episodeUrl, season, episode, identities) {
  return fetchTextInfo(embedUrl, episodeUrl, originOf(episodeUrl)).then(function (page) {
    var $ = cheerio.load(page.html), streams = [], seenStreams = {};
    var nested = "";
    $("iframe[src], iframe[data-src]").each(function (_, element) {
      if (nested) return;
      var frame = wrap($, element);
      var url = absUrl(frame.attr("src") || frame.attr("data-src"), page.url);
      if (url && anaPlayerAllowed(url)) nested = url;
    });
    if (nested) return resolveAnaPlayer(nested, page.url, season, episode, identities);
    var direct = "";
    $("video[src], video source[src], source[src]").each(function (_, element) {
      if (direct) return;
      var url = absUrl(wrap($, element).attr("src"), page.url);
      if (url && directMedia(url)) direct = url;
    });
    if (direct) {
      return addMediaEntry({ url: direct, quality: qualityFromText(direct) }, page.url, "Main", streams, seenStreams).then(function () { return streams; });
    }
    var entries = mediaEntriesFromHtml(page.html);
    return Promise.all(entries.map(function (entry) {
      return addMediaEntry(entry, page.url, "Main", streams, seenStreams);
    })).then(function () { return streams; });
  }).catch(function () { return []; });
}

function resolvePlayer(verifiedEpisode) {
  if (directMedia(verifiedEpisode.playerUrl)) {
    var streams = [];
    var seen = {};
    return addMediaEntry(
      { url: verifiedEpisode.playerUrl, quality: qualityFromText(verifiedEpisode.playerUrl) },
      verifiedEpisode.episodeUrl,
      "Main",
      streams,
      seen
    ).then(function () { return streams; });
  }

  if (anaPlayerAllowed(verifiedEpisode.playerUrl)) {
    return resolveAnaPlayer(
      verifiedEpisode.playerUrl,
      verifiedEpisode.episodeUrl,
      verifiedEpisode.season,
      verifiedEpisode.episode,
      verifiedEpisode.identities
    );
  }
  if (sameOriginEmbedAllowed(verifiedEpisode.playerUrl, verifiedEpisode.episodeUrl)) {
    return resolveSameOriginEmbed(
      verifiedEpisode.playerUrl,
      verifiedEpisode.episodeUrl,
      verifiedEpisode.season,
      verifiedEpisode.episode,
      verifiedEpisode.identities
    );
  }
  return Promise.resolve([]);
}

function sortStreams(streams) {
  return (streams || []).sort(function (left, right) {
    var qualityDelta = qualityRank(right.quality || "") - qualityRank(left.quality || "");
    if (qualityDelta) return qualityDelta;
    return String(left.title || "").localeCompare(String(right.title || ""));
  });
}

function arabicOnlyStreams(streams) {
  return (streams || []).filter(function (stream) {
    var lang = String(stream && stream.language || "").toLowerCase();
    return lang === "ar" || lang === "🇮🇶";
  });
}

function extraUrlKey(url) {
  return String(url || "").split("#")[0].replace(/\/+$/, "").toLowerCase();
}

function extraWrapperAllowed(url) {
  return /^https?:\/\/(?:www\.)?3sktvtr\.com\/watch\//i.test(String(url || ""));
}

function extraEpisodeNumber(value) {
  var n = episodeNumber(value);
  if (n) return n;
  var match = decodeHtml(value).match(/(?:الحلقة|الحلقه|حلقة|حلقه)\s*(?:رقم\s*)?(\d{1,4})/i);
  if (!match) match = normalize(value).match(/(?:^|\s)(\d{1,4})\s*bolum(?:\s|$)/i);
  return match ? parseInt(match[1], 10) : NaN;
}

function extraRequestMatch(identity, requests) {
  var number = extraEpisodeNumber(identity);
  if (!number) return null;
  var explicit = explicitSeasonEpisode(identity);
  for (var i = 0; i < requests.length; i++) {
    if (!explicit && requests[i].season > 1) continue;
    if (requests[i].episode === number && (!explicit || requests[i].season === explicit.season)) return { season: requests[i].season, episode: requests[i].episode, identities: requests };
  }
  return null;
}

function extraAnchorIdentity(anchor) {
  return [anchor.attr("title") || "", anchor.text() || "", anchor.find("img").first().attr("alt") || ""].join(" ");
}

function extraCatalogLinks(html, pageUrl, metadata, requests, seriesVerified) {
  var $ = cheerio.load(html), links = [], seen = {};
  $("a[href]").each(function (_, element) {
    var a = wrap($, element), url = absUrl(a.attr("href"), pageUrl);
    if (!url || originOf(url) !== originOf(pageUrl) || seen[extraUrlKey(url)]) return;
    var identity = extraAnchorIdentity(a);
    if (/اعلان|إعلان|تريلر|trailer|fragman/i.test(identity)) return;
    var score = fieldMatchScore(identity, metadata.titles);
    var request = extraRequestMatch(identity, requests);
    if (!request && !/\/(?:series|tvshows|dizi|diziler)\/|\/category\.php\?cat=/i.test(url)) return;
    if (score < 80 && !(seriesVerified && request)) return;
    seen[extraUrlKey(url)] = true;
    links.push({ url: url, identity: identity, score: score, request: request });
  });
  links.sort(function (a, b) { return (b.request ? 1000 : 0) + b.score - ((a.request ? 1000 : 0) + a.score); });
  return links;
}

function extraPageIdentity(html) {
  var $ = cheerio.load(html);
  return [$("h1").first().text() || "", $("meta[property='og:title']").first().attr("content") || "", $("title").first().text() || ""].join(" ");
}

function extraPageTitleMatches(html, metadata) {
  var $ = cheerio.load(html), heading = $("h1").first().text() || "";
  var fields = heading.trim() ? [heading] : [$("meta[property='og:title']").first().attr("content") || "",$("title").first().text() || ""];
  function clean(value) {
    return normalize(value).split(/\s[|]\s/)[0]
      .replace(/^(?:مسلسل|المسلسل)\s+/g,"")
      .replace(/\s+(?:الحلقه|حلقه)\s*(?:رقم\s*)?\d+[\s\S]*$/i,"")
      .replace(/\s+\d+\s+bolum[\s\S]*$/i,"")
      .replace(/\s+(?:izle|مترجم|مترجمه|مدبلج|مدبلجه|hd\d?|full|online|son bolum)[\s\S]*$/i,"").trim();
  }
  for (var f = 0; f < fields.length; f++) {
    if (!fields[f]) continue;
    if (typeof catalogTitleMatches === "function") {
      if (catalogTitleMatches(fields[f],metadata.titles)) return true;
    } else {
      for (var t = 0; t < metadata.titles.length; t++) if (clean(fields[f]) === clean(metadata.titles[t])) return true;
    }
  }
  return false;
}

function extraOwnedPlayerTargets(html, pageUrl) {
  var $ = cheerio.load(html), targets = [], seen = {};
  function add(value) {
    var url = absUrl(value, pageUrl);
    if (!url || seen[url]) return;
    var ownEmbed = originOf(url) === originOf(pageUrl) && /\/(?:embed|player|vid\/ply)\//i.test(url);
    if (!ownEmbed && !extraWrapperAllowed(url) && !anaPlayerAllowed(url) && !directMedia(url) && !supportedDirectEmbed(url) && !dailymotionId(url)) return;
    seen[url] = true;
    targets.push({ url: url, referer: pageUrl, label: "Main" });
  }
  $("iframe[src], iframe[data-src]").each(function (_, element) {
    var frame = wrap($, element);
    add(frame.attr("src") || frame.attr("data-src"));
  });
  $("#Playerholder a[href], .getEmbed a[href]").each(function (_, element) {
    var value = absUrl(wrap($, element).attr("href"), pageUrl);
    if (extraWrapperAllowed(value)) add(value);
  });
  $(".embeding a[data-src], .embeding [data-src]").each(function (_, element) {
    add(wrap($, element).attr("data-src"));
  });
  $(".series-watch-alternatives [data-hhs]").each(function (_, element) {
    var url = absUrl(wrap($, element).attr("data-hhs"), pageUrl);
    if (originOf(url) === originOf(pageUrl)) add(url);
  });
  $("video[src], video source[src]").each(function (_, element) { add(wrap($, element).attr("src")); });
  return targets.slice(0, 8);
}

function extraResolveOwnedPlayer(target, request, depth) {
  if (anaPlayerAllowed(target.url)) return resolveAnaPlayer(target.url, target.referer, request.season, request.episode, request.identities);
  var streams = [], seen = {};
  if (directMedia(target.url) || supportedDirectEmbed(target.url) || dailymotionId(target.url)) {
    return resolveEmbedTarget(target, request, streams, seen).then(function () { return streams; });
  }
  if (depth >= 2) return Promise.resolve([]);
  return fetchTextInfo(target.url, target.referer, "").then(function (page) {
    var identity = extraPageIdentity(page.html);
    var number = extraEpisodeNumber(identity);
    if (number && !extraRequestMatch(identity, request.identities || [request])) return [];
    var nested = extraOwnedPlayerTargets(page.html, page.url);
    var $ = cheerio.load(page.html);
    var mediaReferer = $("meta[name=referrer]").first().attr("content") === "no-referrer" ? "" : page.url;
    var entries = mediaEntriesFromHtml(page.html), mediaStreams = [], mediaSeen = {};
    var mediaJobs = entries.map(function (entry) { return addMediaEntry(entry, mediaReferer, target.label, mediaStreams, mediaSeen); });
    return Promise.all(nested.map(function (child) { return extraResolveOwnedPlayer(child, request, depth + 1); }).concat(mediaJobs)).then(function (parts) {
      var result = mediaStreams.slice(0);
      for (var i = 0; i < parts.length; i++) if (Array.isArray(parts[i])) result = result.concat(parts[i]);
      return result;
    });
  }).catch(function () { return []; });
}

function extraResolveEpisode(candidate, metadata, requests, referer) {
  return fetchTextInfo(candidate.url, referer, "").then(function (page) {
    var identity = extraPageIdentity(page.html);
    var request = extraRequestMatch(identity, requests);
    if (!request || !extraPageTitleMatches(page.html, metadata)) {
      logFailure("extra_episode_identity_mismatch", page.url);
      return [];
    }
    var targets = extraOwnedPlayerTargets(page.html, page.url);
    return Promise.all(targets.map(function (target) { return extraResolveOwnedPlayer(target, request, 0); })).then(function (parts) {
      var result = [];
      for (var i = 0; i < parts.length; i++) result = result.concat(parts[i]);
      return result;
    });
  }).catch(function (error) { logFailure("extra_episode_failed", errorMessage(error)); return []; });
}

function extraSearchRequests(metadata, source, base, requests) {
  var titles = typeof extraQueryTitles === "function" ? extraQueryTitles(metadata) : metadata.titles || [];
  var queries = [], seen = {};
  function add(title) {
    if (!title || seen[title]) return;
    seen[title] = true; queries.push(title);
  }
  for (var i = 0; i < titles.length; i++) {
    if (source.search === "php" && /[\u0600-\u06ff]/.test(titles[i]) && requests.length) {
      add(titles[i] + " الحلقة " + requests[0].episode);
    }
    add(titles[i]);
  }
  return queries.slice(0, 8).map(function (title) {
    return {url:base + (source.search === "php" ? "/search.php?keywords=" : "/?s=") + encodeURIComponent(title)};
  });
}

function extraFetchCatalog(request, referer) {
  if (!request.method || request.method === "GET") return fetchTextInfo(request.url, referer, "");
  var headers = requestHeaders(referer, originOf(referer), "text/html,*/*");
  headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8";
  var job = fetch(request.url,{method:request.method,headers:headers,body:request.body,skipSizeCheck:true}).then(function (response) {
    if (!response || !response.ok) throw new Error("http_" + (response ? response.status : "no_response"));
    return response.text().then(function (body) {
      if (isChallenge(body)) throw new Error("cloudflare_challenge");
      return {html:String(body || ""),url:response.url || request.url,status:response.status};
    });
  });
  return typeof withDeadline === "function" ? withDeadline(job,8000,"catalog_search_timeout") : job;
}

function extraNextCatalogPage(html, pageUrl) {
  var $ = cheerio.load(html), current = String(pageUrl).match(/(?:[?&](?:page|paged)=|\/page\/)(\d+)/i);
  var currentNumber = current ? parseInt(current[1],10) : 1, next = "";
  $("a[rel=next], .pagination a[href], .wp-pagenavi a[href], .page-numbers[href]").each(function (_,element) {
    var a = wrap($,element), url = absUrl(a.attr("href"),pageUrl);
    if (originOf(url) !== originOf(pageUrl)) return;
    var number = url.match(/(?:[?&](?:page|paged)=|\/page\/)(\d+)/i);
    if (number && parseInt(number[1],10) === currentNumber + 1) next = url;
  });
  return next;
}

function extraLastCatalogPage(html, pageUrl, requests) {
  var $ = cheerio.load(html), target = 0, minimum = Infinity, last = "", highest = -1;
  for (var r = 0; r < requests.length; r++) if (requests[r].season === 1 && (!target || requests[r].episode < target)) target = requests[r].episode;
  if (!target) return "";
  $("a[href]").each(function (_,element) {
    var a = wrap($,element), url = absUrl(a.attr("href"),pageUrl);
    if (originOf(url) !== originOf(pageUrl)) return;
    var number = extraEpisodeNumber(extraAnchorIdentity(a));
    if (number && number < minimum) minimum = number;
  });
  if (!(minimum > target && minimum < Infinity)) return "";
  $(".pagination a[href], .wp-pagenavi a[href], .page-numbers[href]").each(function (_,element) {
    var url = absUrl(wrap($,element).attr("href"),pageUrl), number = url.match(/(?:[?&](?:page|paged)=|\/page\/)(\d+)/i);
    if (originOf(url) === originOf(pageUrl) && number && parseInt(number[1],10) > highest) {highest=parseInt(number[1],10);last=url;}
  });
  return last;
}

function phpCategorySeason(url) {
  var match = String(url || "").match(/[?&]cat=[^&]*-s(\d{1,2})(?:[&#]|$)/i);
  return match ? parseInt(match[1], 10) : 0;
}

function phpCategoryPageUrl(url, pageNumber) {
  var clean = String(url || "").replace(/([?&])page=\d+/i, "$1").replace(/[?&#]+$/, "");
  if (!clean || pageNumber <= 1) return clean;
  return clean + (clean.indexOf("?") >= 0 ? "&" : "?") + "page=" + pageNumber;
}

function phpWatchLinks(html, pageUrl, metadata, requests) {
  var $ = cheerio.load(html), links = [], seen = {};
  $("a[href]").each(function (_, element) {
    var a = wrap($, element), url = absUrl(a.attr("href"), pageUrl);
    if (!url || originOf(url) !== originOf(pageUrl) || !/\/watch\.php\?vid=/i.test(url)) return;
    var identity = extraAnchorIdentity(a);
    if (fieldMatchScore(identity, metadata.titles) < 80) return;
    var key = extraUrlKey(url);
    if (seen[key]) return;
    seen[key] = true;
    links.push({ url: url, request: extraRequestMatch(identity, requests), referer: pageUrl });
  });
  return links;
}

function phpCategoryLinks(html, pageUrl, metadata) {
  var $ = cheerio.load(html), links = [], seen = {};
  $("a[href]").each(function (_, element) {
    var a = wrap($, element), url = absUrl(a.attr("href"), pageUrl);
    if (!url || originOf(url) !== originOf(pageUrl) || !/\/category\.php\?cat=/i.test(url)) return;
    if (fieldMatchScore(extraAnchorIdentity(a), metadata.titles) < 80) return;
    var key = extraUrlKey(url);
    if (seen[key]) return;
    seen[key] = true;
    links.push({ url: url, label: extraAnchorIdentity(a) });
  });
  return links;
}

function resolvePhpCategoryArchive(metadata, source, requests) {
  var MAX_SEARCH_QUERIES = 4, MAX_CATEGORY_PAGES = 6, bases = source.bases || [], baseIndex = 0;
  function nextBase() {
    if (baseIndex >= bases.length) return Promise.resolve([]);
    var base = bases[baseIndex++];
    var queries = extraSearchRequests(metadata, source, base, requests).slice(0, MAX_SEARCH_QUERIES);
    return Promise.all(queries.map(function (request) {
      return extraFetchCatalog(request, base + "/").catch(function (error) {
        logFailure("php_search_failed", source.name + " " + errorMessage(error)); return null;
      });
    })).then(function (pages) {
      pages = pages.filter(Boolean);
      var families = [], seenFamily = {};
      for (var p = 0; p < pages.length; p++) {
        var links = phpWatchLinks(pages[p].html, pages[p].url, metadata, requests);
        for (var l = 0; l < links.length && families.length < 2; l++) {
          if (seenFamily[links[l].url]) continue;
          seenFamily[links[l].url] = true;
          families.push(links[l]);
        }
      }
      return Promise.all(families.map(function (family) {
        return fetchTextInfo(family.url, base + "/", "").catch(function () { return null; });
      }));
    }).then(function (familyPages) {
      familyPages = familyPages.filter(Boolean);
      var categories = [], seenCategory = {};
      for (var p = 0; p < familyPages.length; p++) {
        var found = phpCategoryLinks(familyPages[p].html, familyPages[p].url, metadata);
        for (var c = 0; c < found.length; c++) {
          var key = extraUrlKey(found[c].url);
          if (seenCategory[key]) continue;
          seenCategory[key] = true;
          categories.push(found[c]);
        }
      }
      if (!categories.length) return [];
      var seasons = {}, i;
      for (i = 0; i < requests.length; i++) seasons[requests[i].season] = true;
      categories.sort(function (left, right) {
        var leftSeason = phpCategorySeason(left.url), rightSeason = phpCategorySeason(right.url);
        var leftRank = leftSeason ? (seasons[leftSeason] ? 3 : 0) : 1;
        var rightRank = rightSeason ? (seasons[rightSeason] ? 3 : 0) : 1;
        return rightRank - leftRank;
      });
      categories = categories.slice(0, 4);
      var categoryIndex = 0;
      function nextCategory() {
        if (categoryIndex >= categories.length) return Promise.resolve([]);
        var category = categories[categoryIndex++], pageNumber = 1, seenPages = {};
        function nextPage() {
          if (pageNumber > MAX_CATEGORY_PAGES) return nextCategory();
          var pageUrl = phpCategoryPageUrl(category.url, pageNumber++);
          if (!pageUrl || seenPages[pageUrl]) return nextCategory();
          seenPages[pageUrl] = true;
          return fetchTextInfo(pageUrl, category.url, "").catch(function () { return null; }).then(function (page) {
            if (!page) return nextCategory();
            var matching = phpWatchLinks(page.html, page.url, metadata, requests).filter(function (link) {
              return !!link.request;
            });
            if (!matching.length) return nextPage();
            var candidateIndex = 0;
            function nextCandidate() {
              if (candidateIndex >= matching.length) return nextPage();
              var candidate = matching[candidateIndex++];
              return extraResolveEpisode({ url: candidate.url }, metadata, requests, page.url).then(function (streams) {
                return streams.length ? streams : nextCandidate();
              });
            }
            return nextCandidate();
          });
        }
        return nextPage().then(function (streams) { return streams.length ? streams : nextCategory(); });
      }
      return nextCategory();
    }).then(function (streams) { return streams.length ? streams : nextBase(); });
  }
  return nextBase();
}

var EXTRA_QUERY_STOPWORDS = {
  "ما": 1, "هو": 1, "هي": 1, "هم": 1, "في": 1, "من": 1, "على": 1, "عن": 1,
  "الى": 1, "مع": 1, "او": 1, "و": 1, "يا": 1, "كل": 1, "هذا": 1, "هذه": 1,
  "التي": 1, "التى": 1, "ذلك": 1, "قصة": 1, "قصه": 1, "عشق": 1, "مسلسل": 1,
  "المسلسل": 1, "الحلقة": 1, "الحلقه": 1, "حلقة": 1, "حلقه": 1, "مترجم": 1,
  "مترجمة": 1, "مترجمه": 1, "مدبلج": 1, "مدبلجة": 1, "مدبلجه": 1, "كامل": 1,
  "كاملة": 1, "كامله": 1, "جميع": 1, "الحلقات": 1, "الاول": 1, "الاولى": 1,
  "الثاني": 1, "الثانية": 1, "الثالث": 1, "الرابع": 1, "الخامس": 1
};

function extraQueryTitles(metadata) {
  var base = typeof catalogSearchTitles === "function" ? catalogSearchTitles(metadata) : metadata.titles || [];
  var result = [], seen = {};
  function add(title) {
    var value = String(title || "").replace(/\s+/g, " ").trim();
    if (!value || seen[value]) return;
    seen[value] = true;
    result.push(value);
  }
  var i;
  for (i = 0; i < base.length && i < 8; i++) add(base[i]);
  var variants = 0;
  for (i = 0; i < base.length && variants < 4; i++) {
    var original = String(base[i] || "");
    if (!/^[\u0600-\u06ff]/.test(original)) continue;
    var words = original.split(" ");
    if (!words[0]) continue;
    var variant = words.slice(0);
    if (words[0].indexOf("\u0627\u0644") === 0 && words[0].length > 3) variant[0] = words[0].slice(2);
    else if (words[0].length >= 3) variant[0] = "\u0627\u0644" + words[0];
    else continue;
    add(variant.join(" "));
    variants++;
  }
  var added = 0;
  for (i = 0; i < base.length && added < 6; i++) {
    var title = String(base[i] || "");
    if (!/[\u0600-\u06ff]/.test(title)) continue;
    var words = title.replace(/[^\u0600-\u06ff\s]/g, " ").split(" ");
    for (var w = 0; w < words.length && added < 6; w++) {
      var word = words[w];
      if (!/^[\u0600-\u06ff]{3,}$/.test(word) || EXTRA_QUERY_STOPWORDS[normalize(word)] || seen[word]) continue;
      seen[word] = true;
      result.push(word);
      added++;
    }
  }
  return result.slice(0, 12);
}

function qesehSearchQueries(metadata) {
  return extraQueryTitles(metadata).slice(0, 10);
}

function qesehSeriesLinks(html, pageUrl, metadata) {
  var $ = cheerio.load(html), links = [], seen = {};
  $("a[href]").each(function (_, element) {
    var a = wrap($, element), url = absUrl(a.attr("href"), pageUrl);
    if (!url || originOf(url) !== originOf(pageUrl) || !/\/yeni-show\//i.test(url)) return;
    var identity = extraAnchorIdentity(a);
    if (fieldMatchScore(identity + " " + url, metadata.titles) < 80 &&
        !(typeof catalogTitleMatches === "function" && catalogTitleMatches(identity, metadata.titles))) return;
    var key = extraUrlKey(url);
    if (seen[key]) return;
    seen[key] = true;
    links.push({ url: url, title: identity.replace(/\s+/g, " ").trim() });
  });
  return links.slice(0, 3);
}

function qesehEpisodeLinks(html, pageUrl, requests, seriesTitle) {
  var $ = cheerio.load(html), found = [], seen = {};
  $("a[href]").each(function (_, element) {
    var a = wrap($, element), url = absUrl(a.attr("href"), pageUrl);
    if (!url || originOf(url) !== originOf(pageUrl) || !/\/clarus\/[^\/?]+-episode-(\d+)\/?$/i.test(url)) return;
    var match = url.match(/-episode-(\d+)\/?$/i), number = parseInt(match[1], 10);
    if (!number) return;
    var identity = extraAnchorIdentity(a) + " " + url;
    var request = extraRequestMatch(identity + " الحلقة " + number, requests);
    if (!request) return;
    var key = extraUrlKey(url);
    if (seen[key]) return;
    seen[key] = true;
    found.push({ url: url, request: request, referer: pageUrl, seriesTitle: seriesTitle });
  });
  return found.slice(0, 3);
}

function qesehPlayerUrl(html, pageUrl) {
  var $ = cheerio.load(html), player = "";
  $("a[href]").each(function (_, element) {
    var url = absUrl(wrap($, element).attr("href"), pageUrl);
    if (!player && /^https:\/\/qesen\.net\/watch\/?\?post=/i.test(url)) player = url;
  });
  if (!player) {
    $("iframe[src]").each(function (_, element) {
      var url = absUrl(wrap($, element).attr("src"), pageUrl);
      if (!player && /^https:\/\/qesen\.net\//i.test(url)) player = url;
    });
  }
  return player;
}

function qesehEmbedUrls(html, pageUrl) {
  var $ = cheerio.load(html), urls = [], seen = {};
  function add(value) {
    var url = absUrl(value, pageUrl);
    if (!url || seen[url] || !/^https:\/\/arabhd\.onl\/embed-[a-z0-9]+\.html/i.test(url)) return;
    seen[url] = true;
    urls.push(url);
  }
  $("iframe[src], iframe[data-src]").each(function (_, element) {
    var frame = wrap($, element);
    add(frame.attr("src") || frame.attr("data-src"));
  });
  $("li[data-server]").each(function (_, element) { add(wrap($, element).attr("data-server")); });
  return urls.slice(0, 2);
}

function extraSlugAlias(url, titles) {
  var tokens = String(url || "").toLowerCase().split(/[^a-z0-9]+/).filter(function (token) {
    return token.length >= 5;
  });
  if (!tokens.length) return false;
  for (var i = 0; i < titles.length; i++) {
    var words = normalize(titles[i]).split(" ").filter(function (word) {
      return /^[a-z0-9]{5,}$/.test(word);
    });
    for (var w = 0; w < words.length; w++) if (tokens.indexOf(words[w]) >= 0) return true;
  }
  return false;
}

function qesehCatalogFallback(base, metadata, requests) {
  var pageUrls = [], page;
  for (page = 1; page <= 8; page++) {
    pageUrls.push(page === 1 ? base + "/discover/" : base + "/discover/page/" + page + "/");
  }
  return Promise.all(pageUrls.map(function (url) {
    return fetchTextInfo(url, base + "/", "").catch(function () { return null; });
  })).then(function (pages) {
    var candidates = [], seen = {};
    for (var p = 0; p < pages.length; p++) {
      if (!pages[p]) continue;
      var $ = cheerio.load(pages[p].html);
      $("a[href]").each(function (_, element) {
        var a = wrap($, element), url = absUrl(a.attr("href"), pages[p].url);
        if (!url || originOf(url) !== originOf(pages[p].url) || !/\/yeni-show\//i.test(url)) return;
        var key = extraUrlKey(url);
        if (seen[key]) return;
        var identity = extraAnchorIdentity(a);
        var strong = fieldMatchScore(identity, metadata.titles) >= 80 ||
          (typeof catalogTitleMatches === "function" && catalogTitleMatches(identity, metadata.titles));
        if (!strong && !extraSlugAlias(url, metadata.titles)) return;
        seen[key] = true;
        candidates.push({ url: url, title: identity.replace(/\s+/g, " ").trim(), weak: !strong });
      });
    }
    if (!candidates.length) return [];
    candidates.sort(function (left, right) { return (left.weak ? 1 : 0) - (right.weak ? 1 : 0); });
    return Promise.all(candidates.slice(0, 3).map(function (entry) {
      return fetchTextInfo(entry.url, base + "/", "").catch(function () { return null; }).then(function (result) {
        if (!result) return null;
        var heading = cheerio.load(result.html)("h1").first().text() || entry.title;
        return { html: result.html, url: result.url, title: heading };
      });
    })).then(function (seriesPages) {
      seriesPages = seriesPages.filter(Boolean);
      var episodes = [], seenEpisodes = {};
      for (var sp = 0; sp < seriesPages.length; sp++) {
        var list = qesehEpisodeLinks(seriesPages[sp].html, seriesPages[sp].url, requests, seriesPages[sp].title);
        for (var e = 0; e < list.length; e++) {
          var episodeKey = extraUrlKey(list[e].url);
          if (seenEpisodes[episodeKey]) continue;
          seenEpisodes[episodeKey] = true;
          list[e].seriesTitle = seriesPages[sp].title;
          episodes.push(list[e]);
        }
      }
      return Promise.all(episodes.slice(0, 3).map(function (episode) {
        return fetchTextInfo(episode.url, episode.referer, "").catch(function () { return null; }).then(function (result) {
          if (!result) return [];
          var identity = extraPageIdentity(result.html);
          if (extraEpisodeNumber(identity + " " + result.url) !== episode.request.episode) return [];
          var titleOk = extraPageTitleMatches(result.html, metadata);
          if (!titleOk && episode.seriesTitle) titleOk = catalogTitleMatches(identity, [episode.seriesTitle]);
          if (!titleOk) return [];
          var playerUrl = qesehPlayerUrl(result.html, result.url);
          if (!playerUrl) return [];
          return fetchTextInfo(playerUrl, result.url, "").catch(function () { return null; }).then(function (player) {
            if (!player) return [];
            var embeds = qesehEmbedUrls(player.html, player.url);
            if (!embeds.length) return [];
            var streams = [], seenStreams = {};
            return Promise.all(embeds.map(function (embedUrl) {
              return fetchTextInfo(embedUrl, player.url, "").catch(function () { return null; }).then(function (embed) {
                if (!embed) return;
                var entries = mediaEntriesFromHtml(embed.html);
                return Promise.all(entries.map(function (entry) {
                  return addMediaEntry(entry, embed.url, "Arab HD", streams, seenStreams);
                }));
              });
            })).then(function () { return streams; });
          });
        });
      })).then(function (parts) {
        var result = [];
        for (var i = 0; i < parts.length; i++) result = result.concat(parts[i]);
        return result;
      });
    });
  });
}

function resolveQesehSource(metadata, source, requests) {
  var bases = source.bases || [], baseIndex = 0;
  function nextBase() {
    if (baseIndex >= bases.length) return Promise.resolve([]);
    var base = bases[baseIndex++];
    var queries = qesehSearchQueries(metadata);
    return Promise.all(queries.map(function (title) {
      return fetchTextInfo(base + "/?s=" + encodeURIComponent(title), base + "/", "").catch(function () { return null; });
    })).then(function (pages) {
      var series = [], seen = {};
      for (var p = 0; p < pages.length; p++) {
        if (!pages[p]) continue;
        var links = qesehSeriesLinks(pages[p].html, pages[p].url, metadata);
        for (var i = 0; i < links.length; i++) {
          var key = extraUrlKey(links[i].url);
          if (seen[key]) continue;
          seen[key] = true;
          series.push(links[i]);
        }
      }
      return Promise.all(series.slice(0, 2).map(function (entry) {
        return fetchTextInfo(entry.url, base + "/", "").catch(function () { return null; }).then(function (page) {
          if (!page) return null;
          var heading = cheerio.load(page.html)("h1").first().text() || entry.title;
          return { html: page.html, url: page.url, title: heading };
        });
      }));
    }).then(function (seriesPages) {
      seriesPages = seriesPages.filter(Boolean);
      var episodes = [], seenEpisodes = {};
      for (var p = 0; p < seriesPages.length; p++) {
        var list = qesehEpisodeLinks(seriesPages[p].html, seriesPages[p].url, requests, seriesPages[p].title);
        for (var i = 0; i < list.length; i++) {
          var key = extraUrlKey(list[i].url);
          if (seenEpisodes[key]) continue;
          seenEpisodes[key] = true;
          list[i].seriesTitle = seriesPages[p].title;
          episodes.push(list[i]);
        }
      }
      return Promise.all(episodes.slice(0, 3).map(function (episode) {
        return fetchTextInfo(episode.url, episode.referer, "").catch(function () { return null; }).then(function (page) {
          if (!page) return [];
          var identity = extraPageIdentity(page.html);
          if (extraEpisodeNumber(identity + " " + page.url) !== episode.request.episode) return [];
          var titleOk = extraPageTitleMatches(page.html, metadata);
          if (!titleOk && episode.seriesTitle) titleOk = catalogTitleMatches(identity, [episode.seriesTitle]);
          if (!titleOk) return [];
          var playerUrl = qesehPlayerUrl(page.html, page.url);
          if (!playerUrl) return [];
          return fetchTextInfo(playerUrl, page.url, "").catch(function () { return null; }).then(function (player) {
            if (!player) return [];
            var embeds = qesehEmbedUrls(player.html, player.url);
            if (!embeds.length) return [];
            var streams = [], seenStreams = {};
            return Promise.all(embeds.map(function (embedUrl) {
              return fetchTextInfo(embedUrl, player.url, "").catch(function () { return null; }).then(function (embed) {
                if (!embed) return;
                var entries = mediaEntriesFromHtml(embed.html);
                return Promise.all(entries.map(function (entry) {
                  return addMediaEntry(entry, embed.url, "Arab HD", streams, seenStreams);
                }));
              });
            })).then(function () { return streams; });
          });
        });
      })).then(function (parts) {
        var result = [];
        for (var i = 0; i < parts.length; i++) result = result.concat(parts[i]);
        return result;
      });
    }).then(function (streams) {
      if (streams.length) return streams;
      return qesehCatalogFallback(base, metadata, requests);
    }).then(function (streams) { return streams.length ? streams : nextBase(); });
  }
  return nextBase().then(function (streams) {
    var result = [], seen = {};
    for (var i = 0; i < streams.length; i++) {
      if (seen[streams[i].url]) continue;
      seen[streams[i].url] = true;
      streams[i].name = String(streams[i].name || "Krmizi").replace(/^Krmizi/, source.name);
      streams[i].title = String(streams[i].title || "Krmizi").replace(/^Krmizi/, source.name);
      streams[i].provider = source.name;
      streams[i].language = "ar";
      result.push(streams[i]);
    }
    return result;
  });
}

function faselhdEpisodeNumber(url, identity) {
  var decoded = String(url || "");
  try { decoded = decodeURIComponent(decoded); } catch (_) {}
  var match = decoded.match(/الحلقة[\s\-_]*(\d{1,4})/i) || decoded.match(/الحلقه[\s\-_]*(\d{1,4})/i);
  if (match) return parseInt(match[1], 10);
  match = String(identity || "").match(/^\s*(\d{1,4})\b/);
  return match ? parseInt(match[1], 10) : NaN;
}

function faselhdSeriesLinks(html, pageUrl, metadata) {
  var $ = cheerio.load(html), links = [], seen = {};
  $("a[href]").each(function (_, element) {
    var a = wrap($, element), url = absUrl(a.attr("href"), pageUrl);
    if (!url || originOf(url) !== originOf(pageUrl) || !/\/series\//i.test(url)) return;
    var identity = extraAnchorIdentity(a);
    if (fieldMatchScore(identity, metadata.titles) < 80 &&
        !(typeof catalogTitleMatches === "function" && catalogTitleMatches(identity, metadata.titles))) return;
    var key = extraUrlKey(url);
    if (seen[key]) return;
    seen[key] = true;
    links.push({ url: url, identity: identity.replace(/\s+/g, " ").trim() });
  });
  return links.slice(0, 4);
}

function faselhdEpisodeLinks(html, pageUrl, requests) {
  var $ = cheerio.load(html), episodes = [], seen = {};
  $("a[href]").each(function (_, element) {
    var a = wrap($, element), url = absUrl(a.attr("href"), pageUrl);
    if (!url || originOf(url) !== originOf(pageUrl) || !/\/episode\//i.test(url)) return;
    var identity = extraAnchorIdentity(a);
    var number = faselhdEpisodeNumber(url, identity);
    if (!number) return;
    var request = extraRequestMatch(identity + " " + url + " الحلقة " + number, requests);
    if (!request) return;
    var key = extraUrlKey(url);
    if (seen[key]) return;
    seen[key] = true;
    episodes.push({ url: url, request: request, referer: pageUrl });
  });
  return episodes.slice(0, 3);
}

function faselhdPlayerTargets(html, pageUrl) {
  var $ = cheerio.load(html), targets = [], seen = {};
  function add(value) {
    var url = absUrl(value, pageUrl);
    if (!url || seen[url]) return;
    if (!supportedDirectEmbed(url) && !directMedia(url) && !anaPlayerAllowed(url) && !dailymotionId(url)) return;
    seen[url] = true;
    targets.push(url);
  }
  $("iframe[src], iframe[data-src]").each(function (_, element) {
    var frame = wrap($, element);
    add(frame.attr("src") || frame.attr("data-src"));
  });
  $("video[src], video source[src]").each(function (_, element) {
    add(wrap($, element).attr("src"));
  });
  return targets.slice(0, 4);
}

function resolveFaselhdSource(metadata, source, requests) {
  var bases = source.bases || [], baseIndex = 0;
  function nextBase() {
    if (baseIndex >= bases.length) return Promise.resolve([]);
    var base = bases[baseIndex++];
    var catalogUrls = [
      base + "/?fho_cat=turkish-series",
      base + "/?fho_cat=turkish-series&fho_page=2",
      base + "/?fho_cat=turkish-series&fho_page=3"
    ];
    return Promise.all(catalogUrls.map(function (url) {
      return fetchTextInfo(url, base + "/", "").catch(function () { return null; });
    })).then(function (pages) {
      var series = [], seen = {};
      for (var p = 0; p < pages.length; p++) {
        if (!pages[p]) continue;
        var links = faselhdSeriesLinks(pages[p].html, pages[p].url, metadata);
        for (var i = 0; i < links.length; i++) {
          var key = extraUrlKey(links[i].url);
          if (seen[key]) continue;
          seen[key] = true;
          series.push(links[i]);
        }
      }
      return Promise.all(series.slice(0, 3).map(function (entry) {
        return fetchTextInfo(entry.url, base + "/", "").catch(function () { return null; }).then(function (page) {
          if (!page) return [];
          var identity = extraPageIdentity(page.html);
          if (!extraPageTitleMatches(page.html, metadata) &&
              !(typeof catalogTitleMatches === "function" && catalogTitleMatches(identity, metadata.titles))) return [];
          var episodes = faselhdEpisodeLinks(page.html, page.url, requests);
          return Promise.all(episodes.slice(0, 2).map(function (episode) {
            return fetchTextInfo(episode.url, page.url, "").catch(function () { return null; }).then(function (episodePage) {
              if (!episodePage) return [];
              var episodeIdentity = extraPageIdentity(episodePage.html);
              if (!extraPageTitleMatches(episodePage.html, metadata) || /مدبلج|dubbed|dublaj/i.test(episodeIdentity)) return [];
              if (!extraRequestMatch(episodeIdentity + " " + episodePage.url, requests) || extraEpisodeNumber(episodeIdentity + " " + episodePage.url) !== episode.request.episode) return [];
              var targets = faselhdPlayerTargets(episodePage.html, episodePage.url);
              var streams = [], seenStreams = {};
              return Promise.all(targets.map(function (target) {
                return resolveEmbedTarget({ url: target, referer: episodePage.url, label: "Main" }, episode.request, streams, seenStreams);
              })).then(function () { return streams; });
            });
          })).then(function (parts) {
            var result = [];
            for (var i = 0; i < parts.length; i++) result = result.concat(parts[i]);
            return result;
          });
        });
      })).then(function (parts) {
        var result = [];
        for (var i = 0; i < parts.length; i++) result = result.concat(parts[i]);
        return result;
      });
    }).then(function (streams) { return streams.length ? streams : nextBase(); });
  }
  return nextBase().then(function (streams) {
    var result = [], seen = {};
    for (var i = 0; i < streams.length; i++) {
      if (seen[streams[i].url]) continue;
      seen[streams[i].url] = true;
      streams[i].name = String(streams[i].name || "Krmizi").replace(/^Krmizi/, source.name);
      streams[i].title = String(streams[i].title || "Krmizi").replace(/^Krmizi/, source.name);
      streams[i].provider = source.name;
      streams[i].language = "ar";
      result.push(streams[i]);
    }
    return result;
  });
}

function dailymotionSearchQuery(title, episode) {
  var clean = String(title || "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  if (/[\u0600-\u06ff]/.test(clean)) return clean + " الحلقة " + episode + " مترجم";
  return clean + " episode " + episode + " arabic sub";
}

function dailymotionVideoId(url) {
  var match = String(url || "").match(/dailymotion\.com\/video\/([A-Za-z0-9]+)/i);
  return match ? match[1] : "";
}

function dailymotionArabicCandidate(video, metadata, requests) {
  var title = String(video && video.title || ""), description = String(video && video.description || "");
  var evidence = title + " " + description;
  if (/مدبلج|dublaj|dubbed|english[\s_-]*(?:sub|subtitle)|eng[\s_-]*sub|ترجم[ةه]\s+انجليزي/i.test(evidence)) return null;
  if (/اعلان|إعلان|ملخص|مقطع|trailer|fragman|teaser|promo/i.test(title) || Number(video.duration) < 1200) return null;
  var arabicClaim = /(?:arabic[\s_-]*(?:sub|subtitle)|(?:sub|subtitle)[\s_-]*arabic|بالعربي[ةه]?|ترجم[ةه]\s+عربي[ةه]?)/i.test(evidence) ||
    (/[\u0600-\u06ff]/.test(title) && /مترجم[ةه]?/.test(title));
  if (!arabicClaim) return null;
  var ownTitle = title.replace(/\b(?:arabic[\s_-]*(?:subs?|subtitles?)|(?:subs?|subtitles?)[\s_-]*arabic)\b/ig," ").replace(/بالعربي[ةه]?/g," ");
  if (!catalogTitleMatches(ownTitle,metadata.titles)) return null;
  return extraRequestMatch(title,requests);
}

function resolveDailymotionSource(metadata, source, requests) {
  var titles = extraQueryTitles(metadata).slice(0, 6);
  var queries = [], seenQuery = {};
  for (var t = 0; t < titles.length && queries.length < 6; t++) {
    for (var r = 0; r < requests.length && queries.length < 6; r++) {
      var query = dailymotionSearchQuery(titles[t], requests[r].episode);
      if (!query || seenQuery[query]) continue;
      seenQuery[query] = true;
      queries.push({ query: query, request: requests[r] });
    }
  }
  if (!queries.length) return Promise.resolve([]);
  return Promise.all(queries.map(function (entry) {
    var url = "https://api.dailymotion.com/videos?search=" + encodeURIComponent(entry.query) +
      "&limit=20&sort=relevance&fields=id,title,description,duration,url";
    return fetchJson(url, "https://www.dailymotion.com/", "https://www.dailymotion.com")
      .catch(function () { return null; })
      .then(function (data) { return { videos: data && data.list || [], request: entry.request }; });
  })).then(function (groups) {
    var candidates = [], seen = {};
    for (var g = 0; g < groups.length; g++) {
      var videos = groups[g].videos, request = groups[g].request;
      for (var v = 0; v < videos.length; v++) {
        var video = videos[v];
        if (!video || !video.id || seen[video.id]) continue;
        var title = String(video.title || "");
        if (!title) continue;
        var matchedRequest = dailymotionArabicCandidate(video,metadata,[request]);
        if (!matchedRequest) continue;
        seen[video.id] = true;
        candidates.push({ id: video.id, title: title, request: matchedRequest });
      }
    }
    candidates = candidates.slice(0, 9);
    var streams = [], seenStreams = {}, offset = 0;
    function nextCandidates() {
      var batch = candidates.slice(offset,offset + 3); offset += 3;
      if (!batch.length) return Promise.resolve(streams);
      return Promise.all(batch.map(function(candidate) {
        var url = "https://www.dailymotion.com/video/" + candidate.id;
        return resolveDailymotion(url,"https://www.dailymotion.com/","Main",streams,seenStreams).catch(function(){});
      })).then(function(){return streams.length ? streams : nextCandidates();});
    }
    return nextCandidates();
  }).then(function (streams) {
    var result = [], seen = {};
    for (var i = 0; i < streams.length; i++) {
      if (seen[streams[i].url]) continue;
      seen[streams[i].url] = true;
      streams[i].name = String(streams[i].name || "Krmizi").replace(/^Krmizi/, source.name);
      streams[i].title = String(streams[i].title || "Krmizi").replace(/^Krmizi/, source.name);
      streams[i].provider = source.name;
      streams[i].language = "ar";
      result.push(streams[i]);
    }
    return result;
  }).catch(function () { return []; });
}

function okruHtmlDecode(value) {
  return String(value || "")
    .replace(/&quot;/gi, "\"")
    .replace(/&#0*34;/gi, "\"")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#0*39;|&apos;/gi, "'");
}

function okruEpisodeNumber(title) {
  var number = extraEpisodeNumber(title);
  if (number) return number;
  var match = String(title || "").match(/(\d{1,3})\s*[-–—]\s*(\d{1,3})\b/);
  if (match) return parseInt(match[2], 10);
  match = String(title || "").match(/(?:^|\s)(\d{1,3})\s*(?:\.|$)/);
  return match ? parseInt(match[1], 10) : NaN;
}

function okruMediaUrl(html) {
  var decoded = okruHtmlDecode(html);
  var match = decoded.match(/"hlsManifestUrl":"(https?:\/\/[^"]+)"/);
  var url = match ? match[1] : "";
  if (!url) match = decoded.match(/"metadataMp4Url":"(https?:\/\/[^"]+)"/);
  if (!url && match) url = match[1];
  return url ? url.replace(/\\u0026/gi, "&").replace(/\\\//g, "/") : "";
}

function resolveOkruSource(metadata, source, requests) {
  var titles = extraQueryTitles(metadata).slice(0, 5);
  var queries = [], seenQuery = {};
  for (var r = 0; r < requests.length && queries.length < 4; r++) {
    for (var t = 0; t < titles.length && queries.length < 4; t++) {
      var title = String(titles[t] || "").trim();
      if (!title) continue;
      var query = /[\u0600-\u06ff]/.test(title) ? title + " الحلقة " + requests[r].episode + " مترجم" : title + " " + requests[r].episode + " arabic";
      if (seenQuery[query]) continue;
      seenQuery[query] = true;
      queries.push({ query: query, request: requests[r] });
    }
  }
  if (!queries.length) return Promise.resolve([]);
  return Promise.all(queries.map(function (entry) {
    var url = "https://ok.ru/video/search?st.v.sq=" + encodeURIComponent(entry.query);
    return fetchTextInfo(url, "https://ok.ru/", "").catch(function () { return null; }).then(function (page) {
      if (!page) return { ids: [], request: entry.request };
      var ids = [], seen = {};
      var re = /\/video\/(\d{8,})/g, match;
      while ((match = re.exec(page.html)) !== null && ids.length < 6) {
        if (seen[match[1]]) continue;
        seen[match[1]] = true;
        ids.push(match[1]);
      }
      return { ids: ids, request: entry.request };
    });
  })).then(function (groups) {
    var candidates = [], seenIds = {};
    for (var g = 0; g < groups.length; g++) {
      for (var i = 0; i < groups[g].ids.length && candidates.length < 6; i++) {
        var id = groups[g].ids[i];
        if (seenIds[id]) continue;
        seenIds[id] = true;
        candidates.push({ id: id, request: groups[g].request });
      }
    }
    return Promise.all(candidates.slice(0, 6).map(function (candidate) {
      var pageUrl = "https://ok.ru/video/" + candidate.id;
      return fetchTextInfo(pageUrl, "https://ok.ru/", "").catch(function () { return null; }).then(function (page) {
        if (!page) return [];
        var title = (page.html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || "";
        title = okruHtmlDecode(title).replace(/\s+/g, " ").trim();
        if (!title) return [];
        if (fieldMatchScore(title, metadata.titles) < 80 && !catalogTitleMatches(title, metadata.titles)) return [];
        if (/مدبلج|dublaj|dubbed/i.test(title)) return [];
        var explicit = explicitSeasonEpisode(title);
        if (explicit && explicit.season !== candidate.request.season) return [];
        var number = okruEpisodeNumber(title);
        if (number !== candidate.request.episode) return [];
        var mediaUrl = okruMediaUrl(page.html);
        if (!mediaUrl) return [];
        var streams = [], seenStreams = {};
        return addMediaEntry({ url: mediaUrl, quality: "" }, pageUrl, "Main", streams, seenStreams).then(function () { return streams; });
      });
    })).then(function (parts) {
      var result = [];
      for (var i = 0; i < parts.length; i++) result = result.concat(parts[i]);
      return result;
    });
  }).then(function (streams) {
    var result = [], seen = {};
    for (var i = 0; i < streams.length; i++) {
      if (seen[streams[i].url]) continue;
      seen[streams[i].url] = true;
      streams[i].name = String(streams[i].name || "Krmizi").replace(/^Krmizi/, source.name);
      streams[i].title = String(streams[i].title || "Krmizi").replace(/^Krmizi/, source.name);
      streams[i].provider = source.name;
      streams[i].language = "ar";
      result.push(streams[i]);
    }
    return result;
  }).catch(function () { return []; });
}

function resolveExtraSource(metadata, source, requests) {
  if (source.search === "3ick") return resolve3ickSource(metadata, source, requests);
  if (source.search === "qeseh") return resolveQesehSource(metadata, source, requests);
  if (source.search === "faselhd") return resolveFaselhdSource(metadata, source, requests);
  if (source.search === "dailymotion") return resolveDailymotionSource(metadata, source, requests);
  if (source.search === "okru") return resolveOkruSource(metadata, source, requests);
  var bases = source.bases || [], baseIndex = 0, triedBases = {};
  function nextBase() {
    while (baseIndex < bases.length && triedBases[bases[baseIndex]]) baseIndex++;
    if (baseIndex >= bases.length) return Promise.resolve([]);
    var base = bases[baseIndex++];triedBases[base] = true;
    var seenPages = {}, seenEpisodes = {};
    function fetchPages(requestsToFetch) {
      return Promise.all(requestsToFetch.map(function (request) {
        var key = request.url + " " + (request.body || "");
        if (seenPages[key]) return Promise.resolve(null);
        seenPages[key] = true;
        return extraFetchCatalog(request,base + "/").catch(function (error) {
          logFailure("extra_catalog_failed",source.name + " " + errorMessage(error));return null;
        });
      }));
    }
    function scan(pages, depth) {
      var episodes = [], series = [], pagination = [], seenSeries = {};
      for (var p = 0; p < pages.length; p++) {
        var page = pages[p]; if (!page) continue;
        var self = extraPageIdentity(page.html);
        var seriesVerified = extraPageTitleMatches(page.html,metadata) && !extraEpisodeNumber(self);
        var links = extraCatalogLinks(page.html,page.url,metadata,requests,seriesVerified);
        for (var i = 0; i < links.length; i++) {
          if (links[i].request && !seenEpisodes[extraUrlKey(links[i].url)]) {
            seenEpisodes[extraUrlKey(links[i].url)] = true;
            episodes.push({candidate:links[i],referer:page.url});
          } else if (!links[i].request && !seenSeries[extraUrlKey(links[i].url)]) {
            seenSeries[extraUrlKey(links[i].url)] = true;series.push({url:links[i].url});
          }
        }
        var last = extraLastCatalogPage(page.html,page.url,requests);
        if (last && extraUrlKey(last) !== extraUrlKey(page.url)) pagination.push({url:last});
        var next = extraNextCatalogPage(page.html,page.url);
        if (next && next !== last) pagination.push({url:next});
      }
      return Promise.all(episodes.slice(0,4).map(function (item) {
        return extraResolveEpisode(item.candidate,metadata,requests,item.referer);
      })).then(function (parts) {
        var result = [];for (var n = 0; n < parts.length; n++) result = result.concat(parts[n]);
        if (result.length || depth >= 3) return result;
        var nextRequests = series.slice(0,3).concat(pagination.slice(0,2));
        if (!nextRequests.length) return [];
        return fetchPages(nextRequests).then(function (nextPages) {return scan(nextPages,depth + 1);});
      });
    }
    return fetchPages([{url:base + "/"}]).then(function (pages) {
      if (pages[0] && originOf(pages[0].url)) {base=originOf(pages[0].url);triedBases[base]=true;}
      return scan(pages,0);
    }).then(function (streams) {
      if (streams.length) return streams;
      return fetchPages(extraSearchRequests(metadata,source,base,requests)).then(function (pages) {return scan(pages,0);});
    }).then(function (streams) {return streams.length ? streams : nextBase();});
  }
  return nextBase().then(function (streams) {
    if (streams.length || source.search !== "php") return streams;
    return resolvePhpCategoryArchive(metadata, source, requests);
  }).then(function (streams) {
    var deduped = [], seen = {};
    for (var i = 0; i < streams.length; i++) {
      if (seen[streams[i].url]) continue;
      seen[streams[i].url] = true;
      streams[i].name = String(streams[i].name || "Krmizi").replace(/^Krmizi/,source.name);
      streams[i].title = String(streams[i].title || "Krmizi").replace(/^Krmizi/,source.name);
      streams[i].provider = source.name;
      if (source.language) streams[i].language = source.language;
      deduped.push(streams[i]);
    }
    return deduped;
  });
}

function getStreams(tmdbId, mediaType, season, episode) {
  var type = String(mediaType || "").toLowerCase();
  var wantedSeason = parseInt(season, 10);
  var wantedEpisode = parseInt(episode, 10);
  var id = String(tmdbId || "").trim();

  if (type !== "tv" && type !== "series" && type !== "show") return Promise.resolve([]);
  if (!/^\d+$/.test(id) || !wantedSeason || !wantedEpisode || wantedSeason < 1 || wantedEpisode < 1) {
    logFailure("invalid_request", "tmdb_or_episode");
    return Promise.resolve([]);
  }

  log("tmdb_id", id);
  log("request", "S" + wantedSeason + "E" + wantedEpisode);

  var collected = [];
  var pipeline = getTmdbMetadata(id).then(function (metadata) {
    log("titles", metadata.titles.join(" | "));
    if (!metadata.titles.length) { logFailure("tmdb_metadata_not_found"); return []; }
    var sources = SOURCES.concat(typeof EXTRA_SOURCES !== "undefined" ? EXTRA_SOURCES : []);
    var jobs = sources.map(function (source) {
      log("source", source.name);
      var work = Promise.resolve().then(function () {
        if (source.strategy === "extra") {
          var requests = siteEpisodeRequests({ html: "", heading: "" }, metadata, wantedSeason, wantedEpisode);
          if (!requests.length) requests = [{ season: wantedSeason, episode: wantedEpisode }];
          var aliases = [], seen = {};
          requests.forEach(function (request) {
            [request].concat(request.identities || []).forEach(function (identity) {
              var key = identity.season + ":" + identity.episode;
              if (!seen[key]) { seen[key] = true; aliases.push(identity); }
            });
          });
          return resolveExtraSource(metadata, source, aliases);
        }
        var mirrorIndex = 0, mirrors = source.bases || [null];
        function nextMirror() {
          if (mirrorIndex >= mirrors.length) return Promise.resolve([]);
          var mirror = mirrors[mirrorIndex++];
          var candidateSource = mirror ? { name: source.name, bases: [mirror], index: source.index } : source;
          return resolveSeries(metadata, candidateSource).then(function (series) {
            if (!series) return [];
            log("matched_series", series.url);
            var requests = siteEpisodeRequests(series, metadata, wantedSeason, wantedEpisode), index = 0;
            function nextEpisode() {
              if (index >= requests.length) return Promise.resolve([]);
              var request = requests[index++];
              var candidate = findExactEpisode(series, request.season, request.episode);
              if (!candidate) return nextEpisode();
              return verifyEpisodePage(series, candidate, request.season, request.episode, request).then(function (verified) {
                return verified ? resolvePlayer(verified) : [];
              }).catch(function () { return []; }).then(function (streams) {
                return streams.length ? streams : nextEpisode();
              });
            }
            return nextEpisode();
          }).catch(function () { return []; }).then(function (streams) {
            return streams.length ? streams : nextMirror();
          });
        }
        return nextMirror();
      });
      return withDeadline(work, 32000, "source_timeout " + source.name).catch(function (error) {
        logFailure("source_failed", source.name + " " + errorMessage(error).replace(/api_key=[^&\s]+/gi, "api_key=REDACTED"));
        return [];
      }).then(function (streams) {
        log("source_streams", source.name + " " + streams.length);
        for (var i = 0; i < streams.length; i++) {
          streams[i].name = streams[i].name.replace(/^Krmizi/, source.name);
          streams[i].provider = source.name;
          streams[i].title = streams[i].title.replace(/^Krmizi/, source.name);
        }
        collected = collected.concat(streams);
        return streams;
      });
    });
    return Promise.all(jobs).then(function () { return sortStreams(collected); });
  });
  return withDeadline(pipeline, 50000, "provider_timeout").catch(function () {
    return sortStreams(collected);
  }).then(function (streams) {
    streams = arabicOnlyStreams(streams);
    // 1080p ONLY: drop every other resolution. Tag each returned stream with 🇮🇶.
    var filtered = [];
    for (var i = 0; i < streams.length; i++) {
      if (streams[i].quality === TARGET_QUALITY) {
        streams[i].language = "🇮🇶";
        filtered.push(streams[i]);
      }
    }
    log("streams_found", filtered.length);
    return filtered;
  });
}

module.exports = { getStreams: getStreams };
