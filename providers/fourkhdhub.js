// FourKHDHub CloudStream via CNCVerse Bridge
// All info in name (multiline), sorted: quality (4K > 1080p), then size DESC

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

function parseStream(s, contextTitle, seasonNum, episodeNum) {
    var allText = (s.name || "") + "\n" + (s.title || "") + "\n" + (s.description || "");
    var upper = allText.toUpperCase();

    var quality = "1080p";
    if (upper.indexOf("2160") !== -1 || upper.indexOf("4K") !== -1 || upper.indexOf("UHD") !== -1) quality = "2160p";

    var size = getSizeStr(s);

    var source = "WEB-DL";
    if (/\bBLURAY\b|\bBLU-RAY\b|\bBDRIP\b|\bBRRIP\b/i.test(allText)) source = "BluRay";
    else if (/\bHDTV\b/i.test(allText)) source = "HDTV";

    var codec = "H.264";
    if (/\bH\.?265\b|\bHEVC\b|\bX265\b/i.test(allText)) codec = "H.265";

    var hdr = "HDR";
    if (/\bHDR10\+\b/i.test(allText)) hdr = "HDR10+";
    else if (/\bDOLBY\s*VISION\b|\bDOVI\b|\bDV\b/i.test(allText)) hdr = "DV";
    else if (/\bHDR10\b|\bHDR\b/i.test(allText)) hdr = "HDR";

    var audioType = "Single-Audio";
    if (/\bMULTI-?AUDIO\b/i.test(allText)) audioType = "Multi-Audio";
    else if (/\bDUAL-?AUDIO\b|\bDUBBED\b|\bHINDI\b/i.test(allText)) audioType = "Dual-Audio";

    var audioCodec = "DD5.1";
    if (/\bATMOS\b/i.test(allText)) audioCodec = "DDP5.1 • 🔊 Atmos";
    else if (/\bTRUEHD\b/i.test(allText)) audioCodec = "TrueHD";
    else if (/\bDDP\b|\bEAC3\b/i.test(allText)) audioCodec = "DDP5.1";
    else if (/\bAAC\b/i.test(allText)) audioCodec = "AAC";

    var container = "MKV";
    if (/\.MP4\b/i.test(allText)) container = "MP4";

    var displayTitle = contextTitle || "Unknown";
    var displayYear = "";
    var epStr = "";
    var lines = (s.title || "").split("\n");
    for (var i = 0; i < lines.length; i++) {
        var l = lines[i].trim();
        if (!l) continue;
        if (/^CNCVerse/i.test(l)) continue;
        if (/^Source:/i.test(l)) continue;
        var ym = l.match(/\((\d{4})\)/);
        if (ym) displayYear = ym[1];
        var em = l.match(/\bS(\d+)E(\d+)\b/i);
        if (em) epStr = "S" + ("0" + em[1]).slice(-2) + "E" + ("0" + em[2]).slice(-2);
        if (!displayYear && !epStr) {
            var t = l.split(/[•|]/)[0].trim();
            if (t && t.indexOf(" - ") !== -1) t = t.split(" - ")[0].trim();
            if (t && !/WEB-?DL|BluRay|HDR|MKV|MP4/i.test(t)) displayTitle = t;
        }
    }
    if (!epStr && seasonNum && episodeNum) {
        epStr = "S" + ("0" + seasonNum).slice(-2) + "E" + ("0" + episodeNum).slice(-2);
    }

    return {
        quality: quality,
        size: size,
        source: source,
        codec: codec,
        hdr: hdr,
        audioType: audioType,
        audioCodec: audioCodec,
        container: container,
        title: displayTitle,
        year: displayYear,
        episode: epStr
    };
}

function buildFullName(info) {
    var header = PROVIDER_NAME + " | " + info.quality + " | " + info.size + " | " + info.audioType;
    var line1 = "🎬 " + info.title + (info.year ? " - (" + info.year + ")" : "") + (info.episode ? " | " + info.episode : "");
    var qEmoji = info.quality === "2160p" ? "⚡" : "🔥";
    var line2 = qEmoji + " " + info.quality + " | 💾 " + info.size + " | 📼 " + info.container;
    var line3 = "🌈 " + info.hdr + " | 🎥 " + info.codec;
    var line4 = "🌍 " + info.audioType + " | 🎧 " + info.audioCodec;
    var line5 = "🎬 4KHDHub.com 🗂️ " + info.source;
    return [header, line1, line2, line3, line4, line5].join("\n");
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

                var filtered = [];
                var seenUrls = {};
                for (var i = 0; i < raw.length; i++) {
                    var s = raw[i];
                    if (isPromo(s)) continue;
                    if (isJunkStream(s)) continue;
                    var qRank = getQualityRank(s);
                    if (qRank === -1) continue;
                    if (seenUrls[s.url]) continue;
                    seenUrls[s.url] = true;
                    s._qRank = qRank;
                    s._sizeMB = getSizeMB(s);
                    filtered.push(s);
                }

                filtered.sort(function(a, b) {
                    if (a._qRank !== b._qRank) return b._qRank - a._qRank;
                    return b._sizeMB - a._sizeMB;
                });

                var results = [];
                var seenKeys = {};
                for (var j = 0; j < filtered.length; j++) {
                    var st = filtered[j];
                    var qClass = st._qRank === 4 ? "4k" : "1080p";
                    var dedupeKey = qClass + "::" + Math.round(st._sizeMB);
                    if (seenKeys[dedupeKey]) continue;
                    seenKeys[dedupeKey] = true;

                    var ctxTitle = "Unknown";
                    var nameParts = (st.name || "").split(/[•|]/);
                    if (nameParts.length > 0) {
                        var maybe = nameParts[nameParts.length - 1].trim();
                        if (maybe && !/CNCVerse|FourKHDHub|4KHDHub|1080|2160|4K/i.test(maybe)) ctxTitle = maybe;
                    }

                    var info = parseStream(st, ctxTitle, seasonNum, episodeNum);
                    var fullName = buildFullName(info);

                    var card = {
                        name: fullName,
                        title: fullName,
                        description: fullName,
                        quality: qClass,
                        url: st.url
                    };

                    if (st.behaviorHints && st.behaviorHints.headers) {
                        card.headers = st.behaviorHints.headers;
                    } else if (st.headers) {
                        card.headers = st.headers;
                    }

                    results.push(card);
                }

                return results;
            });
    }).catch(function() { return []; });
}

module.exports = { getStreams: getStreams };
