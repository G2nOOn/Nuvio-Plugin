// FourKHDHub Provider for Nuvio — via CNCVerse Bridge
// STRICT 4K UHD & 1080p FHD ONLY — 4K prioritized
// info: uses cncverse.dpdns.org stremio addon

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
    return fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" } })
        .then(function(r) { return r.json(); })
        .then(function(d) { return d.imdb_id || null; })
        .catch(function() { return null; });
}

function classifyQuality(raw) {
    if (!raw) return null;
    var q = String(raw).toUpperCase();
    if (/\b(720P?|480P?|360P?|240P?|SD)\b/.test(q)) return null;
    if (/\b(4K|2160P?|UHD)\b/.test(q)) return "4k";
    if (/\b(1080P?|FHD)\b/.test(q)) return "1080p";
    return null;
}

function fetchCncverse(imdbId, mediaType, season, episode) {
    var type = mediaType === "tv" ? "series" : "movie";
    var id = imdbId;
    if (mediaType === "tv" && season && episode) {
        id = imdbId + ":" + season + ":" + episode;
    }
    var url = CNCVERSE_BASE + "/u/" + CNCVERSE_USER + "/stream/" + type + "/" + id + ".json";

    console.log("[FourKHDHub] Fetching: " + url);

    return fetch(url, {
        headers: { "User-Agent": UA, "Accept": "application/json" }
    })
    .then(function(r) {
        console.log("[FourKHDHub] HTTP " + r.status);
        return r.json();
    })
    .then(function(data) {
        var streams = (data && Array.isArray(data.streams)) ? data.streams : [];
        console.log("[FourKHDHub] Raw streams count: " + streams.length);
        return streams;
    })
    .catch(function(e) {
        console.log("[FourKHDHub] Error: " + e.message);
        return [];
    });
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
    return new Promise(function(resolve) {
        getImdbId(tmdbId, mediaType).then(function(imdbId) {
            if (!imdbId) {
                console.log("[FourKHDHub] No IMDb ID");
                resolve([]);
                return;
            }
            return fetchCncverse(imdbId, mediaType, seasonNum, episodeNum);
        })
        .then(function(streams) {
            var results = [];
            var seenUrls = {};

            for (var i = 0; i < streams.length; i++) {
                var s = streams[i];
                if (!s || !s.url) continue;
                if (seenUrls[s.url]) continue;

                var rawLabel = [
                    s.name || "",
                    s.title || "",
                    s.description || "",
                    s.quality || ""
                ].join(" ");

                var qClass = classifyQuality(rawLabel);
                if (!qClass) {
                    console.log("[FourKHDHub] REJECTED: " + rawLabel.substring(0, 80));
                    continue;
                }

                seenUrls[s.url] = true;

                var sizeMatch = rawLabel.match(/([\d.]+\s*[GM]B)/i);
                var size = sizeMatch ? sizeMatch[1] : "";

                var serverLabel = (s.name || "4KHDHub").split("•")[0].trim();
                var resLabel = qClass === "4k" ? "4K UHD" : "1080p FHD";

                var nameParts = ["📺 CNCVerse", "🏷️ " + serverLabel, resLabel];
                if (size) nameParts.push("📦 " + size);
                var nameLine = nameParts.join(" • ");

                var titleParts = ["🎬 " + (s.title || s.name || "Stream")];
                if (seasonNum && episodeNum) {
                    titleParts.push("S" + String(seasonNum).padStart(2, "0") + "E" + String(episodeNum).padStart(2, "0"));
                }
                titleParts.push("[" + resLabel + "]");
                var titleLine = titleParts.join(" ");

                var card = {
                    name: nameLine,
                    title: titleLine + "\n" + nameLine,
                    description: titleLine + "\n" + nameLine,
                    quality: qClass,
                    size: size,
                    url: s.url
                };

                if (s.behaviorHints && s.behaviorHints.headers) {
                    card.headers = s.behaviorHints.headers;
                } else if (s.headers) {
                    card.headers = s.headers;
                }

                results.push(card);
            }

            results.sort(function(a, b) {
                var rank = { "4k": 2160, "1080p": 1080 };
                return (rank[b.quality] || 0) - (rank[a.quality] || 0);
            });

            var deduped = [];
            var seenSizes = {};
            for (var j = 0; j < results.length; j++) {
                var st = results[j];
                var sizeKey = (st.size || "").trim().toUpperCase();
                if (sizeKey && seenSizes[sizeKey]) continue;
                if (sizeKey) seenSizes[sizeKey] = true;
                deduped.push(st);
            }

            console.log("[FourKHDHub] Final count: " + deduped.length);
            resolve(deduped);
        })
        .catch(function(e) {
            console.log("[FourKHDHub] Fatal: " + e.message);
            resolve([]);
        });
    });
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { getStreams: getStreams };
} else {
    global.getStreams = getStreams;
}
