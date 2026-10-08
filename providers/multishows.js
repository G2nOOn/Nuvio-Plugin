// ═════════════════════════════════════════════════════════════════════════════
// Multishows Scraper for Nuvio (Log-Fixed & Title-Aware)
// Logic: Fetches actual title from Cinemeta first, then searches multishows.top correctly.
// ═════════════════════════════════════════════════════════════════════════════

var __async = (__this, __arguments, generator) => {
  return new Promise((resolve, reject) => {
    var fulfilled = (value) => { try { step(generator.next(value)); } catch (e) { reject(e); } };
    var rejected = (value) => { try { step(generator.throw(value)); } catch (e) { reject(e); } };
    var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
    step((generator = generator.apply(__this, __arguments)).next());
  });
};

var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";

function safeFetch(url, options) {
  return fetch(url, {
    ...options,
    headers: { 
      "User-Agent": UA, 
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", 
      ... (options ? options.headers : {}) 
    },
    timeout: 15000
  }).catch(e => { 
    console.log("[Multishows] Fetch Error: " + e.message); 
    return null; 
  });
}

function parseSize(sizeStr) {
  if (!sizeStr) return 0;
  var match = sizeStr.match(/([\d.]+)\s*(GB|MB)/i);
  if (!match) return 0;
  var value = parseFloat(match[1]);
  var unit = match[2].toUpperCase();
  return unit === "GB" ? value * 1024 : value;
}

function extractServerInfo(text) {
  var info = { quality: "", codec: "", hdr: "", source: "", size: "" };
  
  if (/2160p|4k/i.test(text)) info.quality = "4K";
  else if (/1080p/i.test(text)) info.quality = "1080P";
  
  if (/H\.265|x265|HEVC/i.test(text)) info.codec = "H.265";
  else if (/H\.264|x264|AVC/i.test(text)) info.codec = "H.264";
  else if (/AV1/i.test(text)) info.codec = "AV1";
  
  if (/DoVi|DV|Dolby Vision/i.test(text)) info.hdr = "DV HDR";
  else if (/HDR10\+/i.test(text)) info.hdr = "HDR10+";
  else if (/HDR10/i.test(text)) info.hdr = "HDR10";
  else if (/HDR/i.test(text)) info.hdr = "HDR";
  
  var sourceMatch = text.match(/•\s*([A-Z0-9]+)\s*\[/i);
  if (sourceMatch) info.source = sourceMatch[1];
  
  var sizeMatch = text.match(/([\d.]+)\s*(GB|MB)/i);
  if (sizeMatch) info.size = sizeMatch[0];
  
  return info;
}

function getStreams(tmdbId, mediaType, season, episode) {
  return __async(this, null, function* () {
    var t0 = Date.now();
    var type = mediaType === "movie" ? "movie" : "series";
    
    console.log("[Multishows] === START " + type + "/" + tmdbId + " ===");
    
    try {
      // 1. جلب اسم العمل من Cinemeta (Stremio) لاستخدامه في البحث بدقة
      var metaUrl = "https://v3-cinemeta.strem.io/meta/" + type + "/" + tmdbId + ".json";
      var metaRes = yield safeFetch(metaUrl);
      var title = "";
      
      if (metaRes && metaRes.ok) {
        var metaData = yield metaRes.json();
        if (metaData && metaData.meta && metaData.meta.name) {
          title = metaData.meta.name;
          console.log("[Multishows] Found title: " + title);
        }
      }
      
      if (!title) {
        console.log("[Multishows] Could not fetch title, aborting.");
        return [];
      }

      // 2. البحث في الموقع باستخدام الاسم (وليس TMDB ID)
      var searchUrl = "https://multishows.top/?s=" + encodeURIComponent(title);
      var response = yield safeFetch(searchUrl);
      
      // إذا فشل النمط الأول، نجرب نمط البحث البديل
      if (!response || !response.ok) {
        console.log("[Multishows] Primary search failed, trying fallback...");
        searchUrl = "https://multishows.top/search/" + encodeURIComponent(title);
        response = yield safeFetch(searchUrl);
      }
      
      if (!response || !response.ok) {
        console.log("[Multishows] All search attempts failed. Status: " + (response ? response.status : "No Response"));
        return [];
      }
      
      var html = yield response.text();
      var streams = [];
      var seen = {};

      // 3. استخراج الروابط مع السياق المحيط (500 حرف)
      var linkRegex = /<a[^>]+href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
      var match;
      
      while ((match = linkRegex.exec(html)) !== null) {
        var url = match[1];
        var contextStart = Math.max(0, match.index - 500);
        var contextText = html.substring(contextStart, match.index + match[0].length);
        var cleanContext = contextText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        
        if (seen[url]) continue;
        seen[url] = true;

        var is4K = /2160p|4k/i.test(cleanContext);
        var is1080 = /1080p/i.test(cleanContext);
        var isMultiServer = /multi server/i.test(cleanContext);
        var isDownload = /download|تحميل/i.test(cleanContext);
        
        if (!is4K && !is1080 && !isMultiServer) continue;

        var serverInfo = extractServerInfo(cleanContext);
        if (!serverInfo.quality && is4K) serverInfo.quality = "4K";
        if (!serverInfo.quality && is1080) serverInfo.quality = "1080P";

        var nameParts = ["Multishows"];
        if (serverInfo.source) nameParts.push(serverInfo.source);
        nameParts.push(serverInfo.quality || (is4K ? "4K" : "1080P"));
        
        var titleParts = [];
        if (serverInfo.quality) titleParts.push(serverInfo.quality);
        if (serverInfo.hdr) titleParts.push(serverInfo.hdr);
        if (serverInfo.codec) titleParts.push("(" + serverInfo.codec + ")");
        if (serverInfo.source) titleParts.push("• " + serverInfo.source);
        if (serverInfo.size) titleParts.push("[" + serverInfo.size + "]");

        if (isMultiServer) {
          streams.push({
            name: nameParts.join(" • "),
            title: titleParts.join(" ") || "مشاهدة مباشرة",
            url: url,
            quality: serverInfo.quality || (is4K ? "4K" : "1080P"),
            _sizeRaw: parseSize(serverInfo.size),
            headers: { "User-Agent": UA, "Referer": "https://multishows.top/" }
          });
        } else if ((is4K || is1080) && isDownload) {
          streams.push({
            name: nameParts.join(" • "),
            title: titleParts.join(" ") || "تحميل",
            url: url,
            quality: serverInfo.quality || (is4K ? "4K" : "1080P"),
            _sizeRaw: parseSize(serverInfo.size),
            headers: { "User-Agent": UA, "Referer": "https://multishows.top/" }
          });
        }
      }

      // 4. ترتيب النتائج: 4K أولاً، ثم 1080p، ثم الأكبر حجماً
      streams.sort(function(a, b) {
        var qa = String(a.quality || "").toUpperCase();
        var qb = String(b.quality || "").toUpperCase();
        var aIs4K = (qa === "4K" || qa === "2160P");
        var bIs4K = (qb === "4K" || qb === "2160P");
        if (aIs4K && !bIs4K) return -1;
        if (!aIs4K && bIs4K) return 1;
        return b._sizeRaw - a._sizeRaw;
      });

      streams = streams.map(function(s) {
        delete s._sizeRaw;
        return s;
      });

      console.log("[Multishows] === SUCCESS: Found " + streams.length + " streams in " + (Date.now() - t0) + "ms ===");
      return streams;
      
    } catch (error) {
      console.log("[Multishows] FATAL Error: " + error.message);
      return [];
    }
  });
}

module.exports = { getStreams };
