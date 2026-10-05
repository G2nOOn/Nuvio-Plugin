// UHD Movies Scraper - Final
const cheerio = require('cheerio-without-node-native');

const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const BASE_DOMAIN = 'https://uhdmovies.my';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const SID_HOSTS = [
  'thenaukriadda',
  'tech.unblockedgames.world',
  'tech.examzculture.in',
  'tech.examdegree.site',
  'tech.creativeexpressionsblog.com'
];
const HUB_HOSTS = ['hubcloud.ist', 'hubcloud.cx', 'hubcloud.foo', 'hubcloud.lol'];
const DRIVE_HOSTS = ['driveseed.org', 'driveleech.net'];

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
  var req = {
    method: options.method || 'GET',
    headers: headers,
    redirect: 'follow'
  };
  if (options.body) req.body = options.body;
  return fetch(url, req);
}

function cleanQuality(raw) {
  if (!raw) return 'Unknown';
  var t = String(raw).toLowerCase();
  var p = [];
  if (t.indexOf('2160') >= 0 || t.indexOf('4k') >= 0) p.push('4K');
  else if (t.indexOf('1080') >= 0) p.push('1080p');
  else if (t.indexOf('720') >= 0) p.push('720p');
  else if (t.indexOf('480') >= 0) p.push('480p');
  if (t.indexOf('hdr') >= 0) p.push('HDR');
  if (t.indexOf('hevc') >= 0 || t.indexOf('x265') >= 0) p.push('HEVC');
  if (p.length === 0) p.push('Unknown');
  return p.join(' | ');
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
    var resp = await makeRequest(url);
    var html = await resp.text();
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
    return results;
  } catch (e) {
    return [];
  }
}

async function extractTvLinks(pageUrl, season, episode) {
  try {
    var resp = await makeRequest(pageUrl);
    var html = await resp.text();
    var $ = cheerio.load(html);
    var links = [];
    var qualityText = '';

    // Find season-quality header
    $('h2, h3, h4, p, pre, div').each(function(i, el) {
      var t = $(el).text().trim();
      if (t.length > 20 && t.length < 500 && /1080p|720p|2160p|4k/i.test(t) && !$(el).find('a').length) {
        qualityText = t;
      }
    });

    // Find episode button
    $('a[href]').each(function(i, el) {
      var href = $(el).attr('href');
      var text = $(el).text().trim().toLowerCase();
      if (!href) return;
      if (!hasPattern(href, SID_HOSTS) && !hasPattern(href, HUB_HOSTS)) return;

      var m = text.match(/episode\s*0*(\d+)/i);
      if (!m) return;
      if (parseInt(m[1], 10) !== parseInt(episode, 10)) return;

      if (links.some(function(l) { return l.url === href; })) return;

      var sizeMatch = qualityText.match(/\[([0-9.,]+\s*[KMGT]B)/i);
      var size = sizeMatch ? sizeMatch[1].replace(/[\[\]]/g, '').trim() : 'Unknown';

      links.push({
        url: href,
        quality: cleanQuality(qualityText),
        rawQuality: qualityText,
        size: size
      });
    });

    return links;
  } catch (e) {
    return [];
  }
}

// Auto-form-submit SID resolver
async function resolveSid(sidUrl) {
  try {
    var currentUrl = sidUrl;
    var referer = BASE_DOMAIN + '/';

    for (var step = 0; step < 5; step++) {
      var resp = await makeRequest(currentUrl, { headers: { 'Referer': referer } });
      var html = await resp.text();

      // Check if we already got driveleech/driveseed
      var driveMatch = html.match(/https?:\/\/[^"'\s<>]*drive(?:leech|seed)\.(?:net|org)[^"'\s<>]*/i);
      if (driveMatch) {
        return driveMatch[0];
      }

      // Look for hubcloud
      var hubMatch = html.match(/https?:\/\/[^"'\s<>]*hubcloud[^"'\s<>]*/i);
      if (hubMatch) return hubMatch[0];

      // Parse forms
      var $ = cheerio.load(html);
      var form = $('form').first();
      if (form.length === 0) {
        // No form - check for meta refresh or JS redirect
        var meta = html.match(/http-equiv=["']refresh["'][^>]*content=["'][^"']*url=([^"'\s<>"']+)/i);
        if (meta) {
          var nextUrl = meta[1].indexOf('http') === 0 ? meta[1] : new URL(meta[1], currentUrl).href;
          referer = currentUrl;
          currentUrl = nextUrl;
          continue;
        }
        break;
      }

      var action = form.attr('action');
      if (!action) break;
      var actionUrl = action.indexOf('http') === 0 ? action : new URL(action, currentUrl).href;

      // Collect form data
      var formData = {};
      form.find('input').each(function(i, inp) {
        var name = $(inp).attr('name');
        var value = $(inp).attr('value') || '';
        var type = $(inp).attr('type');
        if (name && type !== 'submit' && type !== 'button') {
          formData[name] = value;
        }
      });

      var body = '';
      for (var k in formData) {
        if (body) body += '&';
        body += encodeURIComponent(k) + '=' + encodeURIComponent(formData[k]);
      }

      // POST
      var postResp = await fetch(actionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': currentUrl,
          'User-Agent': UA,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Origin': new URL(currentUrl).origin
        },
        body: body,
        redirect: 'follow'
      });
      var postHtml = await postResp.text();

      // Check response
      var driveMatch2 = postHtml.match(/https?:\/\/[^"'\s<>]*drive(?:leech|seed)\.(?:net|org)[^"'\s<>]*/i);
      if (driveMatch2) return driveMatch2[0];

      var hubMatch2 = postHtml.match(/https?:\/\/[^"'\s<>]*hubcloud[^"'\s<>]*/i);
      if (hubMatch2) return hubMatch2[0];

      // Check if POST returned a new URL to follow
      var postUrl = postResp.url;
      if (postUrl && postUrl !== currentUrl && postUrl !== actionUrl) {
        referer = currentUrl;
        currentUrl = postUrl;
        continue;
      }

      // Check for redirect in HTML
      var meta2 = postHtml.match(/http-equiv=["']refresh["'][^>]*content=["'][^"']*url=([^"'\s<>"']+)/i);
      if (meta2) {
        referer = actionUrl;
        currentUrl = meta2[1].indexOf('http') === 0 ? meta2[1] : new URL(meta2[1], actionUrl).href;
        continue;
      }

      // Check for JS redirect
      var js = postHtml.match(/(?:window\.location(?:\.href)?|location\.replace\s*\()\s*=?\s*["']([^"']+)["']/i);
      if (js) {
        referer = actionUrl;
        currentUrl = js[1].indexOf('http') === 0 ? js[1] : new URL(js[1], actionUrl).href;
        continue;
      }

      // Nothing found
      break;
    }

    return null;
  } catch (e) {
    return null;
  }
}

async function resolveDriveSeed(url, depth) {
  depth = depth || 0;
  if (depth > 2) return null;

  try {
    var resp = await makeRequest(url, { headers: { 'Referer': 'https://links.modpro.blog/' } });
    var html = await resp.text();
    var base = url.split('/').slice(0, 3).join('/');

    // JS redirect
    var jsMatch = html.match(/window\.location\.replace\("([^"]+)"\)/);
    if (jsMatch && depth < 2) {
      var nextUrl = jsMatch[1].indexOf('http') === 0 ? jsMatch[1] : base + jsMatch[1];
      return await resolveDriveSeed(nextUrl, depth + 1);
    }

    // Look for final download links
    var patterns = [
      /https?:\/\/[^"'\s<>]*?r2\.cloudflarestorage\.com[^"'\s<>]*/i,
      /https?:\/\/[^"'\s<>]*?workers\.dev[^"'\s<>]*/i
    ];
    for (var i = 0; i < patterns.length; i++) {
      var m = html.match(patterns[i]);
      if (m) return m[0].replace(/["'\\]+$/, '');
    }

    // Look for buttons
    var $ = cheerio.load(html);
    var finalUrl = null;
    $('a[href]').each(function(i, el) {
      var href = $(el).attr('href');
      var text = $(el).text().trim().toLowerCase();
      if (!href) return;
      if (/instant|resume cloud|cloud resume|download/i.test(text)) {
        var abs = href.indexOf('http') === 0 ? href : base + (href.charAt(0) === '/' ? '' : '/') + href;
        if (!finalUrl) finalUrl = abs;
      }
    });
    return finalUrl;
  } catch (e) {
    return null;
  }
}

async function resolveHubCloud(url, depth) {
  depth = depth || 0;
  if (depth > 3) return null;

  try {
    var resp = await makeRequest(url, { headers: { 'Referer': BASE_DOMAIN + '/' } });
    var html = await resp.text();
    var base = url.split('/').slice(0, 3).join('/');

    var patterns = [
      /https?:\/\/[^"'\s<>]*?r2\.cloudflarestorage\.com[^"'\s<>]*/gi,
      /https?:\/\/[^"'\s<>]*?workers\.dev[^"'\s<>]*/gi,
      /https?:\/\/[^"'\s<>]*?pixeldrain\.dev\/api\/file[^"'\s<>]*/gi
    ];
    for (var i = 0; i < patterns.length; i++) {
      var m = html.match(patterns[i]);
      if (m) {
        for (var j = 0; j < m.length; j++) {
          var clean = m[j].replace(/["'\\]+$/, '');
          if (clean !== url && clean.length > 20) return clean;
        }
      }
    }

    var $ = cheerio.load(html);
    var candidates = [];
    $('a[href]').each(function(i, el) {
      var href = $(el).attr('href');
      var text = $(el).text().trim();
      if (!href || href === url || href === '#' || href === '/') return;
      if (/donate|support|telegram|share|report|dmca|discord/i.test(text + href)) return;
      candidates.push({ href: href, text: text });
    });

    var scored = candidates.map(function(c) {
      var score = 0;
      if (/r2|10gbps|pixel/i.test(c.text)) score += 100;
      if (/download|instant|direct/i.test(c.text)) score += 50;
      if (/\.(mkv|mp4)/i.test(c.href)) score += 30;
      if (/gpdl|pixel\./i.test(c.href)) score += 200;
      return { c: c, score: score };
    }).sort(function(a, b) { return b.score - a.score; });

    for (var k = 0; k < scored.length; k++) {
      var cand = scored[k].c;
      var absHref = cand.href.indexOf('http') === 0 ? cand.href : base + (cand.href.charAt(0) === '/' ? '' : '/') + cand.href;
      if (/\.(mkv|mp4)(\?|$)/i.test(absHref)) return absHref;
      if (/r2\.cloudflarestorage|workers\.dev|pixeldrain|gpdl\.|pixel\./i.test(absHref)) return absHref;
      if (depth < 2) {
        var sub = await resolveHubCloud(absHref, depth + 1);
        if (sub) return sub;
      }
    }

    return null;
  } catch (e) {
    return null;
  }
}

async function getStreams(tmdbId, mediaType, season, episode) {
  mediaType = mediaType || 'movie';
  try {
    var tmdbUrl = 'https://api.themoviedb.org/3/' + (mediaType === 'tv' ? 'tv' : 'movie') + '/' + tmdbId + '?api_key=' + TMDB_API_KEY;
    var tmdbResp = await makeRequest(tmdbUrl);
    var data = await tmdbResp.json();
    var title = mediaType === 'tv' ? data.name : data.title;
    if (!title) return [];

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

    if (links.length === 0) return [];

    var streams = [];
    for (var i = 0; i < links.length; i++) {
      var l = links[i];
      var finalUrl = null;

      if (hasPattern(l.url, HUB_HOSTS)) {
        finalUrl = await resolveHubCloud(l.url, 0);
      } else if (hasPattern(l.url, SID_HOSTS)) {
        var resolved = await resolveSid(l.url);
        if (resolved) {
          if (hasPattern(resolved, HUB_HOSTS)) {
            finalUrl = await resolveHubCloud(resolved, 0);
          } else if (hasPattern(resolved, DRIVE_HOSTS)) {
            finalUrl = await resolveDriveSeed(resolved, 0);
          } else if (/\.(mkv|mp4)/i.test(resolved)) {
            finalUrl = resolved;
          }
        }
      }

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

    return streams;
  } catch (e) {
    return [];
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
