// downloadeverything Provider for Nuvio
// Source: slave.downloadeverythingfromeverywhere.com (NDJSON search API)
// Hermes-safe: no async/await, no const/let, no arrow functions

var TMDB_API_KEY =
    (typeof globalThis !== "undefined" && globalThis.TMDB_API_KEY) ||
    (typeof self !== "undefined" && self.TMDB_API_KEY) ||
    "439c478a771f35c05022f9feabcca01c";

var TMDB_DIRECT = "https://api.themoviedb.org/3";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";
var SLAVE_URL = "https://slave.downloadeverythingfromeverywhere.com/";
var ORIGIN = "https://downloadeverythingfromeverywhere.com";

var SKIP_DOMAINS = [
    "111477.xyz",
    "vadapav.mov",
    "driveseed.org",
    "new3.gdflix.io",
    "rapidrar.cr",
    "megaup.net",
    "telegram.dog",
    "t.me"
];

var _metaCache = {};

// ── Helpers ─────────────────────────────────────────────────────────────────

function fetchWithTimeout(url, opts, ms) {
    return Promise.race([
        fetch(url, opts),
        new Promise(function(_, rej) {
            setTimeout(function() { rej(new Error("timeout")); }, ms || 20000);
        })
    ]);
}

function delay(ms) {
    return new Promise(function(res) { setTimeout(res, ms); });
}

function normalizeQuality(q) {
    q = String(q || "").toLowerCase();
    if (q === "2160p" || q === "4k") return "4K";
    if (q === "1080p") return "1080P";
    if (q === "720p") return "720P";
    if (q === "480p") return "480P";
    return "1080P";
}

function formEncode(obj) {
    var parts = [];
    for (var k in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, k)) {
            parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(obj[k]));
        }
    }
    return parts.join("&");
}

// ── TMDB Metadata Resolution ────────────────────────────────────────────────

function resolveMeta(tmdbId, mediaType) {
    var kind = mediaType === "tv" ? "tv" : "movie";
    var ck = kind + ":" + tmdbId;
    if (_metaCache[ck]) return Promise.resolve(_metaCache[ck]);

    if (!TMDB_API_KEY) {
        console.log("[DE] TMDB_API_KEY missing");
        return Promise.resolve(null);
    }

    var url = TMDB_DIRECT + "/" + kind + "/" + tmdbId +
              "?append_to_response=external_ids&api_key=" + TMDB_API_KEY;

    return fetchWithTimeout(url, { headers: { "User-Agent": UA, "Accept": "application/json" } }, 15000)
    .then(function(r) {
        if (r.status && r.status >= 400) throw new Error("HTTP " + r.status);
        return r.text();
    })
    .then(function(txt) {
        var j = null;
        try { j = JSON.parse(txt); } catch (e) { return null; }
        if (!j) return null;
        var title = kind === "tv" ? (j.name || j.original_name) : (j.title || j.original_title);
        var dateStr = kind === "tv" ? j.first_air_date : j.release_date;
        var year = dateStr ? parseInt(String(dateStr).slice(0, 4), 10) : null;
        var imdbId = (j.external_ids && j.external_ids.imdb_id) || j.imdb_id || null;
        var meta = { title: title, year: year, imdbId: imdbId };
        _metaCache[ck] = meta;
        console.log("[DE] TMDB title=" + title + " imdb=" + imdbId);
        return meta;
    })
    .catch(function(e) {
        console.log("[DE] TMDB error: " + e.message);
        return null;
    });
}

// ── HubCloud resolver ───────────────────────────────────────────────────────

function resolveHubCloud(hubUrl) {
    return fetchWithTimeout(hubUrl, { headers: { "User-Agent": UA, "Referer": ORIGIN + "/" } }, 8000)
    .then(function(r) { return r.text(); })
    .then(function(html) {
        var m = /https?:\/\/[^\s"'<>]*\/hubcloud\.php\?[^\s"'<>]*/.exec(html);
        if (!m) return null;
        var phpUrl = m[0];
        return fetchWithTimeout(phpUrl, { headers: { "User-Agent": UA, "Referer": hubUrl } }, 8000)
        .then(function(r2) { return r2.text(); })
        .then(function(body) {
            var r2m = /https?:\/\/[a-zA-Z0-9.\-_]+\.r2\.cloudflarestorage\.com\/[^\s"'<>]+/.exec(body);
            if (r2m) return r2m[0].split("&amp;").join("&");
            var pm = /https?:\/\/pixel\.hubcloud\.[a-z]+\/\?id=[^\s"'<>]+/.exec(body);
            if (pm) return pm[0];
            return null;
        });
    })
    .catch(function() { return null; });
}

// ── ClicknUpload resolver ──────────────────────────────────────────────────

function parsePostFormInputs(html) {
    var formMatch = /<form[^>]+method=["']POST["'][^>]*>([\s\S]*?)<\/form>/i.exec(html);
    if (!formMatch) return null;
    var params = {};
    var inputRe = /<input[^>]*>/gi;
    var im;
    while ((im = inputRe.exec(formMatch[1])) !== null) {
        var tag = im[0];
        var nm = /name=["']([^"']+)["']/i.exec(tag);
        var vm = /value=["']([^"']*)["']/i.exec(tag);
        if (nm) params[nm[1]] = vm ? vm[1] : "";
    }
    return params;
}

function resolveClicknUpload(url) {
    var cookies = "";
    return fetchWithTimeout(url, { headers: { "User-Agent": UA, "Referer": ORIGIN + "/" } }, 8000)
    .then(function(r) {
        try { cookies = r.headers.get("set-cookie") || ""; } catch (e) { cookies = ""; }
        return r.text();
    })
    .then(function(html1) {
        var p1 = parsePostFormInputs(html1);
        if (!p1) return null;
        p1["method_free"] = "Slow Download";

        var h = {
            "User-Agent": UA,
            "Referer": url,
            "Content-Type": "application/x-www-form-urlencoded"
        };
        if (cookies) h["Cookie"] = cookies;

        return fetchWithTimeout(url, { method: "POST", headers: h, body: formEncode(p1) }, 8000)
        .then(function(r2) { return r2.text(); })
        .then(function(html2) {
            var p2 = parsePostFormInputs(html2);
            if (!p2) return null;
            p2["down_script"] = "1";

            return delay(4500)
            .then(function() {
                return fetchWithTimeout(url, { method: "POST", headers: h, body: formEncode(p2) }, 8000);
            })
            .then(function(r3) { return r3.text(); })
            .then(function(html3) {
                var found = null;
                var dm = /https?:\/\/[a-zA-Z0-9.\-_:]+\/d\/[a-zA-Z0-9_\-\/.]+/.exec(html3);
                if (dm) found = dm[0];
                if (!found) {
                    var wm = /window\.open\(["'](https?:\/\/[^"']+)["']\)/.exec(html3);
                    if (wm) found = wm[1];
                }
                if (!found) return null;
                if (found.indexOf("clicknupload.") !== -1 && found.indexOf("/d/") === -1) return null;
                return found;
            });
        });
    })
    .catch(function() { return null; });
}

// ── Direct MP4/MKV verification ─────────────────────────────────────────────

function verifyDirect(url) {
    return fetchWithTimeout(url, { method: "HEAD", headers: { "User-Agent": UA } }, 6000)
    .then(function(r) {
        var s = r.status || 0;
        return (s === 200 || s === 206 || s === 302) ? url : null;
    })
    .catch(function() { return null; });
}

// ── Item resolver ───────────────────────────────────────────────────────────

function resolveItem(item, fallbackTitle) {
    var rawUrl = item.url ? String(item.url) : "";
    if (!rawUrl) return Promise.resolve(null);

    for (var i = 0; i < SKIP_DOMAINS.length; i++) {
        if (rawUrl.indexOf(SKIP_DOMAINS[i]) !== -1) return Promise.resolve(null);
    }

    var provider = item.site ? String(item.site) : "DownloadEverything";
    var streamHeaders = null;
    var directPromise = null;

    if (rawUrl.indexOf("hakunaymatata.com") !== -1) {
        directPromise = Promise.resolve(rawUrl);
        provider = "Moviebox";
        streamHeaders = { "User-Agent": "Lavf/60.16.100" };
    } else if (rawUrl.indexOf("pixeldrain.dev") !== -1 || rawUrl.indexOf("pixeldrain.com") !== -1) {
        var pm = /pixeldrain\.(?:dev|com)\/(?:u|l)\/([a-zA-Z0-9_-]+)/.exec(rawUrl);
        if (pm) {
            directPromise = Promise.resolve("https://pixeldrain.com/api/file/" + pm[1]);
            provider = "Pixeldrain";
            streamHeaders = { "User-Agent": UA };
        }
    } else if (rawUrl.indexOf("hubcloud.") !== -1 || rawUrl.indexOf("vcloud.zip") !== -1) {
        directPromise = resolveHubCloud(rawUrl).then(function(u) {
            if (u) {
                provider = "HubCloud";
                streamHeaders = { "User-Agent": UA };
            }
            return u;
        });
    } else if (rawUrl.indexOf("clicknupload.") !== -1) {
        directPromise = resolveClicknUpload(rawUrl).then(function(u) {
            if (u) {
                provider = "ClicknUpload";
                streamHeaders = { "User-Agent": UA };
            }
            return u;
        });
    } else if (/\.(mp4|mkv)(\?|$)/i.test(rawUrl) &&
               rawUrl.indexOf("111477.xyz") === -1 &&
               rawUrl.indexOf("vadapav.mov") === -1 &&
               rawUrl.indexOf(".cyou/res/") === -1) {
        directPromise = verifyDirect(rawUrl).then(function(u) {
            if (u) {
                provider = item.site ? String(item.site) : "DirectStream";
                streamHeaders = { "User-Agent": UA };
            }
            return u;
        });
    }

    if (!directPromise) return Promise.resolve(null);

    return directPromise.then(function(directUrl) {
        if (!directUrl) return null;

        var tags = [];
        if (item.tags && item.tags.length) {
            for (var t = 0; t < item.tags.length; t++) tags.push(String(item.tags[t]));
        }

        var qualityTag = "1080p";
        for (var q = 0; q < tags.length; q++) {
            if (/(2160p|4k|1080p|720p|480p)/i.test(tags[q])) { qualityTag = tags[q]; break; }
        }
        var qualityUp = normalizeQuality(qualityTag);

        var rawTitle = item.name ? String(item.name)
                       : (item.release ? String(item.release) : fallbackTitle);
        var tagsStr = tags.length ? tags.join(" · ") : qualityUp;

        var mainTitle = "[" + provider + "] " + rawTitle + " (" + qualityUp + ")";
        var infoLine = qualityUp + " · " + tagsStr + " · " + provider;

        return {
            name: mainTitle,
            title: mainTitle,
            size: infoLine,
            url: directUrl,
            quality: qualityUp,
            headers: streamHeaders || { "User-Agent": UA }
        };
    });
}

// ═════════════════════════════════════════════════════════════════════════════
// MAIN getStreams
// ═════════════════════════════════════════════════════════════════════════════

function getStreams(tmdbId, mediaType, season, episode) {
    console.log("[DE] ==== ENTERED ==== tmdb=" + tmdbId + " type=" + mediaType + " key=" + (TMDB_API_KEY ? "YES" : "NO"));

    var isTv = mediaType === "tv";
    var sea = parseInt(season, 10) || 1;
    var ep = parseInt(episode, 10) || 1;

    console.log("[DE] START " + (isTv ? "tv" : "movie") +
                " tmdb=" + tmdbId + (isTv ? " S" + sea + "E" + ep : ""));

    return resolveMeta(tmdbId, mediaType)
    .then(function(meta) {
        if (!meta || !meta.title) {
            console.log("[DE] no meta — aborting");
            return [];
        }

        var payload = {
            mode: isTv ? "series" : "movie",
            title: meta.title
        };
        if (meta.year) payload.year = String(meta.year);
        payload.tmdb_id = tmdbId;
        if (meta.imdbId) payload.imdb_id = meta.imdbId;
        if (isTv) { payload.season = sea; payload.episode = ep; }

        console.log("[DE] payload=" + JSON.stringify(payload));

        return fetchWithTimeout(SLAVE_URL, {
            method: "POST",
            headers: {
                "User-Agent": UA,
                "Origin": ORIGIN,
                "Referer": ORIGIN + "/",
                "Content-Type": "application/json",
                "Accept": "application/json"
            },
            body: JSON.stringify(payload)
        }, 30000)
        .then(function(r) {
            console.log("[DE] slave status=" + r.status);
            if (r.status && r.status >= 400) return "";
            return r.text();
        })
        .then(function(text) {
            console.log("[DE] slave response chars=" + text.length);

            var items = [];
            var lines = String(text || "").split("\n");
            for (var i = 0; i < lines.length; i++) {
                var line = lines[i].trim();
                if (!line) continue;
                var parsed = null;
                try { parsed = JSON.parse(line); } catch (e) { continue; }
                if (!parsed || parsed.t !== "hit" || !parsed.links || !parsed.links.length) continue;

                var site = parsed.site ? String(parsed.site) : "DownloadEverything";
                console.log("[DE] hit from " + site + ": " + parsed.links.length + " candidate(s)");

                for (var j = 0; j < parsed.links.length; j++) {
                    var l = parsed.links[j];
                    if (l && typeof l === "object") {
                        var it = {};
                        for (var k in l) it[k] = l[k];
                        it.site = site;
                        items.push(it);
                    }
                }
            }

            console.log("[DE] total candidates: " + items.length);

            if (items.length === 0) {
                return [];
            }

            var jobs = [];
            for (var n = 0; n < items.length; n++) {
                jobs.push(resolveItem(items[n], meta.title));
            }

            return Promise.all(jobs)
            .then(function(results) {
                var out = [];
                var seen = {};
                for (var m = 0; m < results.length; m++) {
                    var s = results[m];
                    if (!s || !s.url || seen[s.url]) continue;
                    seen[s.url] = true;
                    out.push(s);
                }

                var rank = { "4K": 4, "1080P": 3, "720P": 2, "480P": 1 };
                out.sort(function(a, b) {
                    return (rank[b.quality] || 0) - (rank[a.quality] || 0);
                });

                console.log("[DE] playable streams: " + out.length);
                return out;
            });
        });
    })
    .catch(function(e) {
        console.log("[DE] FATAL: " + (e && e.message ? e.message : e));
        return [];
    });
}

// ═════════════════════════════════════════════════════════════════════════════
// EXPORT
// ═════════════════════════════════════════════════════════════════════════════

if (typeof module !== "undefined" && module.exports) {
    module.exports = { getStreams: getStreams };
} else if (typeof globalThis !== "undefined") {
    globalThis.getStreams = getStreams;
} else if (typeof window !== "undefined") {
    window.getStreams = getStreams;
}
