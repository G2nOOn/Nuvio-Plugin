// FourKHDHub via CNCVerse Bridge - 4K & 1080p only
// Multi-line name, emojis stripped, addon info passed through

var CNCVERSE_BASE = "https://cncverse.dpdns.org";
var CNCVERSE_USER = "p_zvmq78raoyj7";
var TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
var DISPLAY_NAME = "FourKHDHub CloudStream";

function getImdbId(tmdbId, mediaType) {
    if (typeof tmdbId === "string" && tmdbId.indexOf("tt") === 0) {
        return Promise.resolve(tmdbId);
    }
    var endpoint = mediaType === "tv" ? "tv" : "movie";
    var url = "https://api.themoviedb.org/3/" + endpoint + "/" + tmdbId + "/external_ids?api_key=" + TMDB_API_KEY;
    return fetch(url, { headers: { "User-Agent": UA } }).then(function(r) {
        return r.json();
    }).then(function(d) {
        return d.imdb_id || null;
    }).catch(function() {
        return null;
    });
}

function classifyQuality(raw) {
    if (!raw) return null;
    var q = String(raw).toUpperCase();
    if (q.indexOf("720") !== -1) return null;
    if (q.indexOf("480") !== -1) return null;
    if (q.indexOf("360") !== -1) return null;
    if (q.indexOf("240") !== -1) return null;
    if (q.indexOf("4K") !== -1) return "4k";
    if (q.indexOf("2160") !== -1) return "4k";
    if (q.indexOf("UHD") !== -1) return "4k";
    if (q.indexOf("1080") !== -1) return "1080p";
    if (q.indexOf("FHD") !== -1) return "1080p";
    return null;
}

function isPromo(s) {
    if (!s || !s.url) return true;
    var txt = ((s.name || "") + " " + (s.title || "") + " " + (s.description || "")).toLowerCase();
    if (txt.indexOf("support the project") !== -1) return true;
    if (txt.indexOf("click to donate") !== -1) return true;
    if (txt.indexOf("donate this project") !== -1) return true;
    if (txt.indexOf("hide it in your profile") !== -1) return true;
    return false;
}

function isJunkStream(s) {
    if (!s) return true;
    var txt = ((s.name || "") + " " + (s.title || "") + " " + (s.description || "")).toLowerCase();
    var hasHubcloud = txt.indexOf("hubcloud") !== -1;
    var hasDownload = txt.indexOf("[download]") !== -1 || txt.indexOf("download]") !== -1;
    return hasHubcloud && hasDownload;
}

function serverPriority(s) {
    var txt = ((s.name || "") + " " + (s.title || "") + " " + (s.description || "")).toLowerCase();
    if (txt.indexOf("pixeldrain") !== -1) return 100;
    if (txt.indexOf("fsl") !== -1) return 50;
    if (txt.indexOf("hubcloud") !== -1) return 25;
    return 10;
}

function extractSize(s) {
    var txt = (s.name || "") + " " + (s.title || "") + " " + (s.description || "");
    var m = txt.match(/(\d+(?:\.\d+)?)\s*([KMGT]B)/i);
    if (!m) return null;
    var value = parseFloat(m[1]);
    var unit = m[2].toUpperCase();
    var mb = value;
    if (unit === "KB") mb = value / 1024;
    else if (unit === "GB") mb = value * 1024;
    else if (unit === "TB") mb = value * 1024 * 1024;
    return Math.round(mb * 100) / 100;
}

// Strip emojis via code-point ranges (no unicode regex flag needed)
function stripEmojis(str) {
    if (!str) return "";
    var s = String(str);
    var out = "";
    var i = 0;
    while (i < s.length) {
        var code = s.charCodeAt(i);
        // Surrogate pairs (all emojis >= U+10000)
        if (code >= 0xD800 && code <= 0xDFFF) { i++; continue; }
        // Misc symbols (☀ ☁ ⚡ ...)
        if (code >= 0x2600 && code <= 0x26FF) { i++; continue; }
        // Dingbats (✂ ✈ ✉ ...)
        if (code >= 0x2700 && code <= 0x27BF) { i++; continue; }
        // Variation selectors
        if (code >= 0xFE00 && code <= 0xFE0F) { i++; continue; }
        // Zero-width joiner
        if (code === 0x200D) { i++; continue; }
        out += s[i];
        i++;
    }
    return out;
}

// Clean a single line: strip emojis, normalize " | " spacing, trim
function cleanLine(str) {
    if (!str) return "";
    var out = stripEmojis(str);
    out = out.replace(/\s*\|\s*/g, " | ");
    out = out.replace(/\s{2,}/g, " ");
    out = out.replace(/^\s+|\s+$/g, "");
    return out;
}

// Rebrand CNCVerse -> our display name
function rebrand(str) {
    if (!str) return "";
    return String(str).replace(/CNCVerse/gi, DISPLAY_NAME);
}

// Build the multiline name from the addon's fields
function buildRichName(s) {
    var lines = [];
    var seen = {};
    var fields = [s.name, s.title, s.description];

    for (var f = 0; f < fields.length; f++) {
        var raw = fields[f];
        if (!raw) continue;
        var split = String(raw).split("\n");
        for (var j = 0; j < split.length; j++) {
            var line = cleanLine(rebrand(split[j]));
            if (!line) continue;
            // skip header-only lines that just repeat display name
            if (line === DISPLAY_NAME) continue;
            if (seen[line]) continue;
            seen[line] = true;
            lines.push(line);
        }
    }

    if (lines.length === 0) {
        lines.push(DISPLAY_NAME);
    }

    return lines.join("\n");
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
    return getImdbId(tmdbId, mediaType).then(function(imdbId) {
        if (!imdbId) return [];
        var type = mediaType === "tv" ? "series" : "movie";
        var id = imdbId;
        if (mediaType === "tv" && seasonNum && episodeNum) {
            id = imdbId + ":" + seasonNum + ":" + episodeNum;
        }
        var url = CNCVERSE_BASE + "/u/" + CNCVERSE_USER + "/stream/" + type + "/" + id + ".json";
        return fetch(url, { headers: { "User-Agent": UA } }).then(function(r) {
            return r.json();
        }).then(function(data) {
            var streams = data && data.streams ? data.streams : [];
            var results = [];
            var seenUrls = {};
            var i = 0;
            for (i = 0; i < streams.length; i++) {
                var s = streams[i];
                if (isPromo(s)) continue;
                if (isJunkStream(s)) continue;
                if (seenUrls[s.url]) continue;

                var label = (s.name || "") + " " + (s.title || "") + " " + (s.description || "");
                var qClass = classifyQuality(label);
                if (!qClass) continue;

                seenUrls[s.url] = true;

                var richName = buildRichName(s);

                var card = {
                    name: richName,
                    title: richName,
                    description: richName,
                    quality: qClass,
                    url: s.url
                };

                if (s.behaviorHints && s.behaviorHints.headers) {
                    card.headers = s.behaviorHints.headers;
                } else if (s.headers) {
                    card.headers = s.headers;
                }

                card._sizeMB = extractSize(s);
                card._prio = serverPriority(s);
                results.push(card);
            }

            // 4K first, then server priority (PixelDrain > FSL)
            results.sort(function(a, b) {
                var qa = a.quality === "4k" ? 2160 : 1080;
                var qb = b.quality === "4k" ? 2160 : 1080;
                if (qa !== qb) return qb - qa;
                return (b._prio || 0) - (a._prio || 0);
            });

            // Dedupe by size
            var deduped = [];
            var seenSizes = {};
            var j = 0;
            for (j = 0; j < results.length; j++) {
                var st = results[j];
                var sizeKey = st._sizeMB;
                if (sizeKey !== null && seenSizes[sizeKey]) continue;
                if (sizeKey !== null) seenSizes[sizeKey] = true;
                delete st._sizeMB;
                delete st._prio;
                deduped.push(st);
            }

            return deduped;
        });
    }).catch(function() {
        return [];
    });
}

module.exports = { getStreams: getStreams };
