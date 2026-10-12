// FourKHDHub CloudStream via CNCVerse Bridge
// Same format as original 4KHDHub plugin: header + multiline details
// Filter: 4K & 1080p only | Dedupe: PixelDrain priority
// Sort: quality desc, then size desc

var CNCVERSE_BASE = "https://cncverse.dpdns.org";
var CNCVERSE_USER = "p_zvmq78raoyj7";
var TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
var PROVIDER_NAME = "FourKHDHub CloudStream";
var SITE_NAME = "4KHDHub.com";

function getImdbId(tmdbId, mediaType) {
    if (typeof tmdbId === "string" && tmdbId.indexOf("tt") === 0) return Promise.resolve(tmdbId);
    var endpoint = mediaType === "tv" ? "tv" : "movie";
    var url = "https://api.themoviedb.org/3/" + endpoint + "/" + tmdbId + "/external_ids?api_key=" + TMDB_API_KEY;
    return fetch(url, { headers: { "User-Agent": UA } })
        .then(function(r) { return r.json(); })
        .then(function(d) { return d.imdb_id || null; })
        .catch(function() { return null; });
}

function getTmdbMeta(tmdbId, mediaType) {
    var endpoint = mediaType === "tv" ? "tv" : "movie";
    var url = "https://api.themoviedb.org/3/" + endpoint + "/" + tmdbId + "?api_key=" + TMDB_API_KEY;
    return fetch(url, { headers: { "User-Agent": UA } })
        .then(function(r) { return r.json(); })
        .then(function(d) {
            var title = mediaType === "tv" ? (d.name || d.original_name) : (d.title || d.original_title);
            var date = mediaType === "tv" ? d.first_air_date : d.release_date;
            var year = date ? date.substring(0, 4) : "";
            return { title: title || "", year: year };
        })
        .catch(function() { return { title: "", year: "" }; });
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

function getAudioCodec(s) {
    var txt = (s.name || "") + " " + (s.title || "") + " " + (s.description || "");
    var atmos = /\bATMOS\b/i.test(txt);
    var suffix = atmos ? " • 🔊 Atmos" : "";
    if (/\bTRUEHD\b/i.test(txt)) return "TrueHD" + suffix;
    if (/\bDDP5\.1\b|\bDDP\s*5\.1\b|\bEAC3\b/i.test(txt)) return "DDP5.1" + suffix;
    if (/\bDD5\.1\b|\bDD\s*5\.1\b|\bAC3\b/i.test(txt)) return "DD5.1" + suffix;
    if (/\bDDP\b|\bDD\+\b/i.test(txt)) return "DDP5.1" + suffix;
    if (/\bAAC\b/i.test(txt)) return "AAC" + suffix;
    if (atmos) return "DDP5.1 • 🔊 Atmos";
    return "DD5.1";
}

function getHdr(s) {
    var txt = (s.name || "") + " " + (s.title || "") + " " + (s.description || "");
    if (/\bHDR10\+\b/i.test(txt)) return "HDR10+";
    if (/\bDOLBY\s*VISION\b|\bDOVI\b|\bDV\b/i.test(txt)) return "DV";
    return "HDR";
}

function getCodec(s) {
    var txt = (s.name || "") + " " + (s.title || "") + " " + (s.description || "");
    if (/\bH\.?265\b|\bHEVC\b|\bX265\b/i.test(txt)) return "H.265";
    return "H.264";
}

function getContainer(s) {
    var txt = (s.name || "") + " " + (s.title || "") + " " + (s.description || "");
    if (/\bMP4\b/i.test(txt)) return "MP4";
    return "MKV";
}

function getSource(s) {
    var txt = (s.name || "") + " " + (s.title || "") + " " + (s.description || "");
    if (/\bBLURAY\b|\bBLU-RAY\b|\bBDRIP\b|\bBRRIP\b/i.test(txt)) return "BluRay";
    if (/\bHDTV\b/i.test(txt)) return "HDTV";
    return "WEB-DL";
}

function buildHeader(quality, sizeStr, audioType) {
    return PROVIDER_NAME + " | " + quality + " | " + sizeStr + " | " + audioType;
}

function buildDetails(meta, quality, sizeStr, s, episodeStr) {
    var titleLine = "🎬 " + meta.title + (meta.year ? " - (" + meta.year + ")" : "") + (episodeStr ? " | " + episodeStr : "");
    var qEmoji = quality === "2160p" ? "⚡" : "🔥";
    var line2 = qEmoji + " " + quality + " | 💾 " + sizeStr + " | 📼 " + getContainer(s);
    var line3 = "🌈 " + getHdr(s) + " | 🎥 " + getCodec(s);
    var line4 = "🌍 " + getAudioType(s) + " | 🎧 " + getAudioCodec(s);
    var line5 = "🎬 " + SITE_NAME + " 🗂️ " + getSource(s);
    return [titleLine, line2, line3, line4, line5].join("\n");
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
    return Promise.all([
        getImdbId(tmdbId, mediaType),
        getTmdbMeta(tmdbId, mediaType)
    ]).then(function(results) {
        var imdbId = results[0];
        var meta = results[1];
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

                var episodeStr = "";
                if (mediaType === "tv" && seasonNum && episodeNum) {
                    episodeStr = "S" + String(seasonNum).padStart(2, "0") + "E" + String(episodeNum).padStart(2, "0");
                }

                var out = [];
                for (var k = 0; k < deduped.length; k++) {
                    var item = deduped[k];
                    var s = item.stream;

                    var header = buildHeader(item.quality, item.sizeStr, item.audioType);
                    var details = buildDetails(meta, item.quality, item.sizeStr, s, episodeStr);

                    var sortValue = item.qRank * 100000 + item.sizeMB;
                    var tag = getInvertedSortTag(sortValue, 999999);

                    var card = {
                        name: tag + header,
                        title: details,
                        description: details,
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
