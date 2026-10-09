// ═════════════════════════════════════════════════════════════════════════════
// Multishows/UHDMovies Scraper for Nuvio (Final Complete Version with Accurate Matching)
// Logic: TMDB API + multishows.top search + Accurate title matching + Download Link Resolver
// ═════════════════════════════════════════════════════════════════════════════

var __async = (__this, __arguments, generator) => {
  return new Promise((resolve, reject) => {
    var fulfilled = (value) => { try { step(generator.next(value)); } catch (e) { reject(e); } };
    var rejected = (value) => { try { step(generator.throw(value)); } catch (e) { reject(e); } };
    var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
    step((generator = generator.apply(__this, __arguments)).next());
  });
};

var TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";

function safeFetch(url, options) {
  return fetch(url, {
    ...options,
    headers: { 
      "User-Agent": UA, 
      "Accept": "application/json, text/html, */*;q=0.8", 
      ... (options ? options.headers : {}) 
    },
    timeout: 15000
  }).catch(e => { 
    console.log("[UHDMovies] Fetch Error: " + e.message); 
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

// ═════════════════════════════════════════════════════════════════════════════
// دالة استخراج الرابط المباشر من صفحات التحميل
// ═════════════════════════════════════════════════════════════════════════════

function resolveDownloadLink(downloadUrl) {
  return __async(this, null, function* () {
    try {
      console.log("[UHDMovies] Resolving download link: " + downloadUrl);
      
      var response = yield safeFetch(downloadUrl);
      if (!response || !response.ok) {
        console.log("[UHDMovies] Failed to fetch download page");
        return null;
      }
      
      var html = yield response.text();
      var directUrl = null;
      
      // 1. HubCloud
      if (downloadUrl.includes('hubcloud') || downloadUrl.includes('gamerxyt')) {
        var match = html.match(/file_url['"]?\s*:\s*['"]([^'"]+)['"]/);
        if (match) {
          directUrl = match[1];
        } else {
          match = html.match(/<iframe[^>]+src=['"]([^'"]+)['"]/);
          if (match) directUrl = match[1];
        }
      }
      
      // 2. Streamtape
      else if (downloadUrl.includes('streamtape')) {
        var match = html.match(/getElementById\(['"]videolink['"]\)[^>]*>([^<]+)/);
        if (match) {
          directUrl = "https://streamtape.com/get_video?" + match[1];
        } else {
          match = html.match(/id=['"]videolink['"][^>]*>([^<]+)/);
          if (match) directUrl = "https://streamtape.com/get_video?" + match[1];
        }
      }
      
      // 3. Vidmoly
      else if (downloadUrl.includes('vidmoly')) {
        var match = html.match(/sources:\s*\[\{file:\s*['"]([^'"]+)['"]/);
        if (match) {
          directUrl = match[1];
        } else {
          match = html.match(/file:\s*['"]([^'"]+\.m3u8[^'"]*)['"]/);
          if (match) directUrl = match[1];
        }
      }
      
      // 4. Earnvids
      else if (downloadUrl.includes('earnvids')) {
        var match = html.match(/file_url['"]?\s*:\s*['"]([^'"]+)['"]/);
        if (match) directUrl = match[1];
      }
      
      // 5. StreamHG
      else if (downloadUrl.includes('streamhg')) {
        var match = html.match(/sources:\s*\[\{file:\s*['"]([^'"]+)['"]/);
        if (match) directUrl = match[1];
      }
      
      // 6. Abyss أو روابط مباشرة
      else if (downloadUrl.includes('abyss') || downloadUrl.includes('.mp4') || downloadUrl.includes('.m3u8')) {
        directUrl = downloadUrl;
      }
      
      // 7. محاولة عامة: البحث عن أي رابط فيديو
      if (!directUrl) {
        var match = html.match(/(https?:\/\/[^\s"']+\.mp4[^\s"']*)/);
        if (match) directUrl = match[1];
        
        if (!directUrl) {
          match = html.match(/(https?:\/\/[^\s"']+\.m3u8[^\s"']*)/);
          if (match) directUrl = match[1];
        }
      }
      
      if (directUrl) {
        console.log("[UHDMovies] Resolved direct URL: " + directUrl);
        return directUrl;
      } else {
        console.log("[UHDMovies] Could not resolve direct URL");
        return null;
      }
      
    } catch (error) {
      console.log("[UHDMovies] Error resolving download link: " + error.message);
      return null;
    }
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// دالة مساعدة للتحقق من تطابق الأسماء
// ═════════════════════════════════════════════════════════════════════════════

function normalizeTitle(title) {
  return title.toLowerCase()
    .replace(/[^\w\s]/g, '') // إزالة الرموز
    .replace(/\s+/g, ' ') // توحيد المسافات
    .trim();
}

function titleMatches(searchTitle, candidateTitle) {
  var normalizedSearch = normalizeTitle(searchTitle);
  var normalizedCandidate = normalizeTitle(candidateTitle);
  
  // التحقق من التطابق المباشر
  if (normalizedCandidate.includes(normalizedSearch) || normalizedSearch.includes(normalizedCandidate)) {
    return true;
  }
  
  // التحقق من التطابق الجزئي (على الأقل 70% من الكلمات)
  var searchWords = normalizedSearch.split(' ').filter(w => w.length > 2);
  var candidateWords = normalizedCandidate.split(' ').filter(w => w.length > 2);
  
  if (searchWords.length === 0) return false;
  
  var matchCount = 0;
  for (var i = 0; i < searchWords.length; i++) {
    var word = searchWords[i];
    for (var j = 0; j < candidateWords.length; j++) {
      if (candidateWords[j].includes(word) || word.includes(candidateWords[j])) {
        matchCount++;
        break;
      }
    }
  }
  
  return matchCount / searchWords.length >= 0.7;
}

// ═════════════════════════════════════════════════════════════════════════════
// الدالة الرئيسية
// ═════════════════════════════════════════════════════════════════════════════

function getStreams(tmdbId, mediaType, season, episode) {
  return __async(this, null, function* () {
    var t0 = Date.now();
    var type = mediaType === "movie" ? "movie" : "tv";
    
    console.log("[UHDMovies] === START " + type + "/" + tmdbId + " ===");
    
    try {
      var title = "";
      
      // 1. جلب الاسم من TMDB API
      var metaUrl = "https://api.themoviedb.org/3/" + type + "/" + tmdbId + "?api_key=" + TMDB_API_KEY;
      var metaRes = yield safeFetch(metaUrl);
      
      if (metaRes && metaRes.ok) {
        var metaData = yield metaRes.json();
        if (metaData) {
          title = metaData.name || metaData.original_name || metaData.title || metaData.original_title || "";
          console.log("[UHDMovies] Found title from TMDB API: " + title);
        }
      }
      
      if (!title) {
        console.log("[UHDMovies] Could not fetch title from TMDB, aborting.");
        return [];
      }

      // 2. البحث في multishows.top
      var searchUrl = "https://multishows.top/?s=" + encodeURIComponent(title);
      console.log("[UHDMovies] Searching: " + searchUrl);
      
      var response = yield safeFetch(searchUrl);
      
      if (!response || !response.ok) {
        console.log("[UHDMovies] Search failed. Status: " + (response ? response.status : "No Response"));
        return [];
      }
      
      var html = yield response.text();
      
      // 3. استخراج روابط المحتوى (مسلسلات أو أفلام) مع التحقق من التطابق
      var contentPattern = type === "tv" 
        ? /<a[^>]+href=["'](https?:\/\/multishows\.top\/tv-show\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
        : /<a[^>]+href=["'](https?:\/\/multishows\.top\/movie\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
      
      var contentMatches = [];
      var match;
      while ((match = contentPattern.exec(html)) !== null) {
        var linkText = match[2].replace(/<[^>]+>/g, '').trim();
        
        // ✅ التحقق من أن النتيجة تطابق الاسم المطلوب
        if (titleMatches(title, linkText)) {
          contentMatches.push({url: match[1], text: linkText});
          console.log("[UHDMovies] Found matching content: " + linkText);
        }
      }
      
      console.log("[UHDMovies] Found " + contentMatches.length + " matching content links");
      
      if (contentMatches.length === 0) {
        console.log("[UHDMovies] No matching content found for title: " + title);
        return [];
      }
      
      // اختيار أول نتيجة مطابقة
      var contentUrl = contentMatches[0].url;
      console.log("[UHDMovies] Selected content: " + contentUrl);
      
      // 4. جلب صفحة المحتوى
      var contentRes = yield safeFetch(contentUrl);
      if (!contentRes || !contentRes.ok) {
        console.log("[UHDMovies] Failed to fetch content page");
        return [];
      }
      
      var contentHtml = yield contentRes.text();
      
      // 5. استخراج روابط الحلقات (للمسلسلات فقط)
      var episodeUrl = contentUrl;
      if (type === "tv") {
        var episodePattern = /<a[^>]+href=["'](https?:\/\/multishows\.top\/episode\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
        var episodeMatches = [];
        while ((match = episodePattern.exec(contentHtml)) !== null) {
          episodeMatches.push({url: match[1], text: match[2]});
        }
        
        console.log("[UHDMovies] Found " + episodeMatches.length + " episodes");
        
        if (episodeMatches.length === 0) {
          console.log("[UHDMovies] No episodes found");
          return [];
        }
        
        // اختيار الحلقة المطلوبة
        var episodeIndex = ((season - 1) * 100) + (episode - 1);
        if (episodeIndex >= episodeMatches.length) {
          episodeIndex = episodeMatches.length - 1;
        }
        
        episodeUrl = episodeMatches[episodeIndex].url;
        console.log("[UHDMovies] Selected episode: " + episodeUrl);
      }
      
      // 6. جلب صفحة الحلقة أو الفيلم
      var episodeRes = yield safeFetch(episodeUrl);
      if (!episodeRes || !episodeRes.ok) {
        console.log("[UHDMovies] Failed to fetch episode/movie page");
        return [];
      }
      
      var episodeHtml = yield episodeRes.text();
      
      // 7. استخراج روابط المشاهدة والتحميل
      var streams = [];
      var seen = {};
      
      var linkRegex = /<a[^>]+href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
      
      while ((match = linkRegex.exec(episodeHtml)) !== null) {
        var url = match[1];
        var contextStart = Math.max(0, match.start() - 500);
        var contextText = episodeHtml.substring(contextStart, match.end());
        var cleanContext = contextText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
        
        if (seen[url]) continue;
        seen[url] = true;

        var is4K = /2160p|4k/.test(cleanContext);
        var is1080 = /1080p/.test(cleanContext);
        var isMultiServer = /multi server/.test(cleanContext);
        var isDownload = /download|تحميل/.test(cleanContext);
        
        if (!is4K && !is1080 && !isMultiServer) continue;

        var serverInfo = extractServerInfo(cleanContext);
        if (!serverInfo.quality && is4K) serverInfo.quality = "4K";
        if (!serverInfo.quality && is1080) serverInfo.quality = "1080P";

        var nameParts = ["UHDMovies"];
        if (serverInfo.source) nameParts.push(serverInfo.source);
        nameParts.push(serverInfo.quality || (is4K ? "4K" : "1080P"));
        
        var titleParts = [];
        if (serverInfo.quality) titleParts.push(serverInfo.quality);
        if (serverInfo.hdr) titleParts.push(serverInfo.hdr);
        if (serverInfo.codec) titleParts.push("(" + serverInfo.codec + ")");
        if (serverInfo.source) titleParts.push("• " + serverInfo.source);
        if (serverInfo.size) titleParts.push("[" + serverInfo.size + "]");

        // سيرفرات المشاهدة المباشرة (Multi Server)
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
        // روابط التحميل - نحتاج لفك تشفيرها
        else if ((is4K || is1080) && isDownload) {
          console.log("[UHDMovies] Found download link, resolving...");
          var directUrl = yield resolveDownloadLink(url);
          
          if (directUrl) {
            streams.push({
              name: nameParts.join(" • "),
              title: titleParts.join(" ") || "مشاهدة مباشرة",
              url: directUrl,
              quality: serverInfo.quality || (is4K ? "4K" : "1080P"),
              _sizeRaw: parseSize(serverInfo.size),
              headers: { "User-Agent": UA, "Referer": "https://multishows.top/" }
            });
          } else {
            console.log("[UHDMovies] Could not resolve download link, skipping");
          }
        }
      }

      // 8. ترتيب النتائج
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

      console.log("[UHDMovies] === SUCCESS: Found " + streams.length + " streams in " + (Date.now() - t0) + "ms ===");
      return streams;
      
    } catch (error) {
      console.log("[UHDMovies] FATAL Error: " + error.message);
      return [];
    }
  });
}

module.exports = { getStreams };
