const INNERTUBE_KEY = 'AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w';

export default async function handler(req, res) {
  const { videoId, lang } = req.query;

  if (!videoId) {
    return res.status(400).json({ error: 'videoId is required' });
  }

  try {
    const ytRes = await fetch(
      `https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_KEY}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'com.google.android.youtube/19.09.37 (Linux; U; Android 14) gzip'
        },
        body: JSON.stringify({
          videoId,
          context: {
            client: {
              clientName: 'ANDROID',
              clientVersion: '19.09.37',
              androidSdkVersion: 34,
              hl: 'en',
              gl: 'US'
            }
          }
        })
      }
    );

    if (!ytRes.ok) {
      return res
        .status(502)
        .json({ error: 'Could not reach YouTube API', status: ytRes.status });
    }

    const data = await ytRes.json();

    const captionTracks =
      data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

    if (!captionTracks || captionTracks.length === 0) {
      const playability = data?.playabilityStatus?.status;
      if (playability && playability !== 'OK') {
        return res.status(404).json({
          error: `Video unavailable (${playability})`
        });
      }
      return res
        .status(404)
        .json({ error: 'No captions/transcript available for this video' });
    }

    let track =
      captionTracks.find((t) => t.languageCode === lang) ||
      captionTracks.find((t) => t.languageCode === 'en') ||
      captionTracks.find((t) => t.languageCode?.startsWith('en')) ||
      captionTracks[0];

    const transcriptRes = await fetch(`${track.baseUrl}&fmt=json3`, {
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
