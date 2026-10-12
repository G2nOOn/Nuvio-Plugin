// FourKHDHub via CNCVerse Bridge - 4K & 1080p only
// Prefers HubCloud [PixelDrain] over other HubCloud servers
// Removes HubCloud [download] landing pages

var CNCVERSE_BASE = "https://cncverse.dpdns.org";
var CNCVERSE_USER = "p_zvmq78raoyj7";
var TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

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

// Remove HubCloud [download] landing pages
function isJunkStream(s) {
    if (!s) return true;
    var txt = ((s.name || "") + " " + (s.title || "") + " " + (s.description || "")).toLowerCase();
    var hasHubcloud = txt.indexOf("hubcloud") !== -1;
    var hasDownload = txt.indexOf("[download]") !== -1 || txt.indexOf("[ download ]") !== -1 || txt.indexOf("download]") !== -1;
    if (hasHubcloud && hasDownload) return true;
    return false;
}

// Server priority - higher wins on tie (size collision)
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

                var card = {
                    name: s.name || "FourKHDHub CloudStream",
                    title: s.title || s.name || "FourKHDHub CloudStream",
                    description: s.description || s.title || s.name || "",
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

            // Sort: quality (4K first), then server priority (PixelDrain > FSL > ...)
            results.sort(function(a, b) {
                var qa = a.quality === "4k" ? 2160 : 1080;
                var qb = b.quality === "4k" ? 2160 : 1080;
                if (qa !== qb) return qb - qa;
                return (b._prio || 0) - (a._prio || 0);
            });

            // Dedupe by size - PixelDrain wins because it's sorted first
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
