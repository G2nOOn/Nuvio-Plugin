// UHD Movies Scraper for Nuvio Local Scrapers
// React Native compatible version with Cheerio support
// UPDATED: Supports HubCloud direct links (uhdmovies.my new format)

const cheerio = require('cheerio-without-node-native');
console.log('[UHDMovies] Using cheerio-without-node-native for DOM parsing');

// Constants
const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const FALLBACK_DOMAIN = 'https://uhdmovies.my';
const FALLBACK_DOMAINS = [
  'https://uhdmovies.my',
  'https://uhdmovies.pink',
  'https://uhdmovies.email'
];
const DOMAIN_CACHE_TTL = 4 * 60 * 60 * 1000;

// Link patterns
const SID_PATTERNS = [
  'tech.unblockedgames.world',
  'tech.examzculture.in',
  'tech.examdegree.site',
  'tech.creativeexpressionsblog.com'
];
const HUB_CLOUD_PATTERNS = [
  'hubcloud.ist',
  'hubcloud.cx',
  'hubcloud.foo',
  'hubcloud.lol'
];

let uhdMoviesDomain = FALLBACK_DOMAIN;
let domainCacheTimestamp = 0;

async function getUHDMoviesDomain() {
  const now = Date.now();
  if (now - domainCacheTimestamp < DOMAIN_CACHE_TTL) {
    return uhdMoviesDomain;
  }

  try {
    console.log('[UHDMovies] Fetching latest domain from GitHub...');
    const response = await fetch('https://raw.githubusercontent.com/phisher98/TVVVV/refs/heads/main/domains.json', {
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });

    if (response.ok) {
      const data = await response.json();
      if (data && data.UHDMovies) {
        uhdMoviesDomain = data.UHDMovies;
        domainCacheTimestamp = now;
        console.log(`[UHDMovies] Updated domain from GitHub: ${uhdMoviesDomain}`);
        return uhdMoviesDomain;
      }
    }
  } catch (error) {
    console.error(`[UHDMovies] GitHub fetch failed: ${error.message}`);
  }

  for (const domain of FALLBACK_DOMAINS) {
    try {
      console.log(`[UHDMovies] Testing fallback domain: ${domain}`);
      const test = await fetch(`${domain}/`, {
        method: 'GET',
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      });
      if (test.ok) {
        uhdMoviesDomain = domain;
        domainCacheTimestamp = now;
        console.log(`[UHDMovies] Using working domain: ${domain}`);
        return domain;
      }
    } catch (e) {
      console.log(`[UHDMovies] Domain failed: ${domain}`);
    }
  }

  return FALLBACK_DOMAIN;
}

async function makeRequest(url, options = {}) {
  const defaultHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Accept-Encoding': 'gzip, deflate',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1'
  };

  const response = await fetch(url, {
    ...options,
    headers: { ...defaultHeaders, ...options.headers }
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  return response;
}

function isSidLink(url) {
  return SID_PATTERNS.some(p => url && url.includes(p));
}

function isHubCloudLink(url) {
  return HUB_CLOUD_PATTERNS.some(p => url && url.includes(p));
}

async function searchMovies(query) {
  try {
    const domain = await getUHDMoviesDomain();
    const searchUrl = `${domain}/search/${encodeURIComponent(query)}`;
    console.log(`[UHDMovies] Searching: ${searchUrl}`);

    const response = await makeRequest(searchUrl);
    const html = await response.text();
    console.log(`[UHDMovies] Search response: ${response.status}, HTML: ${html.length}`);

    const results = [];
    const $ = cheerio.load(html);

    $('article.gridlove-post').each((index, element) => {
      const linkElement = $(element).find('a[href*="/download-"]');
      if (linkElement.length > 0) {
        const link = linkElement.first().attr('href');
        const title = linkElement.first().attr('title') || $(element).find('h1.sanket').text().trim();
        if (link && title && !results.some(item => item.url === link)) {
          const yearMatch = title.match(/\((\d{4})\)/);
          const year = yearMatch ? parseInt(yearMatch[1]) : null;
          results.push({
            title: title.replace(/\(\d{4}\)/, '').trim(),
            year,
            url: link.startsWith('http') ? link : `${domain}${link}`
          });
        }
      }
    });

    if (results.length === 0) {
      console.log('[UHDMovies] Grid search failed, trying list-based...');
      $('a[href*="/download-"]').each((index, element) => {
        const link = $(element).attr('href');
        if (link && !results.some(item => item.url === link)) {
          const title = $(element).text().trim();
          if (title) {
            const yearMatch = title.match(/\((\d{4})\)/);
            const year = yearMatch ? parseInt(yearMatch[1]) : null;
            results.push({
              title: title.replace(/\(\d{4}\)/, '').trim(),
              year,
              url: link.startsWith('http') ? link : `${domain}${link}`
            });
          }
        }
      });
    }

    console.log(`[UHDMovies] Found ${results.length} search results`);
    return results;
  } catch (error) {
    console.error(`[UHDMovies] Search failed: ${error.message}`);
    return [];
  }
}

function extractCleanQuality(fullQualityText) {
  if (!fullQualityText || fullQualityText === 'Unknown Quality') return 'Unknown Quality';

  const cleaned = fullQualityText.replace(/(\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff])/g, '').trim();
  const text = cleaned.toLowerCase();
  let quality = [];

  if (text.includes('2160p') || text.includes('4k')) quality.push('4K');
  else if (text.includes('1080p')) quality.push('1080p');
  else if (text.includes('720p')) quality.push('720p');
  else if (text.includes('480p')) quality.push('480p');

  if (text.includes('hdr')) quality.push('HDR');
  if (text.includes('dolby vision') || text.includes('dovi') || /\bdv\b/.test(text)) quality.push('DV');
  if (text.includes('imax')) quality.push('IMAX');
  if (text.includes('bluray') || text.includes('blu-ray')) quality.push('BluRay');

  if (quality.length > 0) return quality.join(' | ');

  const patterns = [
    /(\d{3,4}p.*?(?:x264|x265|hevc).*?)[\[\(]/i,
    /(\d{3,4}p.*?)[\[\(]/i,
    /((?:720p|1080p|2160p|4k).*?)$/i
  ];

  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    if (match && match[1].trim().length < 100) {
      return match[1].trim().replace(/x265/ig, 'HEVC');
    }
  }

  if (cleaned.length > 80) {
    return cleaned.substring(0, 77).replace(/x265/ig, 'HEVC') + '...';
  }

  return cleaned.replace(/x265/ig, 'HEVC');
}

function compareMedia(mediaInfo, searchResult) {
  const titleMatch = mediaInfo.title.toLowerCase().includes(searchResult.title.toLowerCase()) ||
    searchResult.title.toLowerCase().includes(mediaInfo.title.toLowerCase());
  const yearMatch = !mediaInfo.year || !searchResult.year ||
    Math.abs(mediaInfo.year - searchResult.year) <= 1;
  return titleMatch && yearMatch;
}

function parseSize(sizeString) {
  if (!sizeString || typeof sizeString !== 'string') return 0;
  const match = sizeString.match(/(\d+(?:\.\d+)?)\s*(GB|MB|TB)/i);
  if (!match) return 0;
  const value = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  switch (unit) {
    case 'TB': return value * 1024 * 1024 * 1024 * 1024;
    case 'GB': return value * 1024 * 1024 * 1024;
    case 'MB': return value * 1024 * 1024;
    default: return value;
  }
}

// ========== HUB CLOUD RESOLUTION (FIXED) ==========
async function resolveHubCloudLink(hubcloudUrl) {
  console.log(`[UHDMovies] Resolving HubCloud: ${hubcloudUrl}`);

  try {
    // Step 1: Fetch HubCloud landing page
    const response = await makeRequest(hubcloudUrl, {
      headers: { 'Referer': 'https://uhdmovies.my/' }
    });
    const html = await response.text();
    console.log(`[UHDMovies] HubCloud page: ${html.length} chars`);

    // LOG HTML SAMPLE for debugging
    console.log(`[UHDMovies] HTML sample: ${html.substring(0, 800).replace(/\s+/g, ' ')}`);

    const $ = cheerio.load(html);
    const hubOrigin = new URL(hubcloudUrl).origin;

    // Step 2: Find button candidates
    const buttonUrls = new Set();

    // Pattern A: buttons with text like "R2", "10Gbps", "PixelDrain", "Download"
    $('a').each((i, el) => {
      const text = $(el).text().trim();
      const href = $(el).attr('href');
      if (!href) return;

      const lowerText = text.toLowerCase();
      if (/r2|10gbps|pixel|drive|download|instant|direct/i.test(lowerText) &&
          !/donate|support|telegram/i.test(lowerText)) {
        const absUrl = href.startsWith('http') ? href : hubOrigin + (href.startsWith('/') ? '' : '/') + href;
        buttonUrls.add(absUrl);
        console.log(`[UHDMovies] Button candidate: "${text}" → ${absUrl.substring(0, 100)}`);
      }
    });

    // Pattern B: any link with direct-download keywords in URL
    $('a[href]').each((i, el) => {
      const href = $(el).attr('href');
      if (!href) return;
      if (/r2\.cloudflarestorage|workers\.dev|pixeldrain|gpdl\.|hubcloud\.ist\/dl/i.test(href)) {
        buttonUrls.add(href);
        console.log(`[UHDMovies] Direct URL candidate: ${href.substring(0, 100)}`);
      }
    });

    // Pattern C: JS-embedded URLs
    const jsRegex = /["'](https?:\/\/[^"'\s]*?(?:r2\.cloudflarestorage\.com|workers\.dev|pixeldrain\.dev\/api\/file|gpdl\.[^"'\s]*?))[^"'\s]*/gi;
    let m;
    while ((m = jsRegex.exec(html)) !== null) {
      buttonUrls.add(m[1]);
      console.log(`[UHDMovies] JS-embedded URL: ${m[1].substring(0, 100)}`);
    }

    if (buttonUrls.size === 0) {
      console.log(`[UHDMovies] ⚠️ No button candidates found. HTML structure changed.`);
      return null;
    }

    // Step 3: Try each candidate URL
    for (const candidateUrl of buttonUrls) {
      console.log(`[UHDMovies] Trying candidate: ${candidateUrl.substring(0, 100)}`);

      // If it's already a direct file URL, return it
      if (/\.mkv|\.mp4|r2\.cloudflarestorage\.com|pixeldrain\.dev\/api\/file/i.test(candidateUrl)) {
        console.log(`[UHDMovies] ✓ Direct file URL: ${candidateUrl.substring(0, 100)}`);
        return candidateUrl;
      }

      // Otherwise fetch and look for redirect
      try {
        const innerResp = await makeRequest(candidateUrl, {
          headers: { 'Referer': hubcloudUrl }
        });
        const innerHtml = await innerResp.text();
        console.log(`[UHDMovies] Inner page: ${innerHtml.length} chars`);

        // Look for meta refresh
        const metaMatch = innerHtml.match(/<meta[^>]*http-equiv=["']refresh["'][^>]*content=["'][^"']*url=([^"'\s]+)/i);
        if (metaMatch) {
          console.log(`[UHDMovies] ✓ Meta refresh found: ${metaMatch[1].substring(0, 100)}`);
          return metaMatch[1];
        }

        // Look for JS redirects
        const jsRedirect = innerHtml.match(/(?:window\.location\.(?:href|replace)|location\.href)\s*[=\(]\s*["']([^"']+)["']/i);
        if (jsRedirect) {
          console.log(`[UHDMovies] ✓ JS redirect found: ${jsRedirect[1].substring(0, 100)}`);
          return jsRedirect[1];
        }

        // Look for direct file links
        const fileMatch = innerHtml.match(/["'](https?:\/\/[^"'\s]*?\.(?:mkv|mp4)[^"'\s]*)["']/i);
        if (fileMatch) {
          console.log(`[UHDMovies] ✓ File link found: ${fileMatch[1].substring(0, 100)}`);
          return fileMatch[1];
        }

        // Look for R2/workers.dev URLs
        const r2Match = innerHtml.match(/["'](https?:\/\/[^"'\s]*?(?:r2\.cloudflarestorage\.com|workers\.dev|pixeldrain)[^"'\s]*)["']/i);
        if (r2Match) {
          console.log(`[UHDMovies] ✓ R2/Workers link: ${r2Match[1].substring(0, 100)}`);
          return r2Match[1];
        }

        console.log(`[UHDMovies] No link found on inner page, trying next candidate...`);
      } catch (e) {
        console.log(`[UHDMovies] Inner fetch failed: ${e.message}`);
      }
    }

    console.log(`[UHDMovies] ❌ All candidates failed`);
    return null;

  } catch (error) {
    console.error(`[UHDMovies] HubCloud resolve failed: ${error.message}`);
    return null;
  }
}
// ========== END HUB CLOUD RESOLUTION ==========

// Resolve SID to driveleech (existing logic)
async function resolveSidToDriveleech(sidUrl) {
  console.log(`[UHDMovies] Resolving SID: ${sidUrl}`);
  const origin = new URL(sidUrl).origin;

  try {
    const responseStep0 = await makeRequest(sidUrl);
    const html0 = await responseStep0.text();

    const wpHttpRegex = /<input[^>]*name="_wp_http"[^>]*value="([^"]*)"[^>]*>/i;
    const actionRegex = /<form[^>]*id="landing"[^>]*action="([^"]*)"[^>]*>/i;
    const wpHttpMatch = wpHttpRegex.exec(html0);
    const actionMatch = actionRegex.exec(html0);

    if (!wpHttpMatch || !actionMatch) return null;

    const step1Data = new URLSearchParams({ '_wp_http': wpHttpMatch[1] });
    const responseStep1 = await fetch(actionMatch[1], {
      method: 'POST',
      body: step1Data,
      headers: {
        'Referer': sidUrl,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    const html1 = await responseStep1.text();

    const action2Regex = /<form[^>]*id="landing"[^>]*action="([^"]*)"[^>]*>/i;
    const wpHttp2Regex = /<input[^>]*name="_wp_http2"[^>]*value="([^"]*)"[^>]*>/i;
    const tokenRegex = /<input[^>]*name="token"[^>]*value="([^"]*)"[^>]*>/i;

    const action2Match = action2Regex.exec(html1);
    const wpHttp2Match = wpHttp2Regex.exec(html1);
    const tokenMatch = tokenRegex.exec(html1);

    if (!action2Match) return null;

    const step2Data = new URLSearchParams({
      '_wp_http2': wpHttp2Match ? wpHttp2Match[1] : '',
      'token': tokenMatch ? tokenMatch[1] : ''
    });
    const responseStep2 = await fetch(action2Match[1], {
      method: 'POST',
      body: step2Data,
      headers: {
        'Referer': responseStep1.url,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    const html2 = await responseStep2.text();

    const cookieMatch = html2.match(/s_343\('([^']+)',\s*'([^']+)'/);
    const linkMatch = html2.match(/c\.setAttribute\("href",\s*"([^"]+)"\)/);

    if (!cookieMatch || !linkMatch) return null;

    const finalUrl = new URL(linkMatch[1].trim(), origin).href;
    const finalResponse = await fetch(finalUrl, {
      headers: {
        'Referer': responseStep2.url,
        'Cookie': `${cookieMatch[1].trim()}=${cookieMatch[2].trim()}`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const finalHtml = await finalResponse.text();
    const metaRefreshRegex = /<meta[^>]*http-equiv="refresh"[^>]*content="[^"]*url=([^"]*)"[^>]*>/i;
    const metaMatch = metaRefreshRegex.exec(finalHtml);

    if (metaMatch && metaMatch[1]) {
      return metaMatch[1].replace(/['"]/g, '');
    }

    return null;
  } catch (error) {
    console.error(`[UHDMovies] SID resolve failed: ${error.message}`);
    return null;
  }
}

// Resolve download link (supports both HubCloud + SID)
async function resolveDownloadLink(linkInfo) {
  try {
    console.log(`[UHDMovies] Resolving: ${linkInfo.quality} → ${linkInfo.url.substring(0, 80)}`);

    // === Branch 1: HubCloud direct link ===
    if (isHubCloudLink(linkInfo.url)) {
      const finalUrl = await resolveHubCloudLink(linkInfo.url);
      if (!finalUrl) {
        console.log(`[UHDMovies] HubCloud resolution failed`);
        return null;
      }

      return {
        name: `UHD Movies`,
        title: `${linkInfo.quality}\n${linkInfo.size || 'Unknown'}`,
        url: finalUrl,
        quality: linkInfo.quality,
        size: linkInfo.size,
        type: 'direct'
      };
    }

    // === Branch 2: SID link (existing) ===
    let resolvedUrl = null;
    if (isSidLink(linkInfo.url)) {
      resolvedUrl = await resolveSidToDriveleech(linkInfo.url);
    } else if (linkInfo.url.includes('driveleech.net') || linkInfo.url.includes('driveseed.org')) {
      resolvedUrl = linkInfo.url;
    }

   Instant if (!resolvedUrl) Download {
      console.log(`[UHDMovies] Could not resolve link`);
      return null;
")').   attr(' }

    if (!resolvedUrl.includes('driveleech.net') && !resolvedUrl.includes('driveseed.org')) {
      console.log(`[UHDMovies] Unsupported resolved URL: ${resolvedUrl.substring(0, 80)}`);
      return null;
    }

    // Handle driveseed
    if (resolvedUrl.includes('driveseed.org')) {
      const response = await makeRequest(resolvedUrl, {
        headers: { 'Referer': 'https://links.modpro.blog/' }
      });
      const html = await response.text();
      const $ = cheerio.load(html);

      let size = 'Unknown';
      let fileName = null;
      $('ul.list-group li').each((i, el) => {
        const text = $(el).text();
        if (text.includes('Size :')) size = text.split(':')[1].trim();
        else if (text.includes('Name :')) fileName = text.split(':')[1].trim();
      });

      const resumeCloudLink = $('a:contains("Resume Cloud")').attr('href');
      const instantLink = $('a:contains("href');

      let finalUrl = null;

      if (resumeCloudLink) {
        const resumeUrl = resumeCloudLink.startsWith('http') ? resumeCloudLink : `https://driveseed.org${resumeCloudLink}`;
        try {
          const resumeResp = await makeRequest(resumeUrl, { headers: { 'Referer': 'https://driveseed.org/' } });
          const resumeHtml = await resumeResp.text();
          const $$ = cheerio.load(resumeHtml);
          finalUrl = $$('a:contains("Cloud Resume Download")').attr('href');
        } catch (e) {
          console.log(`[UHDMovies] Resume Cloud failed: ${e.message}`);
        }
      }

      if (!finalUrl && instantLink) {
        finalUrl = instantLink;
      }

      if (!finalUrl) return null;

      if (finalUrl.includes('workers.dev')) {
        const parts = finalUrl.split('/');
        const fn = parts[parts.length - 1];
        parts[parts.length - 1] = fn.replace(/ /g, '%20');
        finalUrl = parts.join('/');
      }

      return {
        name: `UHD Movies`,
        title: `${fileName || linkInfo.quality}\n${size}`,
        url: finalUrl,
        quality: linkInfo.quality,
        size: size,
        type: 'direct'
      };
    }

    return null;

  } catch (error) {
    console.error(`[UHDMovies] Failed to resolve: ${error.message}`);
    return null;
  }
}

// Extract movie download links (supports HubCloud)
async function extractDownloadLinks(movieUrl, targetYear = null) {
  try {
    console.log(`[UHDMovies] Extracting from: ${movieUrl}`);
    const response = await makeRequest(movieUrl);
    const html = await response.text();
    const $ = cheerio.load(html);
    const links = [];

    $('a[href]').each((index, element) => {
      const href = $(element).attr('href');
      if (!href) return;

      const isSid = isSidLink(href);
      const isHubCloud = isHubCloudLink(href);

      if (!isSid && !isHubCloud) return;
      if (links.some(item => item.url === href)) return;

      let quality = 'Unknown Quality';
      let size = 'Unknown';

      let current = $(element).parent();
      for (let i = 0; i < 8; i++) {
        if (current.length === 0) break;
        const text = current.text().trim();
        if (text.length > 15 &&
            /(1080p|720p|2160p|4k|480p|hevc|x264|x265|web-dl|bluray)/i.test(text)) {
          quality = text;
          break;
        }
        current = current.prev();
      }

      const sizeMatch = quality.match(/\[([0-9.,]+\s*[KMGT]B[^\]]*)\]/i);
      if (sizeMatch) size = sizeMatch[1];

      if (targetYear && quality !== 'Unknown Quality') {
        const yearMatches = quality.match(/\b(19|20)\d{2}\b/g);
        if (yearMatches && yearMatches.length > 0) {
          const hasTarget = yearMatches.some(y => parseInt(y) === targetYear);
          if (!hasTarget) return;
        }
      }

      const cleanQuality = extractCleanQuality(quality);
      links.push({
        url: href,
        quality: cleanQuality,
        size: size,
        rawQuality: quality.replace(/\s+/g, ' ').trim()
      });
    });

    console.log(`[UHDMovies] Extracted ${links.length} links`);
    return links;
  } catch (error) {
    console.error(`[UHDMovies] Extract failed: ${error.message}`);
    return [];
  }
}

// Extract TV show links (supports HubCloud)
async function extractTvShowDownloadLinks(showPageUrl, targetSeason, targetEpisode) {
  try {
    console.log(`[UHDMovies] TV: ${showPageUrl} S${targetSeason}E${targetEpisode}`);
    const response = await makeRequest(showPageUrl);
    const html = await response.text();
    const $ = cheerio.load(html);
    const links = [];

    let inTargetSeason = false;
    let qualityText = '';

    $('.entry-content').find('*').each((index, element) => {
      const $el = $(element);
      const text = $el.text().trim();
      const seasonMatch = text.match(/^SEASON\s+(\d+)/i);

      if (seasonMatch) {
        const num = parseInt(seasonMatch[1], 10);
        if (num === targetSeason) {
          inTargetSeason = true;
          console.log(`[UHDMovies] In Season ${targetSeason}`);
        } else if (inTargetSeason) {
          inTargetSeason = false;
          return false;
        }
      }

      if (!inTargetSeason) return;

      if ($el.is('pre, p:has(strong), p:has(b), h3, h4, div:has(strong)')) {
        const headerText = $el.text().trim();
        if (headerText.length > 10 && headerText.length < 500 &&
            /(1080p|720p|2160p|4k|480p|hevc|x264|x265|web-dl)/i.test(headerText) &&
            !/plot|screenshot|trailer/i.test(headerText) &&
            !$el.find('a').length) {
          qualityText = headerText;
        }
      }

      const episodeRegex = new RegExp(`^Episode\\s+0*${targetEpisode}(?!\\d)`, 'i');
      $el.find('a[href]').each((i, a) => {
        const href = $(a).attr('href');
        const linkText = $(a).text().trim();

        if (!href) return;
        if (!isSidLink(href) && !isHubCloudLink(href)) return;
        if (!episodeRegex.test(linkText)) return;
        if (links.some(item => item.url === href)) return;

        const sizeMatch = qualityText.match(/\[([0-9.,]+\s*[KMGT]B)/i);
        const size = sizeMatch ? sizeMatch[1].replace(/[\[\]]/g, '').trim() : 'Unknown';

        const cleanQuality = extractCleanQuality(qualityText);
        links.push({
          url: href,
          quality: cleanQuality,
          size: size,
          rawQuality: qualityText.replace(/\s+/g, ' ').trim().substring(0, 200)
        });

        console.log(`[UHDMovies] Found: ${cleanQuality} → ${href.substring(0, 60)}`);
      });
    });

    console.log(`[UHDMovies] Found ${links.length} episode links`);
    return links;
  } catch (error) {
    console.error(`[UHDMovies] TV extract failed: ${error.message}`);
    return [];
  }
}

// Main function
async function getStreams(tmdbId, mediaType = 'movie', season = null, episode = null) {
  console.log(`[UHDMovies] Fetch: TMDB=${tmdbId}, Type=${mediaType}${mediaType === 'tv' ? `, S${season}E${episode}` : ''}`);

  try {
    const tmdbUrl = `https://api.themoviedb.org/3/${mediaType === 'tv' ? 'tv' : 'movie'}/${tmdbId}?api_key=${TMDB_API_KEY}`;
    const tmdbResponse = await makeRequest(tmdbUrl);
    const tmdbData = await tmdbResponse.json();

    const mediaInfo = {
      title: mediaType === 'tv' ? tmdbData.name : tmdbData.title,
      year: parseInt(((mediaType === 'tv' ? tmdbData.first_air_date : tmdbData.release_date) || '').split('-')[0], 10)
    };

    if (!mediaInfo.title) throw new Error('No title from TMDB');

    console.log(`[UHDMovies] TMDB: "${mediaInfo.title}" (${mediaInfo.year})`);

    let searchTitle = mediaInfo.title.replace(/:/g, '').replace(/\s*&\s*/g, ' and ');
    let searchResults = await searchMovies(searchTitle);

    if (searchResults.length === 0 || !searchResults.some(r => compareMedia(mediaInfo, r))) {
      console.log(`[UHDMovies] Trying fallback search...`);
      const fallback = mediaInfo.title.split(':')[0].trim();
      if (fallback !== searchTitle) {
        searchResults = await searchMovies(fallback);
      }
    }

    if (searchResults.length === 0) {
      console.log(`[UHDMovies] No search results`);
      return [];
    }

    const bestMatch = searchResults.find(r => compareMedia(mediaInfo, r)) || searchResults[0];
    console.log(`[UHDMovies] Match: "${bestMatch.title}" (${bestMatch.year})`);

    let downloadLinks = [];
    if (mediaType === 'tv' && season && episode) {
      downloadLinks = await extractTvShowDownloadLinks(bestMatch.url, season, episode);
    } else {
      downloadLinks = await extractDownloadLinks(bestMatch.url);
    }

    if (downloadLinks.length === 0) {
      console.log(`[UHDMovies] No download links found`);
      return [];
    }

    const streamPromises = downloadLinks.map(link => resolveDownloadLink(link));
    const streams = (await Promise.all(streamPromises)).filter(Boolean);

    streams.sort((a, b) => parseSize(b.size) - parseSize(a.size));

    console.log(`[UHDMovies] Returning ${streams.length} streams`);
    return streams;
  } catch (error) {
    console.error(`[UHDMovies] Error: ${error.message}`);
    return [];
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams };
} else {
  global.getStreams = getStreams;
}
