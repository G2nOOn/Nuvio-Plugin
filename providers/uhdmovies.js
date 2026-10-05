const cheerio = require('cheerio-without-node-native');

const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const BASE_DOMAIN = 'https://uhdmovies.my';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const SID_HOSTS = ['thenaukriadda', 'tech.unblockedgames.world', 'tech.examzculture.in', 'tech.examdegree.site'];
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
  var req = { method: options.method || 'GET', headers: headers, redirect: 'follow' };
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

    $('h2, h3, h4, p, pre').each(function(i, el) {
      var t = $(el).text().trim();
      if (t.length > 20 && t.length < 500 && /1080p|720p|2160p|4k/i.test(t) && !$(el).find('a').length) {
        qualityText = t;
      }
    });

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

// NEW: Multi-step SID resolver - follows chain until driveseed/hubcloud/file
async function resolveSid(sidUrl) {
  try {
    var currentUrl = sidUrl;
    var referer = BASE_DOMAIN + '/';

    for (var step = 0; step < 10; step++) {
      console.log('[SID] Step ' + step + ' URL: ' + currentUrl.substring(0, 120));

      var resp = await makeRequest(currentUrl, { headers: { 'Referer': referer } });
      var html = await resp.text();
      console.log('[SID] HTML length: ' + html.length);

      // 1. Check if we hit driveseed / driveleech
      var driveMatch = html.match(/https?:\/\/[^"'\s<>]*drive(?:leech|seed)\.(?:net|org)[^"'\s<>]*/i);
      if (driveMatch) {
        console.log('[SID] Got driveseed: ' + driveMatch[0].substring(0, 100));
        return driveMatch[0];
      }

      // 2. Check for hubcloud
      var hubMatch = html.match(/https?:\/\/[^"'\s<>]*hubcloud[^"'\s<>]*/i);
      if (hubMatch) {
        console.log('[SID] Got hubcloud: ' + hubMatch[0].substring(0, 100));
        return hubMatch[0];
      }

      // 3. Check for direct file
      var fileMatch = html.match(/https?:\/\/[^"'\s<>]*\.(?:mkv|mp4)[^"'\s<>]*/i);
      if (fileMatch) {
        console.log('[SID] Got file: ' + fileMatch[0].substring(0, 100));
        return fileMatch[0];
      }

      // 4. Look for meta refresh
      var metaMatch = html.match(/http-equiv=["']refresh["'][^>]*content=["'][^"']*url=([^"'\s<>"']+)/i);
      if (metaMatch) {
        var nextUrl = metaMatch[1].indexOf('http') === 0 ? metaMatch[1] : new URL(metaMatch[1], currentUrl).href;
        console.log('[SID] Meta refresh -> ' + nextUrl.substring(0, 120));
        referer = currentUrl;
        currentUrl = nextUrl;
        continue;
      }

      // 5. Look for form to submit
      var $ = cheerio.load(html);
      var form = $('form').first();
      if (form.length > 0) {
        var action = form.attr('action');
        var method = (form.attr('method') || 'GET').toUpperCase();

        if (action) {
          var actionUrl = action.indexOf('http') === 0 ? action : new URL(action, currentUrl).href;
          var formData = {};
          form.find('input, button').each(function(i, inp) {
            var name = $(inp).attr('name');
            var value = $(inp).attr('value') || '';
            var type = ($(inp).attr('type') || '').toLowerCase();
            if (name && type !== 'submit' && type !== 'button') {
              formData[name] = value;
            }
          });

          if (method === 'POST') {
            var body = '';
            for (var k in formData) {
              if (body) body += '&';
              body += encodeURIComponent(k) + '=' + encodeURIComponent(formData[k]);
            }
            console.log('[SID] POST form -> ' + actionUrl.substring(0, 120));
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
            console.log('[SID] POST response: ' + postResp.status + ' len: ' + postHtml.length);

            // Check post response
            var driveM = postHtml.match(/https?:\/\/[^"'\s<>]*drive(?:leech|seed)\.(?:net|org)[^"'\s<>]*/i);
            if (driveM) return driveM[0];

            var hubM = postHtml.match(/https?:\/\/[^"'\s<>]*hubcloud[^"'\s<>]*/i);
            if (hubM) return hubM[0];

            var fileM = postHtml.match(/https?:\/\/[^"'\s<>]*\.(?:mkv|mp4)[^"'\s<>]*/i);
            if (fileM) return fileM[0];

            // Look for meta refresh in post response
            var metaM = postHtml.match(/http-equiv=["']refresh["'][^>]*content=["'][^"']*url=([^"'\s<>"']+)/i);
            if (metaM) {
              referer = postResp.url || currentUrl;
              currentUrl = metaM[1].indexOf('http') === 0 ? metaM[1] : new URL(metaM[1], postResp.url).href;
              continue;
            }

            // Look for JS redirect in post response
            var jsM = postHtml.match(/(?:window\.location(?:\.href)?|location\.replace\s*\()\s*=?\s*["']([^"']+)["']/i);
            if (jsM) {
              referer = postResp.url || currentUrl;
              currentUrl = jsM[1].indexOf('http') === 0 ? jsM[1] : new URL(jsM[1], postResp.url).href;
              continue;
            }

            // Look for a "Continue"/"Generate"/"Go" link in post response
            var $post = cheerio.load(postHtml);
            var nextLink = null;
            $post('a[href]').each(function(i, el) {
              var text = $post(el).text().trim().toLowerCase();
              var href = $post(el).attr('href');
              if (!href || href === '#' || href === '/') return;
              if (/continue|generate|go to|next|click here/i.test(text)) {
                if (!nextLink) {
                  nextLink = href.indexOf('http') === 0 ? href : new URL(href, postResp.url).href;
                }
              }
            });

            if (nextLink) {
              console.log('[SID] Follow continue: ' + nextLink.substring(0, 120));
              referer = postResp.url || currentUrl;
              currentUrl = nextLink;
              continue;
            }

            console.log('[SID] POST response not helpful, stopping');
            return null;
          } else {
            // GET form
            var query = '';
            for (var k2 in formData) {
              if (query) query += '&';
              query += encodeURIComponent(k2) + '=' + encodeURIComponent(formData[k2]);
            }
            var nextUrl2 = query ? actionUrl + (actionUrl.indexOf('?') >= 0 ? '&' : '?') + query : actionUrl;
            console.log('[SID] GET form -> ' + nextUrl2.substring(0, 120));
            referer = currentUrl;
            currentUrl = nextUrl2;
            continue;
          }
        }
      }

      // 6. Look for "Continue"/"Generate" link in current HTML
      var $html = cheerio.load(html);
      var continueLink = null;
      $html('a[href]').each(function(i, el) {
        var text = $html(el).text().trim().toLowerCase();
        var href = $html(el).attr('href');
        if (!href || href === '#' || href === '/') return;
        if (/continue|generate|go to|next|click here/i.test(text)) {
          if (!continueLink) {
            continueLink = href.indexOf('http') === 0 ? href : new URL(href, currentUrl).href;
          }
        }
      });

      if (continueLink) {
        console.log('[SID] Follow link: ' + continueLink.substring(0, 120));
        referer = currentUrl;
        currentUrl = continueLink;
        continue;
      }

      // 7. Look for JS redirect in current HTML
      var jsM2 = html.match(/(?:window\.location(?:\.href)?|location\.replace\s*\()\s*=?\s*["']([^"']+)["']/i);
      if (jsM2) {
        referer = currentUrl;
        currentUrl = jsM2[1].indexOf('http') === 0 ? jsM2[1] : new URL(jsM2[1], currentUrl).href;
        continue;
      }

      console.log('[SID] No next step found, stopping at step ' + step);
      return null;
    }

    return null;
  } catch (e) {
    console.log('[SID] Error: ' + e.message);
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

    var jsMatch = html.match(/window\.location\.replace\("([^"]+)"\)/);
    if (jsMatch && depth < 2) {
      var nextUrl = jsMatch[1].indexOf('http') === 0 ? jsMatch[1] : base + jsMatch[1];
      return await resolveDriveSeed(nextUrl, depth + 1);
    }

    var patterns = [
      /https?:\/\/[^"'\s<>]*?r2\.cloudflarestorage\.com[^"'\s<>]*/i,
      /https?:\/\/[^"'\s<>]*?workers\.dev[^"'\s<>]*/i
    ];
    for (var i = 0; i < patterns.length; i++) {
      var m = html.match(patterns[i]);
      if (m) return m[0].replace(/["'\\]+$/, '');
    }

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
      return { c: c, score: score };
    }).sort(function(a, b) { return b.score - a.score; });

    for (var k = 0; k < scored.length; k++) {
      var cand = scored[k].c;
      var absHref = cand.href.indexOf('http') === 0 ? cand.href : base + (cand.href.charAt(0) === '/' ? '' : '/') + cand.href;
      if (/\.(mkv|mp4)(\?|$)/i.test(absHref)) return absHref;
      if (/r2\.cloudflarestorage|workers\.dev|pixeldrain/i.test(absHref)) return absHref;
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
