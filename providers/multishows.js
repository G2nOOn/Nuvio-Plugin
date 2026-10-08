// ═════════════════════════════════════════════════════════════════════════════
// Multishows Scraper for Nuvio (Enhanced Metadata Extraction)
// Logic: Extract full server info (codec, HDR, size, source) from download links
// ═════════════════════════════════════════════════════════════════════════════

var __async = (__this, __arguments, generator) => {
  return new Promise((resolve, reject) => {
    var fulfilled = (value) => {
      try { step(generator.next(value)); } catch (e) { reject(e); }
    };
    var rejected = (value) => {
      try { step(generator.throw(value)); } catch (e) { reject(e); }
    };
    var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
    step((generator = generator.apply(__this, __arguments)).next());
  });
};

var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";
var FETCH_TIMEOUT = 15000;

function safeFetch(url, options, timeout) {
  var ms = timeout || FETCH_TIMEOUT;
  var controller;
  var tid;
  try {
    controller = new AbortController();
    tid = setTimeout(function() { controller.abort(); }, ms);
  } catch (e) { controller = null; }
  
  var opts = options || {};
  if (controller) opts.signal = controller.signal;
  if (!opts.headers) opts.headers = {};
  if (!opts.headers["User-Agent"]) opts.headers["User-Agent"] = UA;
  
  return fetch(url, opts).then(function(r) {
    if (tid) clearTimeout(tid);
    return r;
  }).catch(function(e) {
    if (tid) clearTimeout(tid);
    throw e;
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
  // استخراج معلومات السيرفر من النص الكامل
  var info = {
    quality: "",
    codec: "",
    hdr: "",
    source: "",
    size: "",
    fullText: text
  };
  
  // الجودة
  if (/2160p|4k/i.test(text)) info.quality = "4K";
  else if (/1080p/i.test(text)) info.quality = "1080P";
  
  // الكودك
  if (/H\.265|x265|HEVC/i.test(text)) info.codec = "H.265";
  else if (/H\.264|x264|AVC/i.test(text)) info.codec = "H.264";
  else if (/AV1/i.test(text)) info.codec = "AV1";
  
  // HDR/DV
  if (/DoVi|DV|Dolby Vision/i.test(text)) info.hdr = "DV HDR";
  else if (/HDR10\+/i.test(text)) info.hdr = "HDR10+";
  else if (/HDR10/i.test(text)) info.hdr = "HDR10";
  else if (/HDR/i.test(text)) info.hdr = "HDR";
  else if (/SDR/i.test(text)) info.hdr = "SDR";
  
  // المصدر (السيرفر)
  var sourceMatch = text.match(/•\s*([A-Z0-9]+)\s*\[/i);
  if (sourceMatch) info.source = sourceMatch[1];
  
  // الحجم
  var sizeMatch = text.match(/([\d.]+)\s*(GB|MB)/i);
  if (sizeMatch) info.size = sizeMatch[0];
  
  return info;
}

function getStreams(tmdbId, mediaType, season, episode) {
  return __async(this, null, function* () {
    var t0 = Date.now();
    var type = mediaType === "movie" ? "movie" : "series";
    var idStr = type === "movie" ? String(tmdbId) : String(tmdbId) + ":" + String(season || 1) + ":" + String(episode || 1);
    
    console.log("[Multishows] === START " + type + "/" + idStr + " ===");
    
    try {
      var searchUrl = "https://multishows.top/search?q=" + encodeURIComponent(idStr);
      
      var response = yield safeFetch(searchUrl);
      if (!response.ok) {
        console.log("[Multishows] Backend returned " + response.status);
        return [];
      }
      
      var html = yield response.text();
      var streams = [];
      var seen = {};

      // استخراج جميع الروابط مع السياق المحيط (500 حرف بدلاً من 300 لالتقاط النص الكامل)
      var linkRegex = /<a[^>]+href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
      var match;
      
      while ((match = linkRegex.exec(html)) !== null) {
        var url = match[1];
        var linkText = match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        
        // البحث في النص المحيط (500 حرف قبل الرابط) للحصول على معلومات الجودة
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

        // استخراج معلومات السيرفر الكاملة
        var serverInfo = extractServerInfo(cleanContext);
        
        if (!serverInfo.quality && is4K) serverInfo.quality = "4K";
        if (!serverInfo.quality && is1080) serverInfo.quality = "1080P";

        // بناء الاسم والعنوان
        var nameParts = ["Multishows"];
        if (serverInfo.source) nameParts.push(serverInfo.source);
        nameParts.push(serverInfo.quality || (is4K ? "4K" : "1080P"));
        
        var titleParts = [];
        if (serverInfo.quality) titleParts.push(serverInfo.quality);
        if (serverInfo.hdr) titleParts.push(serverInfo.hdr);
        if (serverInfo.codec) titleParts.push("(" + serverInfo.codec + ")");
        if (serverInfo.source) titleParts.push("• " + serverInfo.source);
        if (serverInfo.size) titleParts.push("[" + serverInfo.size + "]");

        // الأولوية: Multi Server للمشاهدة المباشرة
        if (isMultiServer) {
          streams.push({
            name: nameParts.join(" • "),
            title: titleParts.join(" ") || "مشاهدة مباشرة",
            url: url,
            quality: serverInfo.quality || (is4K ? "4K" : "1080P"),
            _sizeRaw: parseSize(serverInfo.size),
            headers: { "User-Agent": UA, "Referer": "https://multishows.top/" }
          });
        }
        // خطة الطوارئ: روابط التحميل مع معلومات كاملة
        else if ((is4K || is1080) && isDownload) {
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

      // ترتيب: 4K أولاً، ثم 1080p، ثم حسب الحجم (تنازلي)
      streams.sort(function(a, b) {
        var qa = String(a.quality || "").toUpperCase();
        var qb = String(b.quality || "").toUpperCase();
        
        var aIs4K = (qa === "4K" || qa === "2160P");
        var bIs4K = (qb === "4K" || qb === "2160P");
        if (aIs4K && !bIs4K) return -1;
        if (!aIs4K && bIs4K) return 1;
        
        return b._sizeRaw - a._sizeRaw;
      });

      // إزالة خاصية _sizeRaw قبل الإرجاع
      streams = streams.map(function(s) {
        delete s._sizeRaw;
        return s;
      });

      console.log("[Multishows] === Done: " + streams.length + " streams in " + (Date.now() - t0) + "ms ===");
      return streams;
      
    } catch (error) {
      console.log("[Multishows] Error: " + error.message);
      return [];
    }
  });
}

module.exports = { getStreams };
