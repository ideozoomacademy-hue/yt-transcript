export default async function handler(req, res) {
  const { videoId, lang } = req.query;

  if (!videoId) {
    return res.status(400).json({ error: 'videoId is required' });
  }

  try {
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

    const pageRes = await fetch(videoUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });

    if (!pageRes.ok) {
      return res.status(502).json({ error: 'Could not load YouTube page' });
    }

    const html = await pageRes.text();

    const captionsMatch = html.match(/"captionTracks":(\[[^\]]*\])/);

    if (!captionsMatch) {
      return res.status(404).json({
        error: 'No captions/transcript available for this video'
      });
    }

    let captionTracks;
    try {
      captionTracks = JSON.parse(captionsMatch[1]);
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

    const transcriptRes = await fetch(`${baseUrl}&fmt=json3`);
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
