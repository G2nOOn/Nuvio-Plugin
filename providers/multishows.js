// ═════════════════════════════════════════════════════════════════════════════
// Multishows Scraper for Nuvio Local Scrapers
// React Native compatible version
// Logic: Prioritize "Multi Server" (Streaming), fallback to 1080p/4K Download links.
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

function getStreams(tmdbId, mediaType, season, episode) {
  return __async(this, null, function* () {
    var t0 = Date.now();
    var type = mediaType === "movie" ? "movie" : "series";
    var idStr = type === "movie" ? String(tmdbId) : String(tmdbId) + ":" + String(season || 1) + ":" + String(episode || 1);
    
    console.log("[Multishows] === START " + type + "/" + idStr + " ===");
    
    try {
      // ملاحظة: نستبدل المسار برابط البحث أو الرابط المباشر إذا كان معروفًا. 
      // هنا نفترض أن الإضافة تمرر رابط الصفحة مباشرة أو نبحث باسم الفيلم.
      // إذا كانت الإضافة تمرر tmdbId فقط، قد تحتاج لتعديل رابط البحث أدناه ليطابق هيكلية الموقع.
      var searchUrl = "https://multishows.top/search?q=" + encodeURIComponent(idStr); 
      // إذا كان الرابط المباشر متاحًا في الإضافة، يمكن استبداله بـ: var searchUrl = url;
      
      var response = yield safeFetch(searchUrl);
      if (!response.ok) {
        console.log("[Multishows] Backend returned " + response.status);
        return [];
      }
      
      var html = yield response.text();
      var streams = [];
      var seen = {};

      // استخراج جميع روابط <a> من الصفحة وتحليل نصها
      var linkRegex = /<a[^>]+href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
      var match;
      
      while ((match = linkRegex.exec(html)) !== null) {
        var url = match[1];
        // تنظيف النص من أي وسوم HTML داخلية
        var text = match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        var lowerText = text.toLowerCase();
        
        // 1. الأولوية لسيرفرات المشاهدة المباشرة (Multi Server)
        if (lowerText.includes('multi server')) {
          if (!seen[url]) {
            seen[url] = true;
            streams.push({
              name: "Multishows • مشاهدة • 1080P",
              title: "Multishows • مشاهدة • 1080P",
              url: url,
              quality: "1080P",
              headers: { "User-Agent": UA, "Referer": "https://multishows.top/" }
            });
          }
        }
        // 2. خطة الطوارئ: روابط التحميل بجودة 1080p أو 4K (2160p)
        else if ((lowerText.includes('1080p') || lowerText.includes('2160p') || lowerText.includes('4k')) && (lowerText.includes('download') || lowerText.includes('تحميل'))) {
          if (!seen[url]) {
            seen[url] = true;
            var is4K = lowerText.includes('2160p') || lowerText.includes('4k');
            streams.push({
              name: "Multishows • تحميل • " + (is4K ? "4K" : "1080P"),
              title: "Multishows • تحميل • " + (is4K ? "4K" : "1080P"),
              url: url,
              quality: is4K ? "4K" : "1080P",
              headers: { "User-Agent": UA, "Referer": "https://multishows.top/" }
            });
          }
        }
      }

      console.log("[Multishows] === Done: " + streams.length + " streams in " + (Date.now() - t0) + "ms ===");
      return streams;
      
    } catch (error) {
      console.log("[Multishows] Error: " + error.message);
      return [];
    }
  });
}

module.exports = { getStreams };
