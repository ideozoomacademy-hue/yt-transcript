// Extracts a balanced bracket/brace section starting at startIndex (which
// must point at the opening character).
function extractBalanced(str, startIndex, openChar, closeChar) {
  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = startIndex; i < str.length; i++) {
    const ch = str[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (ch === '\\') {
      escapeNext = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === openChar) depth++;
    else if (ch === closeChar) {
      depth--;
      if (depth === 0) return str.slice(startIndex, i + 1);
    }
  }
  return null;
}

export default async function handler(req, res) {
  const { videoId, lang } = req.query;

  if (!videoId) {
    return res.status(400).json({ error: 'videoId is required' });
  }

  try {
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}&hl=en`;

    const pageRes = await fetch(videoUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        // Bypass YouTube's EU/consent interstitial page which otherwise
        // replaces the normal watch page (and hides captionTracks).
        Cookie: 'CONSENT=YES+cb.20210328-17-p0.en+FX+410; SOCS=CAI'
      }
    });

    if (!pageRes.ok) {
      return res
        .status(502)
        .json({ error: 'Could not load YouTube page', status: pageRes.status });
    }

    const html = await pageRes.text();

    const markerIndex = html.indexOf('"captionTracks":');

    if (markerIndex === -1) {
      if (
        html.includes('Sign in to confirm') ||
        html.includes('consent.youtube.com') ||
        html.includes('Our systems have detected unusual traffic')
      ) {
        return res.status(503).json({
          error:
            'YouTube is currently blocking requests from this server. Please try again in a few minutes.'
        });
      }
      return res
        .status(404)
        .json({ error: 'No captions/transcript available for this video' });
    }

    const arrayStart = html.indexOf('[', markerIndex);
    const arrayStr = extractBalanced(html, arrayStart, '[', ']');

    if (!arrayStr) {
      return res.status(500).json({ error: 'Failed to parse caption data' });
    }

    let captionTracks;
    try {
      captionTracks = JSON.parse(arrayStr);
    } catch (e) {
      return res.status(500).json({ error: 'Failed to parse caption data' });
    }

    if (!captionTracks || captionTracks.length === 0) {
      return res.status(404).json({ error: 'No captions available' });
    }

    // Pick requested language, else English, else first available
    let track =
      captionTracks.find((t) => t.languageCode === lang) ||
      captionTracks.find((t) => t.languageCode === 'en') ||
      captionTracks.find((t) => t.languageCode?.startsWith('en')) ||
      captionTracks[0];

    const baseUrl = track.baseUrl.replace(/\\u0026/g, '&');

    const transcriptRes = await fetch(`${baseUrl}&fmt=json3`, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
      }
    });

    if (!transcriptRes.ok) {
      return res.status(502).json({ error: 'Could not fetch transcript data' });
    }

    const transcriptData = await transcriptRes.json();

    const segments = [];
    for (const event of transcriptData.events || []) {
      if (!event.segs) continue;
      const text = event.segs
        .map((s) => s.utf8 || '')
        .join('')
        .replace(/\n/g, ' ')
        .trim();
      if (!text) continue;
      segments.push({
        start: (event.tStartMs || 0) / 1000,
        text
      });
    }

    if (segments.length === 0) {
      return res.status(404).json({ error: 'Transcript was empty for this video' });
    }

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
    res.status(200).json({
      videoId,
      language: track.languageCode,
      languageName: track.name?.simpleText || track.languageCode,
      availableLanguages: captionTracks.map((t) => ({
        code: t.languageCode,
        name: t.name?.simpleText || t.languageCode
      })),
      segments
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error', details: err.message });
  }
}
