// FourKHDHub CloudStream via CNCVerse Bridge
// Formats output like the direct 4KHDHub plugin (multiline with emojis)
// Sort: quality (4K > 1080p), then size DESC within each group

var CNCVERSE_BASE = "https://cncverse.dpdns.org";
var CNCVERSE_USER = "p_zvmq78raoyj7";
var TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
var PROVIDER_NAME = "4KHDHub CloudStream";

function getImdbId(tmdbId, mediaType) {
    if (typeof tmdbId === "string" && tmdbId.indexOf("tt") === 0) return Promise.resolve(tmdbId);
    var endpoint = mediaType === "tv" ? "tv" : "movie";
    var url = "https://api.themoviedb.org/3/" + endpoint + "/" + tmdbId + "/external_ids?api_key=" + TMDB_API_KEY;
    return fetch(url, { headers: { "User-Agent": UA } })
        .then(function(r) { return r.json(); })
        .then(function(d) { return d.imdb_id || null; })
        .catch(function() { return null; });
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

function qualityRank(qClass) {
    if (qClass === "4k") return 4;
    if (qClass === "1080p") return 3;
    return 0;
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

function sizeToMB(sizeStr) {
    if (!sizeStr) return 0;
    var m = String(sizeStr).match(/(\d+(?:\.\d+)?)\s*(GB|MB|KB)/i);
    if (!m) return 0;
    var v = parseFloat(m[1]);
    var u = m[2].toUpperCase();
    if (u === "KB") return v / 1024;
    if (u === "GB") return v * 1024;
    if (u === "MB") return v;
    return 0;
}

// Parse all fields from CNCVerse stream data
function parseStreamInfo(s, contextTitle, seasonNum, episodeNum) {
    var nameText = s.name || "";
    var titleText = s.title || "";
    var descText = s.description || "";
    var allText = nameText + "\n" + titleText + "\n" + descText;

    // Quality
    var quality = "1080p";
    var upper = allText.toUpperCase();
    if (upper.indexOf("2160P") !== -1 || upper.indexOf("4K") !== -1 || upper.indexOf("UHD") !== -1) quality = "2160p";
    else if (upper.indexOf("1080P") !== -1 || upper.indexOf("FHD") !== -1) quality = "1080p";

    // Size - prefer [X.XX GB] or [XXX MB]
    var size = "N/A";
    var sizeMatch = allText.match(/\[\s*(\d+(?:\.\d+)?)\s*(GB|MB|KB)\s*\]/i);
    if (sizeMatch) {
        size = sizeMatch[1] + " " + sizeMatch[2].toUpperCase();
    } else {
        sizeMatch = allText.match(/(\d+(?:\.\d+)?)\s*(GB|MB|KB)/i);
        if (sizeMatch) size = sizeMatch[1] + " " + sizeMatch[2].toUpperCase();
    }

    // Source
    var source = "WEB-DL";
    if (/\bBLURAY\b|\bBLU-RAY\b|\bBDRIP\b|\bBRRIP\b/i.test(allText)) source = "BluRay";
    else if (/\bHDTV\b/i.test(allText)) source = "HDTV";
    else if (/\bWEB-?DL\b|\bWEBRIP\b|\bWEB\b/i.test(allText)) source = "WEB-DL";

    // Codec
    var codec = "H.264";
    if (/\bH\.?265\b|\bHEVC\b|\bX265\b/i.test(allText)) codec = "H.265";
    else if (/\bH\.?264\b|\bX264\b|\bAVC\b/i.test(allText)) codec = "H.264";

    // HDR
    var hdr = "SDR";
    if (/\bHDR10\+\b/i.test(allText)) hdr = "HDR10+";
    else if (/\bDOLBY\s*VISION\b|\bDOVI\b/i.test(allText)) hdr = "DV";
    else if (/\bHDR10\b|\bHDR\b/i.test(allText)) hdr = "HDR";

    // Audio type
    var audioType = "Single-Audio";
    if (/\bMULTI-?AUDIO\b/i.test(allText)) audioType = "Multi-Audio";
    else if (/\bDUAL-?AUDIO\b|\bDUBBED\b|\bHINDI\b/i.test(allText)) audioType = "Dual-Audio";

    // Audio codec
    var audioCodec = "";
    if (/\bATMOS\b/i.test(allText)) audioCodec = "Atmos";
    else if (/\bTRUEHD\b/i.test(allText)) audioCodec = "TrueHD";
    else if (/\bDDP5\.1\b|\bDDP\s*5\.1\b|\bEAC3\b/i.test(allText)) audioCodec = "DDP5.1";
    else if (/\bDD5\.1\b|\bDD\s*5\.1\b|\bAC3\b/i.test(allText)) audioCodec = "DD5.1";
    else if (/\bDD\+\b|\bDDP\b/i.test(allText)) audioCodec = "DD+";
    else if (/\bAAC\b/i.test(allText)) audioCodec = "AAC";

    // Container
    var container = "MKV";
    if (/\.MP4\b/i.test(allText)) container = "MP4";

    // Title / Year / Episode from title field
    var displayTitle = contextTitle;
    var displayYear = "";
    var epStr = "";

    var lines = (titleText + "\n" + descText).split("\n");
    for (var i = 0; i < lines.length; i++) {
        var l = lines[i].trim();
        if (!l) continue;
        if (/^CNCVerse/i.test(l)) continue;
        if (/^Source:/i.test(l)) continue;
        if (/^FourKHDHub/i.test(l) && l.indexOf("|") === -1) continue;
        // Found title line
        var yearMatch = l.match(/\((\d{4})\)/);
        if (yearMatch) displayYear = yearMatch[1];

        var epMatch = l.match(/\bS(\d+)E(\d+)\b/i);
        if (epMatch) {
            epStr = "S" + ("0" + epMatch[1]).slice(-2) + "E" + ("0" + epMatch[2]).slice(-2);
        }

        var tPart = l.split(/[•|]/)[0].trim();
        if (tPart.indexOf(" - ") !== -1) tPart = tPart.split(" - ")[0].trim();
        if (tPart && tPart.length > 1) displayTitle = tPart;
        break;
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

function buildName(info) {
    return PROVIDER_NAME + " | " + info.quality + " | " + info.size + " | " + info.audioType;
}

function buildTitle(info) {
    var line1 = "🎬 " + info.title + (info.year ? " - (" + info.year + ")" : "") + (info.episode ? " | " + info.episode : "");
    var qEmoji = info.quality === "2160p" ? "⚡" : "🔥";
    var line2 = qEmoji + " " + info.quality + " | 💾 " + info.size + " | 📼 " + info.container;
    var line3 = "🌈 " + info.hdr + " | 🎥 " + info.codec;
    var line4 = "🌍 " + info.audioType + (info.audioCodec ? " | 🎧 " + info.audioCodec : "");
    var line5 = "🎬 4KHDHub.com 🗂️ " + info.source;
    return [line1, line2, line3, line4, line5].join("\n");
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
                var streams = data && data.streams ? data.streams : [];
                var results = [];
                var seenUrls = {};

                for (var i = 0; i < streams.length; i++) {
                    var s = streams[i];
                    if (isPromo(s)) continue;
                    if (isJunkStream(s)) continue;
                    if (seenUrls[s.url]) continue;

                    var label = (s.name || "") + " " + (s.title || "") + " " + (s.description || "");
                    var qClass = classifyQuality(label);
                    if (!qClass) continue;

                    seenUrls[s.url] = true;

                    // Extract context title from CNCVerse's name field
                    var ctxTitle = "Unknown";
                    var nameFirst = (s.name || "").split(/[•|]/);
                    if (nameFirst.length > 0) {
                        var maybe = nameFirst[nameFirst.length - 1].trim();
                        if (maybe && !/CNCVerse|FourKHDHub|1080|2160|4K/i.test(maybe)) ctxTitle = maybe;
                    }

                    var info = parseStreamInfo(s, ctxTitle, seasonNum, episodeNum);
                    var nameStr = buildName(info);
                    var titleStr = buildTitle(info);

                    var card = {
                        name: nameStr,
                        title: titleStr,
                        description: titleStr,
                        quality: qClass,
                        size: info.size,
                        url: s.url
                    };

                    if (s.behaviorHints && s.behaviorHints.headers) {
                        card.headers = s.behaviorHints.headers;
                    } else if (s.headers) {
                        card.headers = s.headers;
                    }

                    card._qRank = qualityRank(qClass);
                    card._sizeMB = sizeToMB(info.size);
                    results.push(card);
                }

                // Sort: quality desc, then size desc
                results.sort(function(a, b) {
                    if (b._qRank !== a._qRank) return b._qRank - a._qRank;
                    return b._sizeMB - a._sizeMB;
                });

                // Dedupe by quality + size
                var deduped = [];
                var seenKeys = {};
                for (var j = 0; j < results.length; j++) {
                    var st = results[j];
                    var key = st.quality + "::" + st._sizeMB;
                    if (seenKeys[key]) continue;
                    seenKeys[key] = true;
                    delete st._qRank;
                    delete st._sizeMB;
                    deduped.push(st);
                }

                return deduped;
            });
    }).catch(function() { return []; });
}

module.exports = { getStreams: getStreams };
