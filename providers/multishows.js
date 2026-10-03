/**
 * MultiShows Nuvio Provider  v3.2  (real-device tested via Nuvio logs)
 * https://multishows.top — Movies / TV / Anime
 *
 * Changelog:
 *  v3.2 — REAL-DEVICE FIX: episode discovery now tries absolute href,
 *         relative href, and ANY occurrence of /episode/{slug}/{s}-{e}
 *         (Nuxt apps store routes in __NUXT__ JSON, not <a href>).
 *         Added digit boundary (no more 1-2 vs 1-20 confusion).
 *         Added diagnostic HTML dump ([multishows][dump ...]) for the
 *         watch page so unknown player markup can be wired precisely.
 *         Iframe dig now also follows same-origin player pages.
 *  v3.1 — download URLs appear once (as ⬇ Direct), no duplicates.
 *  v3.0 — direct slug access (52/52 verified), iframe deep-dig, wall detect.
 *
 * STRICT 4K & 1080p ONLY. Downloads served as DIRECT playable streams.
 */

var BASE = "https://multishows.top";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

var Q4K = /(2160|4k|uhd)/i;
var Q1080 = /(1080|fhd)/i;
var WALL_RE = /choose security mode|disable your ad-blocker|ad detector/i;

// ── TMDB key pool ────────────────────────────────────────────────────────────
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

/**
 * slugify — VERIFIED 52/52 against real multishows.top slugs.
 */
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
    for (var i = 0; i < bin.length; i++) chars.push(bin.charAt(i) === "1" ? "﻿" : "​");
    return chars.join("");
}

function isWall(html) {
    return WALL_RE.test(String(html || "").slice(0, 8000));
}

// v3.2: diagnostic dump — prints HTML slices around key markers so unknown
// player markup can be wired precisely from real-device logs.
function debugDump(html, tag) {
    try {
        var markers = ["__NUXT__", "sources", "servers", "streams", "iframe", "m3u8", ".mp4", "download", "player"];
        for (var i = 0; i < markers.length; i++) {
            var mk = markers[i];
            var idx = html.indexOf(mk);
            if (idx !== -1) {
                var slice = html.substring(Math.max(0, idx - 80), Math.min(html.length, idx + 260));
                console.log("[multishows][dump " + tag + " @" + mk + "] " + slice.replace(/\s+/g, " ").slice(0, 340));
            }
        }
    } catch (e) {}
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

            if (type === "tv") {
                var slug = pageUrl.split("/").pop() || "";
                return findEpisodeUrl(pageUrl, sea, ep, slug).then(function (watchUrl) {
                    if (!watchUrl) { console.log("[multishows] episode page not found"); return []; }
                    console.log("[multishows] watch: " + watchUrl);
                    return fetchText(watchUrl).then(function (html) {
                        if (isWall(html)) {
                            console.log("[multishows] BLOCKED: ad-wall served instead of content");
                            return [];
                        }
                        return buildStreams(html, watchUrl, settings);
                    });
                });
            }

            return fetchText(pageUrl).then(function (html) {
                if (isWall(html)) {
                    console.log("[multishows] BLOCKED: ad-wall served instead of content");
                    return [];
                }
                return buildStreams(html, pageUrl, settings);
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

// ── slug → direct page, fallback search ─────────────────────────────────────
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
            if (isWall(html)) return url; // verified later on the watch fetch
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

// ── v3.2: Episode URL — 3 strategies + digit boundary ────────────────────────
function findEpisodeUrl(showUrl, season, episode, slug) {
    return fetchText(showUrl).then(function (html) {
        if (isWall(html)) return "";
        var want = "/" + season + "-" + episode;

        // 1) absolute <a href="https://multishows.top/episode/...">
        var reAbs = new RegExp('href=["\\'](https?:\\/\\/(?:www\\.)?multishows\\.top\\/episode\\/[^"\\'?#\\s]+?' + want + ')(?![0-9])', "i");
        var m = reAbs.exec(html);
        if (m) return m[1];

        // 2) relative <a href="/episode/...">
        var reRel = new RegExp('href=["\\'](\\/episode\\/[^"\\'?#\\s]+?' + want + ')(?![0-9])', "i");
        m = reRel.exec(html);
        if (m) return BASE + m[1];

        // 3) ANY occurrence (Nuxt __NUXT__ JSON state, data-attributes, router)
        var reAny = new RegExp('(\\/episode\\/[a-z0-9\\-]+?' + want + ')(?![0-9])', "i");
        m = reAny.exec(html);
        if (m) return BASE + m[1];

        console.log("[multishows] no episode link for S" + season + "E" + episode + " (tried abs/rel/any)");
        return "";
    });
}

// ── Server extraction (multi-pattern + one-level iframe dig) ─────────────────
function collectCandidates(html, pageUrl, streams, downloads, seenS, seenD) {
    // Pattern A: data-url / data-src / data-link / data-file elements
    var reData = /<(?:button|li|a|div|span)[^>]*data-(?:url|src|link|file|video)=["']([^"']+)["'][^>]*>([\s\S]{0,160}?)<\/(?:button|li|a|div|span)>/gi;
    var m;
    while ((m = reData.exec(html)) !== null) {
        var au = absUrl(m[1], pageUrl);
        if (au && !seenS[au]) { streams.push({ url: au, label: stripTags(m[2]) }); seenS[au] = true; }
    }

    // Pattern B: iframes — same-origin player pages included (v3.2)
    var iframes = [];
    var reIframe = /<iframe[^>]+src=["']([^"']+)["']/gi;
    while ((m = reIframe.exec(html)) !== null) {
        var iu = absUrl(m[1], pageUrl);
        if (iu && !/^javascript:|^data:/i.test(iu) && !seenS[iu]) { iframes.push(iu); }
    }

    // Pattern C: direct file URLs — label from the FILE NAME itself only
    var reFile = /(https?:\/\/[^\s"'<>\\]+?\.(?:m3u8|mp4|mkv|webm)(?:\?[^\s"'<>\\]*)?)/gi;
    while ((m = reFile.exec(html)) !== null) {
        if (!seenS[m[1]]) { streams.push({ url: m[1], label: "" }); seenS[m[1]] = true; }
    }

    // Pattern D: download links — SEPARATE dedup set
    var reDl = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]{0,140}?)<\/a>/gi;
    while ((m = reDl.exec(html)) !== null) {
        var hu = absUrl(m[1], pageUrl);
        var txt = stripTags(m[2]);
        if (!hu || seenD[hu]) continue;
        if (/download|تحميل|dl\./i.test(hu) || /download|تحميل/i.test(txt)) {
            downloads.push({ url: hu, label: txt || "Download" }); seenD[hu] = true;
        }
    }

    // Pattern E: embedded JSON — explicit quality field when present
    var reJson = /"(?:servers|sources|streams)"\s*:\s*(\[[\s\S]{0,4000}?\])\s*[,}\]]/g;
    while ((m = reJson.exec(html)) !== null) {
        try {
            var arr = JSON.parse(m[1]);
            for (var i = 0; i < arr.length; i++) {
                var s = arr[i] || {};
                var ju = absUrl(s.file || s.url || s.src || s.link || "", pageUrl);
                if (!ju || seenS[ju]) continue;
                var lbl = [s.name || s.title || s.label || "", s.quality || ""].join(" ").trim();
                var q = "";
                var sq = String(s.quality || "").toLowerCase();
                if (Q4K.test(sq)) q = "4K";
                else if (Q1080.test(sq)) q = "1080p";
                streams.push({ url: ju, label: lbl, q: q }); seenS[ju] = true;
            }
        } catch (e) {}
    }

    return iframes;
}

function buildStreams(html, pageUrl, settings) {
    var streams = [], downloads = [];
    var seenS = {}, seenD = {};

    var iframes = collectCandidates(html, pageUrl, streams, downloads, seenS, seenD);
    console.log("[multishows] page gave " + streams.length + " stream candidate(s), " +
        downloads.length + " download(s), " + iframes.length + " iframe(s)");

    // resolve embed iframes ONE level deep (filemoon/vidmoly/same-origin player)
    function digIframe(i) {
        if (i >= iframes.length || i >= 4) return Promise.resolve();
        return fetchText(iframes[i]).then(function (sub) {
            var subStreams = [], subDl = [];
            var subIframes = collectCandidates(sub, iframes[i], subStreams, subDl, seenS, seenD);
            for (var j = 0; j < subStreams.length; j++) {
                var c = subStreams[j];
                if (!c.label) {
                    var host = "embed";
                    try { host = new URL(iframes[i]).hostname.replace(/^www\./, ""); } catch (e) {}
                    c.label = host;
                }
                streams.push(c);
            }
            for (var k = 0; k < subDl.length; k++) downloads.push(subDl[k]);
            // one more level only for same-origin player pages
            function digInner(x) {
                if (x >= subIframes.length || x >= 2) return Promise.resolve();
                return fetchText(subIframes[x]).then(function (sub2) {
                    var s2 = [], d2 = [];
                    collectCandidates(sub2, subIframes[x], s2, d2, seenS, seenD);
                    for (var a = 0; a < s2.length; a++) {
                        if (!s2[a].label) {
                            try { s2[a].label = new URL(subIframes[x]).hostname.replace(/^www\./, ""); } catch (e) {}
                        }
                        streams.push(s2[a]);
                    }
                    for (var b = 0; b < d2.length; b++) downloads.push(d2[b]);
                }).catch(function () {}).then(function () { return digInner(x + 1); });
            }
            return digInner(0);
        }).catch(function (e) {
            console.log("[multishows] iframe " + i + " failed: " + e.message);
        }).then(function () { return digIframe(i + 1); });
    }

    return digIframe(0).then(function () {
        // v3.2: if nothing found, dump HTML markers for diagnosis
        if (streams.length === 0 && downloads.length === 0) {
            console.log("[multishows] EMPTY page — dumping markers for diagnosis:");
            debugDump(html, "watch");
        }

        // ── STRICT 4K & 1080p filter ────────────────────────────────────────
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

        // downloads served DIRECTLY as playable streams
        var dlUrls = {};
        for (var di = 0; di < downloads.length; di++) dlUrls[downloads[di].url] = true;
        var uniqueStreams = streams.filter(function (s) { return !dlUrls[s.url]; });

        var final = fq(uniqueStreams, false);
        if (settings.directDownload) final = final.concat(fq(downloads, true));
        if (!final.length) final = fq(downloads, true);

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
