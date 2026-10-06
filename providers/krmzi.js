/**
 * Krmizi / Qrmzi provider for Nuvio — STRICT 1080p ONLY Edition
 * Version: 1.4.1
 */

"use strict";

var cheerio = require("cheerio-without-node-native");

var VERSION = "1.4.1";
var TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
var TMDB_API_BASE = "https://api.themoviedb.org/3";
var TMDB_BASE = "https://www.themoviedb.org";
var SITE_BASES = [
  "https://www.qrmzi.tv",
  "https://krmzi.live",
  "https://v2.qrmzi.website"
];
var UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
var MAX_SERIES_PROBES = 6;
var MAX_SERVERS = 8;

// In-memory cache: tmdbId -> [cumulativeEpCountS1, cumulativeS1S2, ...]
var seasonBoundariesCache = {};

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
    .replace(/&#0*39;|'/gi, "'")
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
  return cleanBase + url;
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
  var text = String(html || "").toLowerCase();
  return text.indexOf("cf-chl-") >= 0 ||
    text.indexOf("challenge-platform") >= 0 ||
    text.indexOf("just a moment") >= 0 ||
    text.indexOf("checking your browser") >= 0 ||
    text.indexOf("cloudflare ray id") >= 0;
}

function fetchTextInfo(url, referer, origin, accept) {
  return fetch(url, {
    headers: requestHeaders(referer, origin, accept),
    skipSizeCheck: true
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
    .toLowerCase()
    .replace(/[إأآٱا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[ؤئ]/g, "ء")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[ـ\u200B-\u200D\uFEFF]/g, "")
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

function fieldMatchScore(field, titles) {
  var normalizedField = normalize(field);
  var compactField = compactTitle(field);
  if (!normalizedField) return 0;
  var best = 0;

  for (var i = 0; i < titles.length; i++) {
    var title = compactTitle(titles[i]);
    if (!title || title.length < 2) continue;
    if (compactField === title) best = Math.max(best, 120);
    else if (normalizedField === normalize(titles[i])) best = Math.max(best, 115);
    else if (phraseContains(normalizedField, title)) best = Math.max(best, 80);
  }
  return best;
}

function episodeNumber(value) {
  var text = decodeHtml(value);
  var match = text.match(/(?:الحلقة|الحلقه|حلقة|حلقه)\s*[:\-]?\s*(\d{1,4})/i);
  if (!match) match = text.match(/\bS\d{1,2}E(\d{1,4})\b/i);
  if (!match) match = text.match(/\bep(?:isode)?[\s._-]*(\d{1,4})\b/i);
  if (!match) match = text.match(/[-_\/]e(\d{1,4})(?:[\/?._-]|$)/i);
  return match ? parseInt(match[1], 10) : NaN;
}

function explicitSeasonEpisode(value) {
  var match = String(value || "").match(/\bS(\d{1,2})E(\d{1,4})\b/i);
  if (!match) match = String(value || "").match(/(?:season|الموسم|الجزء)[\s._-]*(\d{1,2})[\s._-]*(?:episode|الحلقة)[\s._-]*(\d{1,4})/i);
  return match ? { season: parseInt(match[1], 10), episode: parseInt(match[2], 10) } : null;
}

function seasonFromText(text) {
  var value = String(text || "");
  if (!value) return NaN;

  var arabicOrdinals = {
    "الاول": 1, "الأول": 1, "الثاني": 2, "الثالث": 3, "الرابع": 4,
    "الخامس": 5, "السادس": 6, "السابع": 7, "الثامن": 8,
    "التاسع": 9, "العاشر": 10
  };

  var match = value.match(/(?:الجزء|الموسم|موسم)\s+(الأول|الاول|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر)/i);
  if (match) {
    var ord = match[1];
    if (arabicOrdinals[ord]) return arabicOrdinals[ord];
    var normalizedOrd = ord.replace(/أ/g, "ا");
    if (arabicOrdinals[normalizedOrd]) return arabicOrdinals[normalizedOrd];
  }

  match = value.match(/(?:الجزء|الموسم|موسم)\s*[:\-]?\s*(\d{1,2})/i);
  if (match) return parseInt(match[1], 10);

  match = value.match(/(?:season|part)\s*[:\-]?\s*(\d{1,2})/i);
  if (match) return parseInt(match[1], 10);

  match = value.match(/\bS(\d{1,2})(?![\dEe])/i);
  if (match) return parseInt(match[1], 10);

  return NaN;
}

function findSeasonBoundaries(seriesHtml) {
  var $ = cheerio.load(seriesHtml);
  var boundaries = [];

  $('.sec-line article.postEp').each(function (_, element) {
    var block = $(element);
    var ribbon = block.find('span.ribbon').first().text().trim();
    if (ribbon.indexOf('نهاية الموسم') >= 0) {
      var epNumText = block.find('.episodeNum span').last().text().trim();
      var epNum = parseInt(epNumText, 10);
      if (!isNaN(epNum)) {
        boundaries.push(epNum);
      }
    }
  });

  return boundaries;
}

/**
 * v1.4.0 — Fetch season boundaries from TMDB API.
 */
function getTmdbSeasonBoundaries(tmdbId) {
  var cacheKey = String(tmdbId);
  if (seasonBoundariesCache[cacheKey]) {
    return Promise.resolve(seasonBoundariesCache[cacheKey]);
  }

  var showUrl = TMDB_API_BASE + "/tv/" + encodeURIComponent(tmdbId) +
    "?api_key=" + TMDB_API_KEY + "&language=en-US";

  return fetchJson(showUrl, "", "").then(function (showData) {
    var seasons = (showData && showData.seasons) || [];
    seasons = seasons.filter(function (s) {
      return s && typeof s.season_number === "number" && s.season_number > 0;
    });
    seasons.sort(function (a, b) { return a.season_number - b.season_number; });

    if (!seasons.length) return [];

    var jobs = [];
    for (var i = 0; i < seasons.length; i++) {
      (function (seasonNum) {
        var seasonUrl = TMDB_API_BASE + "/tv/" + encodeURIComponent(tmdbId) +
          "/season/" + seasonNum + "?api_key=" + TMDB_API_KEY + "&language=en-US";
        jobs.push(
          fetchJson(seasonUrl, "", "").then(function (seasonData) {
            var eps = seasonData && seasonData.episodes ? seasonData.episodes : [];
            return eps.length;
          }).catch(function () { return 0; })
        );
      })(seasons[i].season_number);
    }

    return Promise.all(jobs).then(function (counts) {
      var boundaries = [];
      var cumulative = 0;
      for (var j = 0; j < counts.length; j++) {
        cumulative += counts[j];
        boundaries.push(cumulative);
      }
      log("tmdb_boundaries_cached", boundaries.join(","));
      seasonBoundariesCache[cacheKey] = boundaries;
      return boundaries;
    });
  }).catch(function (error) {
    logFailure("tmdb_boundaries_failed", errorMessage(error));
    return [];
  });
}

function siteEpisodeNumber(wantedSeason, wantedEpisode, boundaries) {
  if (wantedSeason <= 1) return wantedEpisode;

  var offset = 0;

  if (boundaries.length >= wantedSeason - 1) {
    for (var i = 0; i < wantedSeason - 1; i++) {
      offset += boundaries[i];
    }
  } else if (boundaries.length > 0) {
    for (var j = 0; j < boundaries.length; j++) {
      offset += boundaries[j];
    }
    var remainingSeasons = wantedSeason - 1 - boundaries.length;
    offset += remainingSeasons * 13;
  } else {
    offset = (wantedSeason - 1) * 13;
  }

  return offset + wantedEpisode;
}

function isValidS1Episode(wantedEpisode, boundaries) {
  if (!boundaries || boundaries.length === 0) return true;
  return wantedEpisode <= boundaries[0];
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

function getTmdbMetadata(tmdbId) {
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

  return Promise.all([Promise.all(pageJobs), aliasesJob]).then(function (parts) {
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

    return { titles: titles, year: year };
  });
}

function parseSeriesCards(html, pageUrl, titles) {
  var $ = cheerio.load(html);
  var cards = [];
  var seen = {};

  $('article.postEp a[href*="/series/"]').each(function (_, element) {
    var anchor = wrap($, element);
    var url = absUrl(anchor.attr("href"), pageUrl);
    if (!url || seen[urlKey(url)]) return;

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
    var posterScore = Math.max(fieldMatchScore(poster, titles), fieldMatchScore(url, titles));
    var score = headingScore;
    if (posterScore >= 80) score = Math.max(score, 105);

    if (score >= 100) {
      seen[urlKey(url)] = true;
      cards.push({
        url: url,
        heading: heading.replace(/\s+/g, " ").trim(),
        poster: poster,
        score: score
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
    var headingScore = 0;
    var detailScore = fieldMatchScore(result.url, titles);
    var i;
    for (i = 0; i < identity.headings.length; i++) {
      headingScore = Math.max(headingScore, fieldMatchScore(identity.headings[i], titles));
    }
    for (i = 0; i < identity.details.length; i++) {
      detailScore = Math.max(detailScore, fieldMatchScore(identity.details[i], titles));
    }
    var verified = headingScore >= 110 || (card.score >= 105 && detailScore >= 80);
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

function resolveSeries(metadata) {
  var baseIndex = 0;

  function nextBase() {
    if (baseIndex >= SITE_BASES.length) return Promise.resolve(null);
    var base = SITE_BASES[baseIndex++];
    var indexUrl = base + "/all-turkish-series/";

    return fetchTextInfo(indexUrl, base + "/", "").then(function (result) {
      var cards = parseSeriesCards(result.html, result.url, metadata.titles);
      if (!cards.length) return nextBase();
      return verifyRankedCards(cards, metadata.titles, result.url).then(function (series) {
        if (series) return series;
        return nextBase();
      });
    }).catch(function (error) {
      if (errorMessage(error).indexOf("cloudflare_challenge") === 0) {
        logFailure("cloudflare_challenge", originOf(indexUrl));
      }
      return nextBase();
    });
  }

  return nextBase();
}

/**
 * v1.4.0 — findExactEpisode now accepts external (TMDB) boundaries.
 */
function findExactEpisode(series, wantedSeason, wantedEpisode, externalBoundaries) {
  if (wantedSeason < 1 || wantedEpisode < 1) {
    logFailure("invalid_season_or_episode", "S" + wantedSeason + "E" + wantedEpisode);
    return null;
  }

  var $ = cheerio.load(series.html);
  var boundaries = (externalBoundaries && externalBoundaries.length)
    ? externalBoundaries
    : findSeasonBoundaries(series.html);
  var siteEp = siteEpisodeNumber(wantedSeason, wantedEpisode, boundaries);

  log("season_boundaries", boundaries.length ? boundaries.join(",") : "none");
  log("computed_site_episode", "S" + wantedSeason + "E" + wantedEpisode + " → site ep " + siteEp);

  if (wantedSeason === 1 && boundaries.length > 0) {
    if (!isValidS1Episode(wantedEpisode, boundaries)) {
      logFailure("s1_episode_out_of_range", "S1 ends at episode " + boundaries[0]);
      return null;
    }
  }

  var matches = [];
  var seen = {};

  $('.sec-line article.postEp a[href*="/episode/"]').each(function (_, element) {
    var anchor = wrap($, element);
    var url = absUrl(anchor.attr("href"), series.url);
    if (!url || seen[urlKey(url)]) return;

    var identity = [
      anchor.attr("title") || "",
      anchor.find('.episodeNum span').last().text() || "",
      anchor.find("img").attr("alt") || "",
      url
    ].join(" ");

    var epNum = episodeNumber(identity);
    if (epNum === siteEp) {
      seen[urlKey(url)] = true;
      matches.push({ url: url, identity: identity, epNum: epNum });
    }
  });

  if (matches.length === 1) {
    log("episode_match", "site_ep=" + siteEp);
    return matches[0];
  }

  if (matches.length > 1) {
    logFailure("episode_ambiguous", "matches=" + matches.length + " site_ep=" + siteEp);
    return null;
  }

  if (siteEp !== wantedEpisode && wantedSeason === 2) {
    log("fallback_raw_episode", "trying ep=" + wantedEpisode);
    var rawMatches = [];
    var rawSeen = {};

    $('.sec-line article.postEp a[href*="/episode/"]').each(function (_, element) {
      var anchor = wrap($, element);
      var url = absUrl(anchor.attr("href"), series.url);
      if (!url || rawSeen[urlKey(url)]) return;

      var identity = [
        anchor.attr("title") || "",
        anchor.find('.episodeNum span').last().text() || "",
        anchor.find("img").attr("alt") || "",
        url
      ].join(" ");

      var epNum = episodeNumber(identity);
      var seasonNum = seasonFromText(identity);

      if (epNum === wantedEpisode && (isNaN(seasonNum) || seasonNum === wantedSeason)) {
        if (boundaries.length > 0 && epNum <= boundaries[0]) {
          return;
        }

        rawSeen[urlKey(url)] = true;
        rawMatches.push({ url: url, identity: identity, epNum: epNum });
      }
    });

    if (rawMatches.length === 1) {
      log("episode_match", "raw_ep=" + wantedEpisode);
      return rawMatches[0];
    }
  }

  logFailure("episode_not_found", "wanted=S" + wantedSeason + "E" + wantedEpisode + " site_ep=" + siteEp);
  return null;
}

function anaPlayerAllowed(url) {
  return /^https?:\/\/[^\/]*anaplayer\.online\//i.test(String(url || ""));
}

function directMedia(url) {
  return /\.(?:m3u8|mp4)(?:[?#]|$)/i.test(String(url || ""));
}

function verifyEpisodePage(series, episodeCandidate, wantedSeason, wantedEpisode, externalBoundaries) {
  var boundaries = (externalBoundaries && externalBoundaries.length)
    ? externalBoundaries
    : findSeasonBoundaries(series.html);
  var siteEp = siteEpisodeNumber(wantedSeason, wantedEpisode, boundaries);

  if (wantedSeason < 1 || wantedEpisode < 1) {
    logFailure("invalid_season_or_episode");
    return null;
  }

  if (wantedSeason === 1 && boundaries.length > 0) {
    if (!isValidS1Episode(wantedEpisode, boundaries)) {
      logFailure("s1_episode_out_of_range", "S1 ends at episode " + boundaries[0]);
      return null;
    }
  }

  return fetchTextInfo(episodeCandidate.url, series.url, "").then(function (result) {
    var $ = cheerio.load(result.html);
    var heading = [
      $(".singleInfo h1").first().text() || "",
      $("h1").first().text() || "",
      $("title").first().text() || ""
    ].join(" ");
    var headingEpNum = episodeNumber(heading);
    var headingSeason = seasonFromText(heading);

    if (!isNaN(headingEpNum) && headingEpNum !== wantedEpisode && headingEpNum !== siteEp) {
      logFailure("episode_identity_mismatch", "number: heading=" + headingEpNum + " wanted=" + wantedEpisode + " site=" + siteEp);
      return null;
    }

    if (!isNaN(headingSeason) && headingSeason !== wantedSeason) {
      logFailure("episode_identity_mismatch", "season: heading=" + headingSeason + " wanted=" + wantedSeason);
      return null;
    }

    var seriesLink = $("h2 a[href*=\"/series/\"]").first();
    var linkedSeriesUrl = absUrl(seriesLink.attr("href"), result.url);
    if (!linkedSeriesUrl || urlKey(linkedSeriesUrl) !== urlKey(series.url)) {
      logFailure("episode_identity_mismatch", "series");
      return null;
    }

    var playerNode = $(".getEmbed .watch iframe[src]").first();
    var playerUrl = absUrl(playerNode.attr("src"), result.url);
    if (!playerUrl) {
      var directNode = $(".getEmbed .watch video[src], .getEmbed .watch source[src]").first();
      playerUrl = absUrl(directNode.attr("src"), result.url);
    }
    if (!playerUrl || (!anaPlayerAllowed(playerUrl) && !directMedia(playerUrl))) {
      logFailure("player_not_found", "page_container");
      return null;
    }

    var explicit = explicitSeasonEpisode(playerUrl + " " + heading);
    if (explicit) {
      var seasonOk = explicit.season === wantedSeason || explicit.episode === siteEp;
      var episodeOk = explicit.episode === wantedEpisode || explicit.episode === siteEp;

      if (!seasonOk) {
        logFailure("player_identity_mismatch", "S" + explicit.season + "E" + explicit.episode);
        return null;
      }
      if (!episodeOk) {
        logFailure("player_identity_mismatch", "episode: explicit=" + explicit.episode + " wanted=" + wantedEpisode + " site=" + siteEp);
        return null;
      }
    }

    return {
      episodeUrl: result.url,
      playerUrl: playerUrl,
      season: wantedSeason,
      episode: wantedEpisode
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
  return "";
}

function streamObject(url, referer, quality, serverName) {
  var resolvedQuality = quality || qualityFromText(url);
  var label = String(serverName || "Server").replace(/\s+/g, " ").trim();
  var headers = { "User-Agent": UA };
  if (referer) {
    headers.Referer = referer;
    var origin = originOf(referer);
    if (origin) headers.Origin = origin;
  }

  var stream = {
    name: "Krmizi",
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

function variantsFromEncodedMaster(masterUrl) {
  var value = String(masterUrl || "");
  var match = value.match(/^(https?:\/\/[^?#]+\/)([^\/?#]+)_((?:,[a-z0-9]+)+),?\.urlset\/master\.m3u8(\?[^#]*)?$/i);
  if (!match) return [];

  var qualities = { l: "360p", n: "480p", h: "720p", x: "1080p" };
  var codes = match[3].split(",");
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

function isMasterPlaylistUrl(url) {
  return /(?:master\.m3u8|\.urlset\/)/i.test(String(url || ""));
}

function isHlsPlaylistText(text) {
  return /^\s*#EXTM3U(?:\s|$)/i.test(String(text || "").replace(/^\uFEFF/, ""));
}

function reliableHlsSource(url, referer, serverName) {
  var identity = String(url || "") + " " + String(referer || "") + " " + String(serverName || "");
  // Added vidspeed.space and other common domains
  return /cdnplus(?:\.space)?|dailymotion|dai\.ly|dmcdn|brqz\.online|vidspeed\.space|vidoba\.cyou|anafast\.cyou|mp4plus\.cyou|larhu\.website/i.test(identity);
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
  var pattern = /eval\(function\(p,a,c,k,e,d\)\{[\s\S]*?\}\('((?:\\.|[^'])*)',(\d+),(\d+),'((?:\\.|[^'])*)'\.split\('\|'\)\)/g;
  var output = "";
  var match;
  var decodedCount = 0;

  while ((match = pattern.exec(text)) !== null && decodedCount < 4) {
    var payload = unescapePackedString(match[1]);
    var radix = parseInt(match[2], 10);
    var count = parseInt(match[3], 10);
    var keys = unescapePackedString(match[4]).split("|");
    if (radix < 2 || radix > 36 || count > 2000 || payload.length > 250000) continue;

    var digits = "0123456789abcdefghijklmnopqrstuvwxyz";

    for (var i = count - 1; i >= 0; i--) {
      if (!keys[i]) continue;
      var token = "";
      var n = i;
      if (n === 0) {
        token = "0";
      } else {
        while (n > 0) {
          token = digits[n % radix] + token;
          n = Math.floor(n / radix);
        }
      }
      payload = payload.replace(new RegExp("\\b" + token + "\\b", "g"), keys[i]);
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
    /(?:file|src|source|hls|playlist|url)\s*:\s*["'](https?:[^"']+?\.(?:m3u8|mp4)(?:\?[^"']*)?)["']\s*(?:,\s*label\s*:\s*["']([^"']+)["'])?/gi,
    /["'](?:file|src|source|hls|playlist|url)["']\s*:\s*["'](https?:[^"']+?\.(?:m3u8|mp4)(?:\?[^"']*)?)["']\s*(?:,\s*["']label["']\s*:\s*["']([^"']+)["'])?/gi
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

function supportedDirectEmbed(url) {
  return /^https?:\/\/[^\/]*(?:cdnplus\.space|mp4plus\.cyou|anafast\.cyou|vidoba\.cyou|vidspeed\.space|larhu\.website|brqz\.online)\//i.test(String(url || ""));
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

function addMediaEntry(entry, referer, serverName, streams, seenStreams) {
  var url = entry && entry.url ? entry.url : "";
  if (!url || seenStreams[url]) return Promise.resolve();
  var declaredQuality = entry.quality || qualityFromText(serverName) || qualityFromText(url);

  // Debug logging
  log("media_entry", "url=" + url + " q=" + (declaredQuality || "none") + " server=" + serverName);

  if (declaredQuality && declaredQuality !== "1080p") {
    log("skip_quality", declaredQuality);
    return Promise.resolve();
  }

  if (!/\.m3u8(?:[?#]|$)/i.test(url)) {
    if (!declaredQuality) return Promise.resolve();
    seenStreams[url] = true;
    streams.push(streamObject(url, referer, declaredQuality, serverName));
    return Promise.resolve();
  }

  var encodedVariants = variantsFromEncodedMaster(url);
  if (encodedVariants.length) {
    seenStreams[url] = true;
    if (!reliableHlsSource(url, referer, serverName)) {
      log("skip_unreliable", url);
      return Promise.resolve();
    }
    for (var encodedIndex = 0; encodedIndex < encodedVariants.length; encodedIndex++) {
      var encoded = encodedVariants[encodedIndex];
      if (seenStreams[encoded.url]) continue;
      seenStreams[encoded.url] = true;
      streams.push(streamObject(encoded.url, referer, encoded.quality, serverName));
    }
    return Promise.resolve();
  }

  if (!reliableHlsSource(url, referer, serverName)) {
    log("skip_unreliable", url);
    seenStreams[url] = true;
    return Promise.resolve();
  }

  return fetchTextInfo(
    url,
    referer,
    originOf(referer),
    "application/vnd.apple.mpegurl,application/x-mpegURL,text/plain,*/*"
  ).then(function (result) {
    var variants = parseHlsMaster(result.html, url);
    if (!variants.length) {
      if (declaredQuality && !isMasterPlaylistUrl(url) && isHlsPlaylistText(result.html) && !seenStreams[url]) {
        seenStreams[url] = true;
        streams.push(streamObject(url, referer, declaredQuality, serverName));
      }
      return;
    }

    for (var i = 0; i < variants.length; i++) {
      if (variants[i].quality !== "1080p" || seenStreams[variants[i].url]) continue;
      seenStreams[variants[i].url] = true;
      streams.push(streamObject(variants[i].url, referer, variants[i].quality, serverName));
    }
  }).catch(function () {});
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
          var q = qualityFromText(keys[i]);
          if (q !== "1080p") continue;
          jobs.push(addMediaEntry(
            { url: list[j].url, quality: q },
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

function resolveEmbedTarget(target, expected, streams, seenStreams, externalBoundaries) {
  if (!target || !target.url) return Promise.resolve();
  var url = target.url;

  if (directMedia(url)) {
    return addMediaEntry({ url: url, quality: qualityFromText(url) }, target.referer, target.label, streams, seenStreams);
  }
  if (dailymotionId(url)) {
    return resolveDailymotion(url, target.referer, target.label, streams, seenStreams);
  }
  if (!supportedDirectEmbed(url)) return Promise.resolve();

  return fetchTextInfo(url, target.referer, originOf(target.referer)).then(function (result) {
    var explicit = explicitSeasonEpisode(result.html + " " + result.url);
    if (explicit) {
      var boundaries = (externalBoundaries && externalBoundaries.length)
        ? externalBoundaries
        : findSeasonBoundaries(result.html);
      var siteEp = siteEpisodeNumber(expected.season, expected.episode, boundaries);

      var seasonOk = explicit.season === expected.season || explicit.episode === siteEp;
      var episodeOk = explicit.episode === expected.episode || explicit.episode === siteEp;

      if (!seasonOk) {
        logFailure("player_identity_mismatch", target.label + " S" + explicit.season);
        return;
      }
      if (!episodeOk) {
        logFailure("player_identity_mismatch", target.label + " E" + explicit.episode);
        return;
      }
    }

    // Debug: log HTML length and entries found
    log("embed_html", result.url + " len=" + result.html.length);
    var entries = mediaEntriesFromHtml(result.html);
    log("embed_entries", "count=" + entries.length);
    for (var d = 0; d < entries.length; d++) {
      log("embed_entry", entries[d].url + " q=" + entries[d].quality);
    }

    var jobs = [];
    for (var i = 0; i < entries.length; i++) {
      jobs.push(addMediaEntry(entries[i], result.url, target.label, streams, seenStreams));
    }
    return Promise.all(jobs);
  }).catch(function () {});
}

function resolveAnaPlayer(playerUrl, episodeUrl, wantedSeason, wantedEpisode, externalBoundaries) {
  var streams = [];
  var seenStreams = {};

  return fetchTextInfo(playerUrl, episodeUrl, originOf(episodeUrl)).then(function (player) {
    var explicit = explicitSeasonEpisode(player.url + " " + player.html);
    if (explicit) {
      var boundaries = (externalBoundaries && externalBoundaries.length)
        ? externalBoundaries
        : findSeasonBoundaries(player.html);
      var siteEp = siteEpisodeNumber(wantedSeason, wantedEpisode, boundaries);

      var seasonOk = explicit.season === wantedSeason || explicit.episode === siteEp;
      var episodeOk = explicit.episode === wantedEpisode || explicit.episode === siteEp;

      if (!seasonOk) {
        logFailure("player_identity_mismatch", "AnaPlayer S" + explicit.season + "E" + explicit.episode);
        return [];
      }
      if (!episodeOk) {
        logFailure("player_identity_mismatch", "AnaPlayer E" + explicit.episode + " wanted=" + wantedEpisode + " site=" + siteEp);
        return [];
      }
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
      var expected = { season: wantedSeason, episode: wantedEpisode };
      for (var j = 0; j < targets.length; j++) {
        jobs.push(resolveEmbedTarget(targets[j], expected, streams, seenStreams, externalBoundaries));
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

function resolvePlayer(verifiedEpisode, externalBoundaries) {
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
      externalBoundaries
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

  var context = {
    metadata: null,
    series: null,
    episodeCandidate: null,
    verifiedEpisode: null,
    tmdbBoundaries: null
  };

  return getTmdbMetadata(id)
    .then(function (metadata) {
      context.metadata = metadata;
      log("titles", metadata.titles.join(" | "));
      if (!metadata.titles.length) {
        logFailure("tmdb_metadata_not_found");
        return null;
      }
      return getTmdbSeasonBoundaries(id).then(function (boundaries) {
        context.tmdbBoundaries = boundaries;
        return resolveSeries(metadata);
      });
    })
    .then(function (series) {
      if (!series) {
        logFailure("series_not_found");
        return null;
      }
      context.series = series;
      log("matched_series", series.url);

      var boundaries = context.tmdbBoundaries && context.tmdbBoundaries.length
        ? context.tmdbBoundaries
        : findSeasonBoundaries(series.html);
      log("season_boundaries", boundaries.length ? boundaries.join(",") : "none");

      context.episodeCandidate = findExactEpisode(
        series, wantedSeason, wantedEpisode, context.tmdbBoundaries
      );
      if (!context.episodeCandidate) {
        logFailure("episode_not_found", "S" + wantedSeason + "E" + wantedEpisode);
        return null;
      }
      return verifyEpisodePage(
        series, context.episodeCandidate, wantedSeason, wantedEpisode, context.tmdbBoundaries
      );
    })
    .then(function (verifiedEpisode) {
      if (!verifiedEpisode) return [];
      context.verifiedEpisode = verifiedEpisode;
      log("episode_url", verifiedEpisode.episodeUrl);
      log("player_url", verifiedEpisode.playerUrl);
      return resolvePlayer(verifiedEpisode, context.tmdbBoundaries);
    })
    .then(function (streams) {
      // Temporarily accept all qualities for debugging
      var filtered = (streams || []);
      var sorted = sortStreams(filtered);
      if (!sorted.length) logFailure("no_sources");
      for (var i = 0; i < sorted.length; i++) {
        log("quality", sorted[i].quality || "unannounced");
      }
      log("streams_found", sorted.length);
      return sorted;
    })
    .catch(function (error) {
      var message = errorMessage(error);
      if (message.indexOf("cloudflare_challenge") === 0) logFailure("cloudflare_challenge");
      else logFailure("fatal", message);
      return [];
    });
}

module.exports = { getStreams: getStreams };
