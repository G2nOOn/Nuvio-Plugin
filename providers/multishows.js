/**
 * MultiShows Nuvio Provider v3.2 — Ad-Wall Bypass & Download Links Fix
 * https://multishows.top — Movies / TV / Anime
 *
 * v3.2 FIXES:
 * ✅ Bypass ad-wall (no more early abort on "Choose Security Mode")
 * ✅ Fixed episode URL finder to handle both absolute & relative links
 * ✅ Improved download-link detection & quality classification
 * ✅ Strict 4K / 1080p filter preserved
 */

var BASE = "https://multishows.top";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

var Q4K = /(2160|4k|uhd)/i;
var Q1080 = /(1080|fhd)/i;

// ── TMDB Key Pool ────────────────────────────────────────────────────────────
function getTmdbKey() {
    try {
        if (typeof globalThis !== "undefined" && globalThis.TMDB_API_KEY) return globalThis.TMDB_API_KEY;
        if (typeof window !== "undefined" && window.TMDB_API_KEY) return window.TMDB_API_KEY;
    } catch (e) {}
    var pool = [
        "ZjE1YWFmOWNmMDVmMTRlY2UzMDliNjhjYWQwMWNlMjU=",
        "NDM5YzQ3OGE3NzFmMzVjMDUwMjJmOWZlYWJjY2EwMWM="
    ];
    try { return atob(pool[Math.floor(Math.random() * pool.length)]); } catch (e) { return ""; }
}

function onSettings() {
    return [
        {
            type: "select", key: "qualityMode", name: "quality_mode", label: "Quality Filter",
            options: [
                { label: "4K + 1080p", value: "both" },
                { label: "4K ONLY", value: "4k" },
                { label: "1080p ONLY", value: "1080p" }
            ],
            default: "both"
        },
        {
            type: "toggle", key: "directDownload", name: "direct_download",
            label: "Serve download servers as direct playable streams", default: true
        }
    ];
}

function resolveSettings(customSettings) {
    var out = { qualityMode: "both", directDownload: true };
    try {
        var s = customSettings;
        if (!s && typeof globalThis !== "undefined") s = globalThis.SCRAPER_SETTINGS || globalThis.SETTINGS;
        if (!s && typeof window !== "undefined") s = window.SCRAPER_SETTINGS || window.SETTINGS;
        if (s) {
            var q = String(s.qualityMode || s.quality_mode || "both").toLowerCase();
            if (q === "4k" || q === "1080p") out.qualityMode = q;
            if (s.directDownload === false || s.direct_download === false) out.directDownload = false;
        }
    } catch (e) {}
    return out;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function stripTags(html) {
    return String(html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeEntities(t) {
    return String(t || "")
        .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
        .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, function (m, n) {
            try { return String.fromCharCode(parseInt(n, 10)); } catch (e) { return m; }
        });
}

function normalize(t) {
    return String(t || "").toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]+/g, " ").trim();
}

function slugify(title) {
    var t = String(title || "").toLowerCase();
    try { t = t.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (e) {}
    t = t.replace(/\([^)]*\)|\[[^\]]*\]/g, " ");
    t = t.replace(/['’`]/g, "-").replace(/&/g, " ");
    t = t.replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
    return t;
}

function classifyQuality(label, url) {
    var path = "";
    try { path = new URL(url).pathname; } catch (e) { path = String(url || ""); }
    var t = String(label || "") + " " + path;
    if (Q4K.test(t)) return "4K";
    if (Q1080.test(t)) return "1080p";
    return "";
}

function absUrl(u, pageUrl) {
    u = decodeEntities(String(u || "").trim());
    if (!u) return "";
    if (/^https?:\/\//i.test(u)) return u;
    if (u.charAt(0) === "/") {
        try { return new URL(pageUrl).origin + u; } catch (e) { return BASE + u; }
    }
    return "";
}

function fetchText(url) {
    return fetch(url, {
        headers: {
            "User-Agent": UA,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": BASE + "/"
        },
        redirect: "follow"
    }).then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.text();
    });
}

function getInvertedSortTag(score, maxScore) {
    maxScore = maxScore || 999999;
    var inv = Math.max(0, maxScore - Math.max(0, parseInt(score, 10) || 0));
    var bin = inv.toString(2);
    while (bin.length < 20) bin = "0" + bin;
    var chars = [];
    for (var i = 0; i < bin.length; i++) chars.push(bin.charAt(i) === "1" ? "" : "");
    return chars.join("");
}

// ── Entry Point ───────────────────────────────────────────────────────────────
function getStreams(tmdbId, mediaType, season, episode) {
    var rawId = tmdbId;
    if (typeof tmdbId === "object" && tmdbId !== null) {
        rawId = tmdbId.tmdbId || tmdbId.id || tmdbId.imdbId || tmdbId.imdb_id || tmdbId;
    }
    var cleanId = String(rawId || "").replace(/^(?:tmdb|imdb):/i, "").trim();
    var type = (mediaType === "tv" || mediaType === "series" || mediaType === "anime") ? "tv" : "movie";
    var sea = parseInt(season, 10) || 1;
    var ep = parseInt(episode, 10) || 1;
    var settings = resolveSettings();

    console.log("[multishows] " + type + " id=" + cleanId + (type === "tv" ? " S" + sea + "E" + ep : ""));

    return resolveTmdbInfo(cleanId, type).then(function (info) {
        if (!info.title) {
            console.log("[multishows] no title resolved — aborting");
            return [];
        }
        console.log("[multishows] title: " + info.title + " (" + info.year + ")");

        return findPageUrl(info, type).then(function (pageUrl) {
            if (!pageUrl) {
                console.log("[multishows] no page found (slug + search failed)");
                return [];
            }
            console.log("[multishows] page: " + pageUrl);

            var watchPromise = (type === "tv")
                ? findEpisodeUrl(pageUrl, sea, ep)
                : Promise.resolve(pageUrl);

            return watchPromise.then(function (watchUrl) {
                if (!watchUrl) { console.log("[multishows] episode page not found"); return []; }
                return fetchText(watchUrl).then(function (html) {
                    // ✅ v3.2: DO NOT abort on ad-wall — try to extract anyway
                    console.log("[multishows] fetching watch page: " + watchUrl);
                    return buildStreams(html, watchUrl, settings);
                });
            });
        });
    }).catch(function (e) {
        console.log("[multishows] error: " + e.message);
        return [];
    });
}

// ── TMDB: id → title/year ────────────────────────────────────────────────────
function resolveTmdbInfo(id, type) {
    var key = getTmdbKey();
    function fromTmdb(d) {
        var title = d.title || d.name || d.original_title || d.original_name || "";
        var date = d.release_date || d.first_air_date || "";
        return { title: title, original: d.original_title || d.original_name || "", year: date ? date.substring(0, 4) : "" };
    }
    if (id.indexOf("tt") === 0) {
        return fetch("https://api.themoviedb.org/3/find/" + id + "?api_key=" + key + "&external_source=imdb_id",
            { headers: { "User-Agent": UA, "Accept": "application/json" } })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                var arr = type === "tv" ? (d.tv_results || []) : (d.movie_results || []);
                return arr.length ? fromTmdb(arr[0]) : { title: "", original: "", year: "" };
            })
            .catch(function () { return { title: "", original: "", year: "" }; });
    }
    var endpoint = type === "tv" ? "tv" : "movie";
    return fetch("https://api.themoviedb.org/3/" + endpoint + "/" + id + "?api_key=" + key,
        { headers: { "User-Agent": UA, "Accept": "application/json" } })
        .then(function (r) { return r.json(); })
        .then(fromTmdb)
        .catch(function () { return { title: "", original: "", year: "" }; });
}

// ── Find page URL ────────────────────────────────────────────────────────────
function findPageUrl(info, type) {
    var kind = type === "tv" ? "tv-show" : "movie";
    var slugs = [];
    var s1 = slugify(info.title);
    if (s1) slugs.push(s1);
    var s2 = slugify(info.original);
    if (s2 && s2 !== s1) slugs.push(s2);

    function trySlug(i) {
        if (i >= slugs.length) return searchSite(info, kind);
        var url = BASE + "/" + kind + "/" + slugs[i];
        return fetchText(url).then(function (html) {
            // ✅ v3.2: don't abort on ad-wall — check for content markers anyway
            if (/og:title|canonical|<article|post-title|episode/i.test(html) &&
                !/404|not found|page not/i.test(stripTags(html).slice(0, 400))) {
                console.log("[multishows] slug hit: " + url);
                return url;
            }
            return trySlug(i + 1);
        }).catch(function () { return trySlug(i + 1); });
    }
    return trySlug(0);
}

function searchSite(info, kind) {
    var queries = [info.title];
    if (info.original && normalize(info.original) !== normalize(info.title)) queries.push(info.original);
    if (info.title.indexOf(":") > 0) queries.push(info.title.split(":")[0].trim());

    function tryQuery(i) {
        if (i >= queries.length) return "";
        return fetchText(BASE + "/?s=" + encodeURIComponent(queries[i])).then(function (html) {
            var results = parseSearchResults(html);
            if (results.length) {
                var best = pickBest(results, info, kind);
                if (best) return best.url;
            }
            return tryQuery(i + 1);
        }).catch(function () { return tryQuery(i + 1); });
    }
    return tryQuery(0);
}

function parseSearchResults(html) {
    var results = [];
    var seen = {};
    var re = /<a[^>]+href="(https?:\/\/(?:www\.)?multishows\.top\/(movie|tv-show)\/[^"?#]+)"[^>]*>([\s\S]{0,600}?)<\/a>/gi;
    var m;
    while ((m = re.exec(html)) !== null) {
        var url = m[1], kind2 = m[2], inner = m[3];
        if (seen[url]) continue;
        var title = stripTags(inner).replace(/\s+(Watch now|Movie|TV Show)\s*$/i, "").trim();
        if (!title || title.length < 2) continue;
        var y = inner.match(/(19|20)\d{2}/);
        seen[url] = true;
        results.push({ url: url, kind: kind2, title: title, year: y ? y[0] : "" });
    }
    return results;
}

function pickBest(results, info, wantKind) {
    var nt = normalize(info.title);
    var no = normalize(info.original);
    var best = null, bestScore = -1;
    for (var i = 0; i < results.length; i++) {
        var r = results[i];
        var score = (r.kind === wantKind) ? 2 : -5;
        var rt = normalize(r.title);
        if (rt === nt || rt === no) score += 10;
        else if (nt && (rt.indexOf(nt) === 0 || nt.indexOf(rt) === 0)) score += 6;
        else if (no && (rt.indexOf(no) === 0 || no.indexOf(rt) === 0)) score += 5;
        if (info.year && r.year === info.year) score += 3;
        if (score > bestScore) { bestScore = score; best = r; }
    }
    return (best && bestScore >= 6) ? best : null;
}

// ── Episode URL (v3.2: no early abort) ────────────────────────────────────────
function findEpisodeUrl(showUrl, season, episode) {
    return fetchText(showUrl).then(function (html) {
        // ✅ v3.2: no early return on ad-wall
        var re = /href="((?:https?:\/\/(?:www\.)?multishows\.top)?\/episode\/[^"?#]+)"/gi;
        var m, found = "";
        var want = "/" + season + "-" + episode;

        while ((m = re.exec(html)) !== null) {
            var u = m[1];
            // Handle relative URLs
            if (u.charAt(0) === "/") u = BASE + u;
            // Match format: /episode/{slug}/{season}-{episode}
            if (u.substring(u.length - want.length) === want ||
                new RegExp("\\/" + season + "-" + episode + "(?:[\\/?#\"]|$)").test(u)) {
                found = u;
                break;
            }
        }

        if (found) {
            console.log("[multishows] episode url found: " + found);
            return found;
        }

        // Fallback: build URL manually
        var slugMatch = showUrl.match(/\/tv-show\/([^\/]+)\/?$/);
        if (slugMatch) {
            var guessed = BASE + "/episode/" + slugMatch[1] + "/" + season + "-" + episode;
            console.log("[multish(ows] episode url guessed: " + guessed);
            return guessed;
        }

        return "";
    });
}

// ── Extract candidates ────────────────────────────────────────────────────────
function collectCandidates(html, pageUrl, streams, downloads,html seenS, seenD) {
,    var m;
    // Pattern C: direct file URLs (m3u8 / mp4 / mkv) — these are rare on MultiShows
    var re pageFile = /(https?:\/\/[^\s"'<>\\]+?\.(?:m3u8|mp4|mkv|webm)(?:\?[^\s"'<>\\]*)?)/gi;
    while ((m = reFile.exec(html)) !== null) {
        if (!seenS[m[1]]) { streams.push({ url: m[1], label: "" }); seenS[m[1]] = true; }
    }

    // Pattern D (v3.2 improved): download links — look for <a> tags near "Download" or "تحميل"
    var reDl = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi;
    while ((m = reDl.exec(html)) !== null) {
        var hu = absUrl(m[1], pageUrl);
        var txt = stripTags(m[2]);
        if (!hu || seenD[hu]) continue;
        // Accept if text or URL mentions download, or URL looks like a file host
        if (/download|تحميل|dl\.|gdflix|hubcloud|pixeldrain|file/i.test(hu) ||
            /download|تحميل/i.test(txt) ||
            /\.(?:mp4|mkv|m3u8)(?:\?|$)/i.test(hu)) {
            // Try to extract quality from the anchor text (e.g. "2160p DoVi HDR HEVC...")
            var q = "";
            if (Q4K.test(txt)) q = "4K";
            else if (Q1080.test(txt)) q = "1080p";
            downloads.push({ url: hu, label: txt || "Download", q: q });
            seenD[hu] = true;
        }
    }
}

// ── Build streams ─────────────────────────────────────────────────────────────
function buildStreamsUrl, settings) {
    var streams = [], downloads = [];
    var seenS = {}, seenD = {};

    collectCandidates(html, pageUrl, streams, downloads, seenS, seenD);
    console.log("[multishows] page gave " + streams.length + " stream candidate(s), " +
        downloads.length + " download(s)");

    // Filter & format
    function fq(list, isDl) {
        var out = [], seen = {};
        for (var i = 0; i < list.length; i++) {
            var it = list[i];
            var q = it.q || classifyQuality(it.label, it.url);
            if (!q) continue;
            if (settings.qualityMode === "4k" && q !== "4K") continue;
            if (settings.qualityMode === "1080p" && q !== "1080p") continue;
            if (seen[it.url]) continue;
            seen[it.url] = true;
            out.push({ url: it.url, label: it.label, quality: q, dl: !!isDl });
        }
        out.sort(function (a, b) { return a.quality === b.quality ? 0 : (a.quality === "4K" ? -1 : 1); });
        return out;
    }

    // Dedup: if a download URL is also in streams, prefer the download entry
    var dlUrls = {};
    for (var di = 0; di < downloads.length; di++) dlUrls[downloads[di].url] = true;
    var uniqueStreams = streams.filter(function (s) { return !dlUrls[s.url]; });

    var final = fq(uniqueStreams, false);
    if (settings.directDownload) final = final.concat(fq(downloads, true));
    if (!final.length) final = fq(downloads, true); // safety fallback

    console.log("[multishows] final streams: " + final.length +
        " (streams " + final.filter(function (x) { return !x.dl; }).length +
        ", direct-download " + final.filter(function (x) { return x.dl; }).length + ")");

    return final.map(function (s) {
        var qUp = s.quality.toUpperCase();
        var host = "CDN";
        try { host = new URL(s.url).hostname.replace(/^www\./, ""); } catch (e) {}
        var tag = s.dl ? "⬇ Direct" : "MultiShows";
        var mainTitle = [tag, qUp, host].join(" • ");
        var sub = [stripTags(s.label), /\.m3u8(\?|$)/i.test(s.url) ? "HLS" : /\.mkv(\?|$)/i.test(s.url) ? "MKV" : "MP4"].filter(Boolean).join("\n");
        return {
            name: getInvertedSortTag(s.quality === "4K" ? 2 : 1, 10) + mainTitle,
            title: mainTitle,
            size: sub,
            url: s.url,
            quality: qUp,
            headers: { "User-Agent": UA, "Referer": pageUrl, "Origin": BASE, "Accept": "*/*" },
            _host: host
        };
    });
}

// ── Export ────────────────────────────────────────────────────────────────────
if (typeof module !== "undefined" && module.exports) {
    module.exports = { getStreams: getStreams, onSettings: onSettings };
} else if (typeof globalThis !== "undefined") {
    globalThis.getStreams = getStreams;
    globalThis.onSettings = onSettings;
} else if (typeof window !== "undefined") {
    window.getStreams = getStreams;
    window.onSettings = onSettings;
}
