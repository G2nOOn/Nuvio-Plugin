// UHD Movies Scraper
const cheerio = require('cheerio-without-node-native');

const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const BASE_DOMAIN = 'https://uhdmovies.my';

const SID_HOSTS = ['tech.unblockedgames.world', 'tech.examzculture.in', 'tech.examdegree.site'];
const HUB_HOSTS = ['hubcloud.ist', 'hubcloud.cx', 'hubcloud.foo', 'hubcloud.lol'];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function hasPattern(url, patterns) {
  if (!url) return false;
  for (var i = 0; i < patterns.length; i++) {
    if (url.indexOf(patterns[i]) >= 0) return true;
  }
  return false;
}

function makeRequest(url, options) {
  options = options || {};
  var headers = {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5'
  };
  if (options.headers) {
    for (var k in options.headers) headers[k] = options.headers[k];
  }
  return fetch(url, { method: options.method || 'GET', headers: headers, body: options.body });
}

function cleanQuality(raw) {
  if (!raw) return 'Unknown';
  var text = String(raw).toLowerCase();
  var parts = [];
  if (text.indexOf('2160') >= 0 || text.indexOf('4k') >= 0) parts.push('4K');
  else if (text.indexOf('1080') >= 0) parts.push('1080p');
  else if (text.indexOf('720') >= 0) parts.push('720p');
  else if (text.indexOf('480') >= 0) parts.push('480p');
  if (text.indexOf('hdr') >= 0) parts.push('HDR');
  if (text.indexOf('dolby vision') >= 0 || text.indexOf('dovi') >= 0) parts.push('DV');
  if (text.indexOf('hevc') >= 0 || text.indexOf('x265') >= 0) parts.push('HEVC');
  if (text.indexOf('web-dl') >= 0) parts.push('WEB-DL');
  if (parts.length === 0) parts.push('Unknown');
  return parts.join(' | ');
}

function parseSize(text) {
  if (!text) return 0;
  var m = String(text).match(/([0-9.]+)\s*(GB|MB|TB)/i);
  if (!m) return 0;
  var v = parseFloat(m[1]);
  var u = m[2].toUpperCase();
  if (u === 'TB') return v * 1024 * 1024 * 1024 * 1024;
  if (u === 'GB') return v * 1024 * 1024 * 1024;
  if (u === 'MB') return v * 1024 * 1024;
  return v;
}

async function searchMovies(query) {
  try {
    var url = BASE_DOMAIN + '/search/' + encodeURIComponent(query);
    console.log('[UHDMovies] Search: ' + url);
    var resp = await makeRequest(url);
    var html = await resp.text();
    console.log('[UHDMovies] Search HTML length: ' + html.length);

    var $ = cheerio.load(html);
    var results = [];

    $('article.gridlove-post').each(function(i, el) {
      var $el = $(el);
      var $a = $el.find('a[href*="/download-"]').first();
      var href = $a.attr('href');
      var title = $a.attr('title') || $el.find('h1').text().trim();
      if (!href || !title) return;
      var full = href.indexOf('http') === 0 ? href : BASE_DOMAIN + href;
      results.push({ title: title, url: full });
    });

    if (results.length === 0) {
      $('a[href*="/download-"]').each(function(i, el) {
        var href = $(el).attr('href');
        var title = $(el).text().trim();
        if (!href || !title) return;
        var full = href.indexOf('http') === 0 ? href : BASE_DOMAIN + href;
        results.push({ title: title, url: full });
      });
    }

    console.log('[UHDMovies] Found ' + results.length + ' results');
    return results;
  } catch (e) {
    console.log('[UHDMovies] Search error: ' + e.message);
    return [];
  }
}

async function extractTvLinks(pageUrl, season, episode) {
  try {
    console.log('[UHDMovies] Extract TV: ' + pageUrl);
    var resp = await makeRequest(pageUrl);
    var html = await resp.text();
    console.log('[UHDMovies] Page HTML: ' + html.length);

    var $ = cheerio.load(html);
    var links = [];
    var currentQuality = '';
    var inSeason = false;
    var sLabel = 'SEASON ' + season;
    var epPattern = 'Episode ' + episode;

    $('.entry-content').find('*').each(function(i, el) {
      var $el = $(el);
      var txt = $el.text().trim();

      if (/^SEASON\s+\d+/i.test(txt)) {
        if (txt.toUpperCase().indexOf(sLabel) === 0) {
          inSeason = true;
        } else if (inSeason) {
          inSeason = false;
          return false;
        }
      }

      if (!inSeason) return;

      if ($el.is('p, h3, h4, pre, div') && !$el.find('a').length) {
        if (txt.length > 10 && txt.length < 400) {
          if (/1080p|720p|2160p|4k|480p|hevc|x264|x265|web-dl/i.test(txt)) {
            currentQuality = txt;
          }
        }
      }

      $el.find('a[href]').each(function(j, a) {
        var href = $(a).attr('href');
        var atxt = $(a).text().trim();
        if (!href || !atxt) return;
        if (!hasPattern(href, SID_HOSTS) && !hasPattern(href, HUB_HOSTS)) return;
        if (atxt.toLowerCase().indexOf(epPattern.toLowerCase()) < 0) return;

        if (links.some(function(l) { return l.url === href; })) return;

        links.push({
          url: href,
          quality: cleanQuality(currentQuality),
          rawQuality: currentQuality,
          size: 'Unknown'
        });
        console.log('[UHDMovies] Found link: ' + href.substring(0, 80));
      });
    });

    console.log('[UHDMovies] Total links: ' + links.length);
    return links;
  } catch (e) {
    console.log('[UHDMovies] Extract error: ' + e.message);
    return [];
  }
}

async function resolveHubCloud(url) {
  console.log('[UHDMovies] HubCloud: ' + url);
  try {
    var resp = await makeRequest(url, { headers: { 'Referer': BASE_DOMAIN + '/' } });
    var html = await resp.text();
    console.log('[UHDMovies] HubCloud HTML: ' + html.length);
    console.log('[UHDMovies] HTML sample: ' + html.substring(0, 500).replace(/\s+/g, ' '));

    var $ = cheerio.load(html);
    var found = null;
    var base = url.split('/').slice(0, 3).join('/');

    $('a[href]').each(function(i, el) {
      if (found) return;
      var href = $(el).attr('href');
      var text = $(el).text().trim().toLowerCase();
      if (!href) return;

      if (/r2\.cloudflarestorage\.com|pixeldrain\.dev|workers\.dev|\.mkv|\.mp4/i.test(href)) {
        found = href;
        return;
      }

      if (/r2|10gbps|pixel|download|instant|direct/i.test(text) && !/donate|support/i.test(text)) {
        var abs = href.indexOf('http') === 0 ? href : base + (href.charAt(0) === '/' ? '' : '/') + href;
        found = abs;
        return;
      }
    });

    if (!found) {
      var m = html.match(/["'](https?:\/\/[^"'\s]*(?:r2\.cloudflarestorage\.com|workers\.dev|pixeldrain\.dev)[^"'\s]*)["']/i);
      if (m) found = m[1];
    }

    if (!found) {
      console.log('[UHDMovies] No link found in HubCloud page');
      return null;
    }

    if (/\.mkv|\.mp4|r2\.cloudflarestorage|pixeldrain/i.test(found)) {
      console.log('[UHDMovies] Direct URL: ' + found.substring(0, 100));
      return found;
    }

    console.log('[UHDMovies] Following: ' + found.substring(0, 100));
    var resp2 = await makeRequest(found, { headers: { 'Referer': url } });
    var html2 = await resp2.text();
    var m2 = html2.match(/<meta[^>]*refresh[^>]*url=([^"'\s>]+)/i);
    if (m2) return m2[1];
    var m3 = html2.match(/["'](https?:\/\/[^"'\s]*?\.(?:mkv|mp4)[^"'\s]*)["']/i);
    if (m3) return m3[1];
    var m4 = html2.match(/["'](https?:\/\/[^"'\s]*(?:r2\.cloudflarestorage\.com|workers\.dev|pixeldrain)[^"'\s]*)["']/i);
    if (m4) return m4[1];

    return null;
  } catch (e) {
    console.log('[UHDMovies] HubCloud error: ' + e.message);
    return null;
  }
}

async function getStreams(tmdbId, mediaType, season, episode) {
  mediaType = mediaType || 'movie';
  console.log('[UHDMovies] Start tmdb=' + tmdbId + ' type=' + mediaType + ' s=' + season + ' e=' + episode);

  try {
    var tmdbUrl = 'https://api.themoviedb.org/3/' + (mediaType === 'tv' ? 'tv' : 'movie') + '/' + tmdbId + '?api_key=' + TMDB_API_KEY;
    var tmdbResp = await makeRequest(tmdbUrl);
    var data = await tmdbResp.json();
    var title = mediaType === 'tv' ? data.name : data.title;
    if (!title) return [];

    console.log('[UHDMovies] Title: ' + title);

    var searchResults = await searchMovies(title);
    if (searchResults.length === 0) {
      var short = title.split(':')[0].trim();
      if (short !== title) searchResults = await searchMovies(short);
    }

    if (searchResults.length === 0) return [];

    var best = searchResults[0];
    var links = [];

    if (mediaType === 'tv' && season && episode) {
      links = await extractTvLinks(best.url, season, episode);
    }

    console.log('[UHDMovies] Links to resolve: ' + links.length);
    if (links.length === 0) return [];

    var streams = [];
    for (var i = 0; i < links.length; i++) {
      var l = links[i];
      if (hasPattern(l.url, HUB_HOSTS)) {
        var finalUrl = await resolveHubCloud(l.url);
        if (finalUrl) {
          streams.push({
            name: 'UHD Movies',
            title: l.quality + '\n' + (l.size || 'Unknown'),
            url: finalUrl,
            quality: l.quality,
            size: l.size
          });
        }
      }
    }

    console.log('[UHDMovies] Returning ' + streams.length + ' streams');
    return streams;
  } catch (e) {
    console.log('[UHDMovies] Error: ' + e.message);
    return [];
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
