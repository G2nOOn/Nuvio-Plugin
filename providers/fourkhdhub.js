// FourKHDHub CloudStream via CNCVerse Bridge
// Keep: HubCloud [PixelDrain] preferred
// Delete: HubCloud [FSL Server] when duplicate | HubCloud [download] always
// name = header + invisible tag | title/size/description = details multiline

var CNCVERSE_BASE = "https://cncverse.dpdns.org";
var CNCVERSE_USER = "p_zvmq78raoyj7";
var TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
var PROVIDER_NAME = "FourKHDHub CloudStream";

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

// Delete HubCloud [download] landing pages
function isJunkStream(s) {
    if (!s) return true;
    var txt = ((s.name || "") + " " + (s.title || "") + " " + (s.description || "")).toLowerCase();
    var hasHubcloud = txt.indexOf("hubcloud") !== -1;
    var hasDownload = txt.indexOf("[download]") !== -1 || txt.indexOf("download]") !== -1;
    return hasHubcloud && hasDownload;
}

// Server priority: PixelDrain (100) > others (10)
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

function cleanInvisible(str) {
    if (!str) return "";
    return String(str).replace(/[\ufeff\u200b]/g, "");
}

function buildDetailLines(s) {
    var out = [];
    var sources = [s.title, s.description];
    for (var f = 0; f < sources.length; f++) {
        if (!sources[f]) continue;
        var lines = String(sources[f]).split("\n");
        for (var i = 0; i < lines.length; i++) {
            var line = cleanInvisible(lines[i]).trim();
            if (!line) continue;
            if (/CNCVerse/i.test(line)) continue;
            if (/^FourKHDHub\s*$/i.test(line)) continue;
            out.push(line);
        }
        if (out.length > 0) break;
    }
    return out;
}

function getAudioType(s) {
    var txt = ((s.name || "") + " " + (s.title || "") + " " + (s.description || "")).toUpperCase();
    if (/\bMULTI-?AUDIO\b/.test(txt)) return "Multi-Audio";
    if (/\bDUAL-?AUDIO\b|\bDUBBED\b|\bHINDI\b/.test(txt)) return "Dual-Audio";
    return "Single-Audio";
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

                // Step 1: Filter + collect info
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

                    var sizeMB = getSizeMB(s);
                    var sizeStr = getSizeStr(s);
                    var quality = qRank === 4 ? "2160p" : "1080p";
                    var audioType = getAudioType(s);
                    var prio = getServerPriority(s);

                    candidates.push({
                        stream: s,
                        qRank: qRank,
                        sizeMB: sizeMB,
                        sizeStr: sizeStr,
                        quality: quality,
                        audioType: audioType,
                        prio: prio
                    });
                }

                // Step 2: Sort - highest priority (PixelDrain) first, then quality, then size
                candidates.sort(function(a, b) {
                    if (a.prio !== b.prio) return b.prio - a.prio;
                    if (a.qRank !== b.qRank) return b.qRank - a.qRank;
                    return b.sizeMB - a.sizeMB;
                });

                // Step 3: Dedupe by quality + size - first (PixelDrain) wins
                var deduped = [];
                var seenKeys = {};
                for (var j = 0; j < candidates.length; j++) {
                    var c = candidates[j];
                    var key = c.qRank + "::" + Math.round(c.sizeMB);
                    if (seenKeys[key]) continue;
                    seenKeys[key] = true;
                    deduped.push(c);
                }

                // Step 4: Sort again by quality + size for final display order
                deduped.sort(function(a, b) {
                    if (a.qRank !== b.qRank) return b.qRank - a.qRank;
                    return b.sizeMB - a.sizeMB;
                });

                // Step 5: Build output
                var results = [];
                for (var k = 0; k < deduped.length; k++) {
                    var item = deduped[k];
                    var s = item.stream;

                    var header = PROVIDER_NAME + " | " + item.quality + " | " + item.sizeStr + " | " + item.audioType;
                    var sortValue = item.qRank * 100000 + item.sizeMB;
                    var tag = getInvertedSortTag(sortValue, 999999);

                    var detailLines = buildDetailLines(s);
                    var detailStr = detailLines.length > 0 ? detailLines.join("\n") : header;

                    var card = {
                        name: tag + header,
                        title: detailStr,
                        description: detailStr,
                        size: detailStr,
                        quality: item.qRank === 4 ? "4k" : "1080p",
                        url: s.url
                    };

                    if (s.behaviorHints && s.behaviorHints.headers) {
                        card.headers = s.behaviorHints.headers;
                        card.behaviorHints = s.behaviorHints;
                    } else if (s.headers) {
                        card.headers = s.headers;
                    }

                    results.push(card);
                }

                return results;
            });
    }).catch(function() { return []; });
}

module.exports = { getStreams: getStreams };
