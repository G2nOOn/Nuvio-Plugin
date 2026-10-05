// UHD Movies Scraper for Nuvio Local Scrapers
// React Native compatible version with Cheerio support

const cheerio = require('cheerio-without-node-native');
console.log('[UHDMovies] Using cheerio-without-node-native for DOM parsing');

// Constants
const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const FALLBACK_DOMAIN = 'https://uhdmovies.my';
const FALLBACK_DOMAINS = [
  'https://uhdmovies.my',
  'https://uhdmovies.pink',
  'https://uhdmovies.email',
  'https://uhdmovies.dev',
  'https://uhdmovies.website'
];
const DOMAIN_CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours

// Global variables for domain caching
let uhdMoviesDomain = FALLBACK_DOMAIN;
let domainCacheTimestamp = 0;

// Fetch latest domain from GitHub + fallback test
async function getUHDMoviesDomain() {
  const now = Date.now();
  if (now - domainCacheTimestamp < DOMAIN_CACHE_TTL) {
    return uhdMoviesDomain;
  }

  try {
    console.log('[UHDMovies] Fetching latest domain from GitHub...');
    const response = await fetch('https://raw.githubusercontent.com/phisher98/TVVVV/refs/heads/main/domains.json', {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
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

  // Test each fallback domain
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

  console.log(`[UHDMovies] All domains failed, using default: ${FALLBACK_DOMAIN}`);
  return FALLBACK_DOMAIN;
}

// Helper function to make HTTP requests
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
    headers: {
      ...defaultHeaders,
      ...options.headers
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return response;
}

// Search for movies on UHD Movies
async function searchMovies(query) {
  try {
    const domain = await getUHDMoviesDomain();
    const searchUrl = `${domain}/search/${encodeURIComponent(query)}`;

    console.log(`[UHDMovies] Searching: ${searchUrl}`);

    const response = await makeRequest(searchUrl);
    const html = await response.text();

    console.log(`[UHDMovies] Search response: ${response.status}, HTML length: ${html.length}`);

    const results = [];
    const $ = cheerio.load(html);

    // New logic for grid-based search results
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

    // Fallback for original list-based search
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

// Extract clean quality information
function extractCleanQuality(fullQualityText) {
  if (!fullQualityText || fullQualityText === 'Unknown Quality') {
    return 'Unknown Quality';
  }

  const cleanedFullQualityText = fullQualityText.replace(/(\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff])/g, '').trim();
  const text = cleanedFullQualityText.toLowerCase();
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
    const match = cleanedFullQualityText.match(pattern);
    if (match && match[1].trim().length < 100) {
      return match[1].trim().replace(/x265/ig, 'HEVC');
    }
  }

  if (cleanedFullQualityText.length > 80) {
    return cleanedFullQualityText.substring(0, 77).replace(/x265/ig, 'HEVC') + '...';
  }

  return cleanedFullQualityText.replace(/x265/ig, 'HEVC');
}

// Compare media info
function compareMedia(mediaInfo, searchResult) {
  const titleMatch = mediaInfo.title.toLowerCase().includes(searchResult.title.toLowerCase()) ||
    searchResult.title.toLowerCase().includes(mediaInfo.title.toLowerCase());

  const yearMatch = !mediaInfo.year || !searchResult.year ||
    Math.abs(mediaInfo.year - searchResult.year) <= 1;

  return titleMatch && yearMatch;
}

// Extract quality from page title
function extractQualityFromTitle(pageTitle) {
  if (!pageTitle) return 'Unknown Quality';

  const qualities = [];
  const title = pageTitle.toLowerCase();

  if (title.includes('2160p') || title.includes('4k')) qualities.push('4K');
  else if (title.includes('1080p')) qualities.push('1080p');
  else if (title.includes('720p')) qualities.push('720p');
  else if (title.includes('480p')) qualities.push('480p');

  if (title.includes('hdr')) qualities.push('HDR');
  if (title.includes('dolby vision') || title.includes('dv')) qualities.push('DV');
  if (title.includes('imax')) qualities.push('IMAX');
  if (title.includes('bluray') || title.includes('blu-ray')) qualities.push('BluRay');
  if (title.includes('hevc') || title.includes('x265')) qualities.push('HEVC');
  if (title.includes('10bit')) qualities.push('10bit');

  return qualities.length > 0 ? qualities.join(' | ') : 'Unknown Quality';
}

// Extract download links from movie page
async function extractDownloadLinks(movieUrl, targetYear = null) {
  try {
    console.log(`[UHDMovies] Extracting links from: ${movieUrl}`);

    const response = await makeRequest(movieUrl);
    const html = await response.text();

    const links = [];
    const $ = cheerio.load(html);

    $('a[href*="tech.unblockedgames.world"], a[href*="tech.examzculture.in"], a[href*="tech.examdegree.site"]').each((index, element) => {
      const link = $(element).attr('href');

      if (link && !links.some(item => item.url === link)) {
        let quality = 'Unknown Quality';
        let size = 'Unknown';

        const prevElement = $(element).closest('p').prev();
        if (prevElement.length > 0) {
          const prevText = prevElement.text().trim();
          if (prevText && prevText.length > 20 && !prevText.includes('Download')) {
            quality = prevText;
          }
        }

        if (quality === 'Unknown Quality') {
          const parentSiblings = $(element).parent().prevAll().first().text().trim();
          if (parentSiblings && parentSiblings.length > 20) {
            quality = parentSiblings;
          }
        }

        if (quality === 'Unknown Quality') {
          const strongText = $(element).closest('p').prevAll().find('strong, b').last().text().trim();
          if (strongText && strongText.length > 20) {
            quality = strongText;
          }
        }

        if (quality === 'Unknown Quality') {
          let currentElement = $(element).parent();
          for (let i = 0; i < 5; i++) {
            currentElement = currentElement.prev();
            if (currentElement.length === 0) break;

            const text = currentElement.text().trim();
            if (text && text.length > 30 &&
              (text.includes('1080p') || text.includes('720p') || text.includes('2160p') ||
                text.includes('4K') || text.includes('HEVC') || text.includes('x264') || text.includes('x265'))) {
              quality = text;
              break;
            }
          }
        }

        if (targetYear && quality !== 'Unknown Quality') {
          const yearMatches = quality.match(/\((\d{4})\)/g);
          let hasMatchingYear = false;

          if (yearMatches && yearMatches.length > 0) {
            for (const yearMatch of yearMatches) {
              const year = parseInt(yearMatch.replace(/[()]/g, ''));
              if (year === targetYear) {
                hasMatchingYear = true;
                break;
              }
            }
            if (!hasMatchingYear) {
              console.log(`[UHDMovies] Skipping link due to year mismatch. Target: ${targetYear}, Found: ${yearMatches.join(', ')}`);
              return;
            }
          } else {
            const linkText = $(element).text().trim();
            const parentText = $(element).parent().text().trim();
            const combinedText = `${quality} ${linkText} ${parentText}`;

            const allYearMatches = combinedText.match(/\((\d{4})\)/g) || combinedText.match(/(\d{4})/g);
            if (allYearMatches) {
              let foundTargetYear = false;
              for (const yearMatch of allYearMatches) {
                const year = parseInt(yearMatch.replace(/[()]/g, ''));
                if (year >= 1900 && year <= 2030) {
                  if (year === targetYear) {
                    foundTargetYear = true;
                    break;
                  }
                }
              }
              if (!foundTargetYear && allYearMatches.length > 0) {
                console.log(`[UHDMovies] Skipping link due to no matching year. Target: ${targetYear}`);
                return;
              }
            }
          }
        }

        const sizeMatch = quality.match(/\[([0-9.,]+\s*[KMGT]B[^\]]*)\]/);
        if (sizeMatch) {
          size = sizeMatch[1];
        }

        const cleanQuality = extractCleanQuality(quality);

        links.push({
          url: link,
          quality: cleanQuality,
          size: size,
          rawQuality: quality.replace(/(\r\n|\n|\r)/gm, " ").replace(/\s+/g, ' ').trim()
        });
      }
    });

    console.log(`[UHDMovies] Extracted ${links.length} download links`);
    return links;
  } catch (error) {
    console.error(`[UHDMovies] Failed to extract links: ${error.message}`);
    return [];
  }
}

// Parse size string
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

// Resolve SID to driveleech
async function resolveSidToDriveleech(sidUrl) {
  console.log(`[UHDMovies] Resolving SID link: ${sidUrl}`);
  const origin = new URL(sidUrl).origin;

  try {
    console.log("  [SID] Step 0: Fetching initial page...");
    const responseStep0 = await makeRequest(sidUrl);
    const html0 = await responseStep0.text();

    const wpHttpRegex = /<input[^>]*name="_wp_http"[^>]*value="([^"]*)"[^>]*>/i;
    const actionRegex = /<form[^>]*id="landing"[^>]*action="([^"]*)"[^>]*>/i;

    const wpHttpMatch = wpHttpRegex.exec(html0);
    const actionMatch = actionRegex.exec(html0);

    if (!wpHttpMatch || !actionMatch) {
      console.error("  [SID] Error: Could not find _wp_http in initial form.");
      return null;
    }

    const wpHttp = wpHttpMatch[1];
    const actionUrl = actionMatch[1];

    console.log("  [SID] Step 1: Submitting initial form...");
    const step1Data = new URLSearchParams({ '_wp_http': wpHttp });
    const responseStep1 = await fetch(actionUrl, {
      method: 'POST',
      body: step1Data,
      headers: {
        'Referer': sidUrl,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36'
      }
    });

    const html1 = await responseStep1.text();

    console.log("  [SID] Step 2: Parsing verification page...");
    const action2Regex = /<form[^>]*id="landing"[^>]*action="([^"]*)"[^>]*>/i;
    const wpHttp2Regex = /<input[^>]*name="_wp_http2"[^>]*value="([^"]*)"[^>]*>/i;
    const tokenRegex = /<input[^>]*name="token"[^>]*value="([^"]*)"[^>]*>/i;

    const action2Match = action2Regex.exec(html1);
    const wpHttp2Match = wpHttp2Regex.exec(html1);
    const tokenMatch = tokenRegex.exec(html1);

    if (!action2Match) {
      console.error("  [SID] Error: Could not find verification form action.");
      return null;
    }

    const action2Url = action2Match[1];
    const wpHttp2 = wpHttp2Match ? wpHttp2Match[1] : '';
    const token = tokenMatch ? tokenMatch[1] : '';

    console.log("  [SID] Step 3: Submitting verification...");
    const step2Data = new URLSearchParams({ '_wp_http2': wpHttp2, 'token': token });
    const responseStep2 = await fetch(action2Url, {
      method: 'POST',
      body: step2Data,
      headers: {
        'Referer': responseStep1.url,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36'
      }
    });

    const html2 = await responseStep2.text();

    console.log("  [SID] Step 4: Parsing final page for JS data...");
    let finalLinkPath = null;
    let cookieName = null;
    let cookieValue = null;

    const cookieMatch = html2.match(/s_343\('([^']+)',\s*'([^']+)'/);
    const linkMatch = html2.match(/c\.setAttribute\("href",\s*"([^"]+)"\)/);

    if (cookieMatch) {
      cookieName = cookieMatch[1].trim();
      cookieValue = cookieMatch[2].trim();
    }
    if (linkMatch) {
      finalLinkPath = linkMatch[1].trim();
    }

    if (!finalLinkPath || !cookieName || !cookieValue) {
      console.error("  [SID] Error: Could not extract dynamic cookie/link from JS.");
      return null;
    }

    const finalUrl = new URL(finalLinkPath, origin).href;
    console.log(`  [SID] Dynamic link found: ${finalUrl}`);

    console.log("  [SID] Step 5: Setting cookie and making final request...");
    const cookieHeader = `${cookieName}=${cookieValue}`;

    const finalResponse = await fetch(finalUrl, {
      headers: {
        'Referer': responseStep2.url,
        'Cookie': cookieHeader,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36'
      }
    });

    const finalHtml = await finalResponse.text();

    const metaRefreshRegex = /<meta[^>]*http-equiv="refresh"[^>]*content="[^"]*url=([^"]*)"[^>]*>/i;
    const metaMatch = metaRefreshRegex.exec(finalHtml);

    if (metaMatch && metaMatch[1]) {
      const driveleechUrl = metaMatch[1].replace(/['"]/g, '');
      console.log(`  [SID] SUCCESS! Resolved Driveleech URL: ${driveleechUrl}`);
      return driveleechUrl;
    }

    console.error("  [SID] Error: Could not find meta refresh tag with Driveleech URL.");
    return null;

  } catch (error) {
    console.error(`  [SID] Error during SID resolution: ${error.message}`);
    return null;
  }
}

// Try Instant Download
async function tryInstantDownload(html) {
  const videoSeedRegex = /href="([^"]*(?:video-seed\.pro|video-leech\.pro)[^"]*)"/i;
  const match = videoSeedRegex.exec(html);

  if (!match || !match[1]) {
    return null;
  }

  const instantDownloadLink = match[1];
  console.log('[UHDMovies] Found "Instant Download" link...');

  try {
    const url = new URL(instantDownloadLink);
    const keys = url.searchParams.get('url');

    if (keys) {
      const apiUrl = `${url.origin}/api`;
      const formData = new URLSearchParams();
      formData.append('keys', keys);

      const apiResponse = await fetch(apiUrl, {
        method: 'POST',
        body: formData,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'x-token': url.hostname,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (apiResponse.ok) {
        const responseData = await apiResponse.json();
        if (responseData && responseData.url) {
          let finalUrl = responseData.url;
          if (finalUrl.includes('workers.dev')) {
            const urlParts = finalUrl.split('/');
            const filename = urlParts[urlParts.length - 1];
            const encodedFilename = filename.replace(/ /g, '%20');
            urlParts[urlParts.length - 1] = encodedFilename;
            finalUrl = urlParts.join('/');
          }
          console.log('[UHDMovies] Extracted final link from API:', finalUrl);
          return finalUrl;
        }
      }
    }

    return null;
  } catch (error) {
    console.log(`[UHDMovies] Error processing Instant Download: ${error.message}`);
    return null;
  }
}

// Resolve driveseed link
async function resolveDriveseedLink(driveseedUrl) {
  try {
    const response = await makeRequest(driveseedUrl, {
      headers: { 'Referer': 'https://links.modpro.blog/' }
    });
    const html = await response.text();

    const redirectMatch = html.match(/window\.location\.replace\("([^"]+)"\)/);

    if (redirectMatch && redirectMatch[1]) {
      const finalPath = redirectMatch[1];
      const finalUrl = `https://driveseed.org${finalPath}`;

      const finalResponse = await makeRequest(finalUrl, {
        headers: { 'Referer': driveseedUrl }
      });
      const finalHtml = await finalResponse.text();
      const $ = cheerio.load(finalHtml);

      const downloadOptions = [];
      let size = null;
      let fileName = null;

      $('ul.list-group li').each((i, el) => {
        const text = $(el).text();
        if (text.includes('Size :')) size = text.split(':')[1].trim();
        else if (text.includes('Name :')) fileName = text.split(':')[1].trim();
      });

      const resumeCloudLink = $('a:contains("Resume Cloud")').attr('href');
      if (resumeCloudLink) {
        downloadOptions.push({
          title: 'Resume Cloud',
          type: 'resume',
          url: `https://driveseed.org${resumeCloudLink}`,
          priority: 1
        });
      }

      const workerSeedLink = $('a:contains("Resume Worker Bot")').attr('href');
      if (workerSeedLink) {
        downloadOptions.push({
          title: 'Resume Worker Bot',
          type: 'worker',
          url: workerSeedLink,
          priority: 2
        });
      }

      $('a[href*="/download/"]').each((i, el) => {
        const href = $(el).attr('href');
        const text = $(el).text().trim();
        if (href && text && !downloadOptions.some(opt => opt.url === href)) {
          downloadOptions.push({
            title: text,
            type: 'generic',
            url: href.startsWith('http') ? href : `https://driveseed.org${href}`,
            priority: 4
          });
        }
      });

      const instantDownloadLink = $('a:contains("Instant Download")').attr('href');
      if (instantDownloadLink) {
        downloadOptions.push({
          title: 'Instant Download',
          type: 'instant',
          url: instantDownloadLink,
          priority: 3
        });
      }

      downloadOptions.sort((a, b) => a.priority - b.priority);
      return { downloadOptions, size, fileName };
    }
    return { downloadOptions: [], size: null, fileName: null };
  } catch (error) {
    console.error(`[UHDMovies] Error resolving Driveseed link: ${error.message}`);
    return { downloadOptions: [], size: null, fileName: null };
  }
}

// Resolve Resume Cloud
async function resolveResumeCloudLink(resumeUrl) {
  try {
    const response = await makeRequest(resumeUrl, {
      headers: { 'Referer': 'https://driveseed.org/' }
    });
    const html = await response.text();
    const $ = cheerio.load(html);
    const downloadLink = $('a:contains("Cloud Resume Download")').attr('href');
    return downloadLink || null;
  } catch (error) {
    console.error(`[UHDMovies] Error resolving Resume Cloud: ${error.message}`);
    return null;
  }
}

// Try Resume Cloud
async function tryResumeCloud(html) {
  const patterns = [
    /<a[^>]*href="([^"]*)"[^>]*class="[^"]*btn-warning[^"]*"[^>]*>.*?Resume Cloud.*?<\/a>/i,
    /href="([^"]*zfile[^"]*)"/i,
    /<a[^>]*href="([^"]*)"[^>]*>.*?Resume Cloud.*?<\/a>/i
  ];

  let resumeLink = null;
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match && match[1]) {
      resumeLink = match[1];
      console.log(`[UHDMovies] Found "Resume Cloud" link: ${resumeLink}`);
      break;
    }
  }

  if (!resumeLink) {
    console.log('[UHDMovies] No Resume Cloud link found');
    return null;
  }

  if (resumeLink.includes('workers.dev')) {
    let directLink = resumeLink;
    const urlParts = directLink.split('/');
    const filename = urlParts[urlParts.length - 1];
    const encodedFilename = filename.replace(/ /g, '%20');
    urlParts[urlParts.length - 1] = encodedFilename;
    directLink = urlParts.join('/');
    console.log(`[UHDMovies] Found direct Cloud Resume Download: ${directLink}`);
    return directLink;
  }

  try {
    const resumeUrl = resumeLink.startsWith('http') ? resumeLink : new URL(resumeLink, 'https://driveleech.net').href;
    console.log(`[UHDMovies] Following Resume Cloud: ${resumeUrl}`);

    const finalPageResponse = await makeRequest(resumeUrl);
    const finalPageHtml = await finalPageResponse.text();

    const downloadLinkPatterns = [
      /<a[^>]*class="[^"]*btn-success[^"]*"[^>]*href="([^"]*workers\.dev[^"]*)"[^>]*>/i,
      /<a[^>]*href="([^"]*workers\.dev[^"]*)"[^>]*class="[^"]*btn-success[^"]*"[^>]*>/i,
      /<a[^>]*href="([^"]*driveleech\.net\/d\/[^"]*)"[^>]*>/i,
      /<a[^>]*href="([^"]*)"[^>]*>.*?Download.*?<\/a>/i
    ];

    let finalDownloadLink = null;
    for (const pattern of downloadLinkPatterns) {
      const linkMatch = pattern.exec(finalPageHtml);
      if (linkMatch && linkMatch[1]) {
        finalDownloadLink = linkMatch[1];
        break;
      }
    }

    if (finalDownloadLink) {
      if (finalDownloadLink.includes('workers.dev')) {
        const urlParts = finalDownloadLink.split('/');
        const filename = urlParts[urlParts.length - 1];
        const encodedFilename = filename.replace(/ /g, '%20');
        urlParts[urlParts.length - 1] = encodedFilename;
        finalDownloadLink = urlParts.join('/');
      }
      console.log(`[UHDMovies] Extracted final link: ${finalDownloadLink}`);
      return finalDownloadLink;
    }

    return null;
  } catch (error) {
    console.log(`[UHDMovies] Error processing Resume Cloud: ${error.message}`);
    return null;
  }
}

// Validate video URL
async function validateVideoUrl(url, timeout = 10000) {
  try {
    console.log(`[UHDMovies] Validating: ${url.substring(0, 100)}...`);
    const response = await fetch(url, {
      method: 'HEAD',
      headers: {
        'Range': 'bytes=0-1',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (response.ok || response.status === 206) {
      console.log(`[UHDMovies] ✓ Validation OK (${response.status})`);
      return true;
    }
    console.log(`[UHDMovies] ✗ Validation failed: ${response.status}`);
    return false;
  } catch (error) {
    console.log(`[UHDMovies] ✗ Validation error: ${error.message}`);
    return false;
  }
}

// Get final link from driveleech
async function getFinalLink(driveleechUrl) {
  try {
    console.log(`[UHDMovies] Processing driveleech: ${driveleechUrl}`);

    const response = await makeRequest(driveleechUrl);
    const html = await response.text();

    const jsRedirectRegex = /window\.location\.replace\("([^"]+)"\)/;
    const jsMatch = jsRedirectRegex.exec(html);

    let finalHtml = html;
    if (jsMatch) {
      const newUrl = new URL(jsMatch[1], 'https://driveleech.net/').href;
      const newResponse = await makeRequest(newUrl);
      finalHtml = await newResponse.text();
    }

    let sizeInfo = 'Unknown';
    let fileName = null;

    const sizeRegex = /Size\s*:\s*([0-9.,]+\s*[KMGT]B)/i;
    const sizeMatch = sizeRegex.exec(finalHtml);
    if (sizeMatch) sizeInfo = sizeMatch[1];

    const nameRegex = /Name\s*:\s*([^<\n]+)/i;
    const nameMatch = nameRegex.exec(finalHtml);
    if (nameMatch) fileName = nameMatch[1].trim();

    const downloadMethods = [
      { name: 'Resume Cloud', func: tryResumeCloud },
      { name: 'Instant Download', func: tryInstantDownload }
    ];

    for (const method of downloadMethods) {
      try {
        console.log(`[UHDMovies] Trying ${method.name}...`);
        const finalUrl = await method.func(finalHtml);

        if (finalUrl) {
          const isValid = await validateVideoUrl(finalUrl);
          if (isValid) {
            console.log(`[UHDMovies] ✓ Success via ${method.name}`);
            return { url: finalUrl, size: sizeInfo, fileName: fileName };
          }
        }
      } catch (error) {
        console.log(`[UHDMovies] ✗ ${method.name} failed: ${error.message}`);
      }
    }

    console.log('[UHDMovies] ✗ All methods failed');
    return null;
  } catch (error) {
    console.error(`[UHDMovies] Error in getFinalLink: ${error.message}`);
    return null;
  }
}

// Resolve download link
async function resolveDownloadLink(linkInfo) {
  try {
    console.log(`[UHDMovies] Resolving: ${linkInfo.quality}`);

    let resolvedUrl = null;

    if (linkInfo.url.includes('tech.unblockedgames.world') ||
      linkInfo.url.includes('tech.examzculture.in') ||
      linkInfo.url.includes('tech.examdegree.site') ||
      linkInfo.url.includes('tech.creativeexpressionsblog.com')) {
      resolvedUrl = await resolveSidToDriveleech(linkInfo.url);
    } else if (linkInfo.url.includes('driveleech.net') || linkInfo.url.includes('driveseed.org')) {
      resolvedUrl = linkInfo.url;
    }

    if (!resolvedUrl) {
      console.log(`[UHDMovies] Could not resolve SID for ${linkInfo.quality}`);
      return null;
    }

    if (!resolvedUrl.includes('driveleech.net') && !resolvedUrl.includes('driveseed.org')) {
      console.log(`[UHDMovies] Skipping unsupported: ${resolvedUrl}`);
      return null;
    }

    let finalLinkInfo = null;

    if (resolvedUrl.includes('driveseed.org')) {
      const { downloadOptions, size, fileName } = await resolveDriveseedLink(resolvedUrl);

      if (!downloadOptions || downloadOptions.length === 0) {
        console.log(`[UHDMovies] No options for ${linkInfo.quality}`);
        return null;
      }

      let finalDownloadUrl = null;

      for (const option of downloadOptions) {
        try {
          console.log(`[UHDMovies] Trying ${option.title}...`);

          if (option.type === 'resume') {
            finalDownloadUrl = await resolveResumeCloudLink(option.url);
          } else if (option.type === 'instant') {
            try {
              const instantResponse = await makeRequest(option.url);
              const instantHtml = await instantResponse.text();
              finalDownloadUrl = await tryInstantDownload(instantHtml);
            } catch (error) {
              console.log(`[UHDMovies] Instant error: ${error.message}`);
            }
          }

          if (finalDownloadUrl) {
            const isValid = await validateVideoUrl(finalDownloadUrl);
            if (isValid) {
              console.log(`[UHDMovies] ✓ Success: ${option.title}`);
              break;
            } else {
              finalDownloadUrl = null;
            }
          }
        } catch (error) {
          console.log(`[UHDMovies] ✗ ${option.title}: ${error.message}`);
        }
      }

      if (finalDownloadUrl) {
        finalLinkInfo = {
          url: finalDownloadUrl,
          size: size || linkInfo.size,
          fileName: fileName
        };
      }
    } else {
      finalLinkInfo = await getFinalLink(resolvedUrl);
    }

    if (!finalLinkInfo) {
      console.log(`[UHDMovies] No final link for ${linkInfo.quality}`);
      return null;
    }

    const fileName = finalLinkInfo.fileName || linkInfo.quality;
    const cleanFileName = fileName.replace(/\.[^/.]+$/, "").replace(/[._]/g, ' ');

    return {
      name: `UHD Movies`,
      title: `${cleanFileName}\n${finalLinkInfo.size}`,
      url: finalLinkInfo.url,
      quality: linkInfo.quality,
      size: finalLinkInfo.size,
      fileName: finalLinkInfo.fileName,
      type: 'direct'
    };

  } catch (error) {
    console.error(`[UHDMovies] Failed to resolve: ${error.message}`);
    return null;
  }
}

// Extract TV show links
async function extractTvShowDownloadLinks(showPageUrl, targetSeason, targetEpisode) {
  try {
    console.log(`[UHDMovies] TV: ${showPageUrl} S${targetSeason}E${targetEpisode}`);

    const response = await makeRequest(showPageUrl);
    const html = await response.text();

    const links = [];
    const $ = cheerio.load(html);

    let inTargetSeason = false;
    let qualityText = '';

    $('.entry-content').find('*').each((index, element) => {
      const $el = $(element);
      const text = $el.text().trim();
      const seasonMatch = text.match(/^SEASON\s+(\d+)/i);

      if (seasonMatch) {
        const currentSeasonNum = parseInt(seasonMatch[1], 10);
        if (currentSeasonNum == targetSeason) {
          inTargetSeason = true;
        } else if (inTargetSeason) {
          inTargetSeason = false;
          return false;
        }
      }

      if (inTargetSeason) {
        const isQualityHeader = $el.is('pre, p:has(strong), p:has(b), h3, h4');
        if (isQualityHeader) {
          const headerText = $el.text().trim();
          if (headerText.length > 5 && !/plot|download|screenshot|trailer|join|powered by|season/i.test(headerText) && !($el.find('a').length > 0)) {
            qualityText = headerText;
          }
        }

        if ($el.is('p') && $el.find('a[href*="tech.unblockedgames.world"], a[href*="tech.examzculture.in"], a[href*="tech.examdegree.site"]').length > 0) {
          const linksParagraph = $el;
          const episodeRegex = new RegExp(`^Episode\\s+0*${targetEpisode}(?!\\d)`, 'i');
          const targetEpisodeLink = linksParagraph.find('a').filter((i, el) => {
            return episodeRegex.test($(el).text().trim());
          }).first();

          if (targetEpisodeLink.length > 0) {
            const link = targetEpisodeLink.attr('href');
            if (link && !links.some(item => item.url === link)) {
              const sizeMatch = qualityText.match(/\[\s*([0-9.,]+\s*[KMGT]B)/i);
              const size = sizeMatch ? sizeMatch[1] : 'Unknown';
              const cleanQuality = extractCleanQuality(qualityText);
              const rawQuality = qualityText.replace(/(\r\n|\n|\r)/gm, " ").replace(/\s+/g, ' ').trim();

              links.push({ url: link, quality: cleanQuality, size, rawQuality });
            }
          }
        }
      }
    });

    if (links.length === 0) {
      console.log('[UHDMovies] Trying fallback TV extraction...');
      $('.entry-content').find('a[href*="tech.unblockedgames.world"], a[href*="tech.examzculture.in"], a[href*="tech.examdegree.site"]').each((i, el) => {
        const linkElement = $(el);
        const episodeRegex = new RegExp(`^Episode\\s+0*${targetEpisode}(?!\\d)`, 'i');

        if (episodeRegex.test(linkElement.text().trim())) {
          const link = linkElement.attr('href');
          if (link && !links.some(item => item.url === link)) {
            let qualityText = 'Unknown Quality';
            const parentP = linkElement.closest('p, div');

            let foundSeasonMatch = false;
            let currentElement = parentP;
            for (let j = 0; j < 10; j++) {
              currentElement = currentElement.prev();
              if (currentElement.length === 0) break;

              const prevText = currentElement.text().trim();
              if (prevText && prevText.length > 5) {
                const seasonRegex = new RegExp(`S0?${targetSeason}(?![0-9])`, 'i');
                const seasonWordRegex = new RegExp(`Season\\s+0*${targetSeason}(?![0-9])`, 'i');

                if (seasonRegex.test(prevText) || seasonWordRegex.test(prevText)) {
                  qualityText = prevText;
                  foundSeasonMatch = true;
                  break;
                }

                const otherSeasonRegex = /S0?(\d+)(?![0-9])|Season\s+(\d+)(?![0-9])/i;
                const otherSeasonMatch = otherSeasonRegex.exec(prevText);
                if (otherSeasonMatch) {
                  const foundSeason = parseInt(otherSeasonMatch[1] || otherSeasonMatch[2]);
                  if (foundSeason !== targetSeason) return;
                }
              }
            }

            if (foundSeasonMatch || qualityText === 'Unknown Quality') {
              if (qualityText === 'Unknown Quality') {
                const prevElement = parentP.prev();
                if (prevElement.length > 0) {
                  const prevText = prevElement.text().trim();
                  if (prevText && prevText.length > 5 && !prevText.toLowerCase().includes('download')) {
                    qualityText = prevText;
                  }
                }
              }

              const sizeMatch = qualityText.match(/\[([0-9.,]+[KMGT]B[^\]]*)\]/i);
              const size = sizeMatch ? sizeMatch[1] : 'Unknown';
              const cleanQuality = extractCleanQuality(qualityText);
              const rawQuality = qualityText.replace(/(\r\n|\n|\r)/gm, " ").replace(/\s+/g, ' ').trim();

              links.push({ url: link, quality: cleanQuality, size, rawQuality });
            }
          }
        }
      });
    }

    console.log(`[UHDMovies] Found ${links.length} episode links`);
    return links;
  } catch (error) {
    console.error(`[UHDMovies] TV extraction failed: ${error.message}`);
    return [];
  }
}

// Main function
async function getStreams(tmdbId, mediaType = 'movie', season = null, episode = null) {
  console.log(`[UHDMovies] Fetching: TMDB=${tmdbId}, Type=${mediaType}${mediaType === 'tv' ? `, S${season}E${episode}` : ''}`);

  try {
    const tmdbUrl = `https://api.themoviedb.org/3/${mediaType === 'tv' ? 'tv' : 'movie'}/${tmdbId}?api_key=${TMDB_API_KEY}`;
    const tmdbResponse = await makeRequest(tmdbUrl);
    const tmdbData = await tmdbResponse.json();

    const mediaInfo = {
      title: mediaType === 'tv' ? tmdbData.name : tmdbData.title,
      year: parseInt(((mediaType === 'tv' ? tmdbData.first_air_date : tmdbData.release_date) || '').split('-')[0], 10)
    };

    if (!mediaInfo.title) {
      throw new Error('No title from TMDB');
    }

    console.log(`[UHDMovies] TMDB: "${mediaInfo.title}" (${mediaInfo.year || 'N/A'})`);

    let searchTitle = mediaInfo.title.replace(/:/g, '').replace(/\s*&\s*/g, ' and ');
    let searchResults = await searchMovies(searchTitle);

    if (searchResults.length === 0 || !searchResults.some(result => compareMedia(mediaInfo, result))) {
      console.log(`[UHDMovies] Primary search failed, trying fallback...`);
      const fallbackTitle = mediaInfo.title.split(':')[0].trim();
      if (fallbackTitle !== searchTitle) {
        searchResults = await searchMovies(fallbackTitle);
      }
    }

    if (searchResults.length === 0) {
      console.log(`[UHDMovies] No search results`);
      return [];
    }

    const bestMatch = searchResults.find(result => compareMedia(mediaInfo, result)) || searchResults[0];
    console.log(`[UHDMovies] Using: "${bestMatch.title}" (${bestMatch.year})`);

    let downloadLinks = [];
    if (mediaType === 'tv' && season && episode) {
      downloadLinks = await extractTvShowDownloadLinks(bestMatch.url, season, episode);
    } else {
      downloadLinks = await extractDownloadLinks(bestMatch.url);
    }

    if (downloadLinks.length === 0) {
      console.log(`[UHDMovies] No download links`);
      return [];
    }

    const streamPromises = downloadLinks.map(link => resolveDownloadLink(link));
    const streams = (await Promise.all(streamPromises)).filter(Boolean);

    streams.sort((a, b) => {
      const sizeA = parseSize(a.size);
      const sizeB = parseSize(b.size);
      return sizeB - sizeA;
    });

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
