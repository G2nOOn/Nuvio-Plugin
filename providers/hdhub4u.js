// HDhub4u CloudStream via CNCVerse Bridge
// Uses CNCVerse's OWN title/description AS-IS (just rebranded)
// Filter: 4K & 1080p | Dedupe: PixelDrain priority | Sort: quality & size desc

var CNCVERSE_BASE = "https://cncverse.dpdns.org";
var CNCVERSE_USER = "p_3kgxl9rjowrf";
var TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
var PROVIDER_NAME = "HDhub4u CloudStream";

function getImdbId(tmdbId, mediaType) {
    if (typeof tmdbId === "string" && tmdbId.indexOf("tt") === 0) return Promise.resolve(tmdbId);
    var endpoint = mediaType === "tv" ? "tv" : "movie";
    var url = "https://api.themoviedb.org/3/" + endpoint + "/" + tmdbId + "/external_ids?api_key=" + TMDB_API_KEY;
    return fetch(url, { headers: { "User-Agent": UA } })
        .then(function(r) { return r.json(); })
        .then(function(d) { return d.imdb_id || null; })
        .catch(function() { return null; });
}

function getInvertedSortTag(value, max) {
    max = max || 999999;
    var num = Math.max(0, parseInt(value, 10) || 0);
    var inverted = Math.max(0, max - num);
    var binary = inverted.toString(2);
    while (binary.length < 20) binary = "0" + binary;
    var out = "";
    for (var i = 0; i < binary.length; i++) {
        out += (binary[i] === "1" ? "\ufeff" : "\u200b");
    }
    return out;
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

function getServerPriority(s) {
    var txt = ((s.name || "") + " " + (s.title || "") + " " + (s.description || "")).toLowerCase();
    if (txt.indexOf("pixeldrain") !== -1) return 100;
    return 10;
}

function getQualityRank(s) {
    var txt = ((s.name || "") + " " + (s.title || "") + " " + (s.description || "")).toUpperCase();
    if (txt.indexOf("720") !== -1) return -1;
    if (txt.indexOf("480") !== -1) return -1;
    if (txt.indexOf("360") !== -1) return -1;
    if (txt.indexOf("240") !== -1) return -1;
    if (txt.indexOf("2160") !== -1) return 4;
    if (txt.indexOf("4K") !== -1) return 4;
    if (txt.indexOf("UHD") !== -1) return 4;
    if (txt.indexOf("1080") !== -1) return 3;
    if (txt.indexOf("FHD") !== -1) return 3;
    return -1;
}

function getQualityLabel(s) {
    var txt = ((s.name || "") + " " + (s.title || "") + " " + (s.description || "")).toUpperCase();
    if (txt.indexOf("2160") !== -1 || txt.indexOf("4K") !== -1 || txt.indexOf("UHD") !== -1) return "2160p";
    return "1080p";
}

function getSizeMB(s) {
    var txt = (s.name || "") + " " + (s.title || "") + " " + (s.description || "");
    var m = txt.match(/(\d+(?:\.\d+)?)\s*(GB|MB|KB)/i);
    if (!m) return 0;
    var v = parseFloat(m[1]);
    var u = m[2].toUpperCase();
    if (u === "KB") return v / 1024;
    if (u === "GB") return v * 1024;
    return v;
}

function getSizeStr(s) {
    var txt = (s.name || "") + " " + (s.title || "") + " " + (s.description || "");
    var m = txt.match(/(\d+(?:\.\d+)?)\s*(GB|MB|KB)/i);
    if (!m) return "N/A";
    return m[1] + m[2].toUpperCase();
}

function getAudioType(s) {
    var txt = ((s.name || "") + " " + (s.title || "") + " " + (s.description || "")).toUpperCase();
    if (/\bMULTI-?AUDIO\b/.test(txt)) return "Multi-Audio";
    if (/\bDUAL-?AUDIO\b|\bDUBBED\b|\bHINDI\b/.test(txt)) return "Dual-Audio";
    return "Single-Audio";
}

function cleanLine(str) {
    if (!str) return "";
    var s = String(str).replace(/[\ufeff\u200b]/g, "");
    s = s.replace(/CNCVerse/gi, PROVIDER_NAME);
    return s.trim();
}

function extractRealDetails(s) {
    var lines = [];
    var sources = [s.title, s.description];
    var picked = null;

    for (var f = 0; f < sources.length; f++) {
        if (!sources[f]) continue;
        var candidate = [];
        var split = String(sources[f]).split("\n");
        for (var i = 0; i < split.length; i++) {
            var line = cleanLine(split[i]);
            if (!line) continue;
            if (/CNCVerse/i.test(line)) continue;
            if (/^HDhub4u CloudStream\s*\|/i.test(line)) continue;
            if (/^HDhub4u\s*$/i.test(line)) continue;
            if (/^HDhub4u CloudStream \|/i.test(line)) continue;
            candidate.push(line);
        }
        if (candidate.length > 0) {
            picked = candidate;
            break;
        }
    }

    return picked || [];
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

        return fetch(url, { headers: { "User-Agent": UA } })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var raw = data && data.streams ? data.streams : [];

                var candidates = [];
                var seenUrls = {};
                for (var i = 0; i < raw.length; i++) {
                    var s = raw[i];
                    if (isPromo(s)) continue;
                    if (isJunkStream(s)) continue;
                    var qRank = getQualityRank(s);
                    if (qRank === -1) continue;
                    if (seenUrls[s.url]) continue;
                    seenUrls[s.url] = true;

                    candidates.push({
                        stream: s,
                        qRank: qRank,
                        sizeMB: getSizeMB(s),
                        sizeStr: getSizeStr(s),
                        quality: getQualityLabel(s),
                        audioType: getAudioType(s),
                        prio: getServerPriority(s)
                    });
                }

                candidates.sort(function(a, b) {
                    if (a.prio !== b.prio) return b.prio - a.prio;
                    if (a.qRank !== b.qRank) return b.qRank - a.qRank;
                    return b.sizeMB - a.sizeMB;
                });

                var deduped = [];
                var seenKeys = {};
                for (var j = 0; j < candidates.length; j++) {
                    var c = candidates[j];
                    var key = c.qRank + "::" + Math.round(c.sizeMB);
                    if (seenKeys[key]) continue;
                    seenKeys[key] = true;
                    deduped.push(c);
                }

                deduped.sort(function(a, b) {
                    if (a.qRank !== b.qRank) return b.qRank - a.qRank;
                    return b.sizeMB - a.sizeMB;
                });

                var out = [];
                for (var k = 0; k < deduped.length; k++) {
                    var item = deduped[k];
                    var s = item.stream;

                    var header = PROVIDER_NAME + " | " + item.quality + " | " + item.sizeStr + " | " + item.audioType;
                    var details = extractRealDetails(s);
                    var detailsStr = details.length > 0 ? details.join("\n") : header;

                    var sortValue = item.qRank * 100000 + item.sizeMB;
                    var tag = getInvertedSortTag(sortValue, 999999);

                    var card = {
                        name: tag + header,
                        title: detailsStr,
                        size: detailsStr,
                        description: detailsStr,
                        quality: item.qRank === 4 ? "4k" : "1080p",
                        url: s.url
                    };

                    if (s.behaviorHints && s.behaviorHints.headers) {
                        card.headers = s.behaviorHints.headers;
                        card.behaviorHints = s.behaviorHints;
                    } else if (s.headers) {
                        card.headers = s.headers;
                    }

                    out.push(card);
                }

                return out;
            });
    }).catch(function() { return []; });
}

module.exports = { getStreams: getStreams };
