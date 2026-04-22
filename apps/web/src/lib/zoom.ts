const ZOOM_TOKEN_URL = 'https://zoom.us/oauth/token';
const ZOOM_API_BASE = 'https://api.zoom.us/v2';

// Module-level token cache — shared across Lambda warm instances
let cachedToken: { token: string; expiresAt: number } | null = null;

export type ZoomMeetingResult =
  | { ok: true; meetingId: number; joinUrl: string; password: string }
  | { ok: false; error: string };

async function getZoomAccessToken(): Promise<string> {
  // Return cached token if still valid (with 5-min buffer)
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }

  const { ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET } = process.env;
  if (!ZOOM_ACCOUNT_ID || !ZOOM_CLIENT_ID || !ZOOM_CLIENT_SECRET) {
    throw new Error('Zoom credentials not configured');
  }

  const credentials = Buffer.from(`${ZOOM_CLIENT_ID}:${ZOOM_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(
    `${ZOOM_TOKEN_URL}?grant_type=account_credentials&account_id=${ZOOM_ACCOUNT_ID}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    }
  );
  if (!res.ok) throw new Error(`Zoom token error: ${res.status}`);

  const data = await res.json();
  // Runtime guard — never trust external API response shape
  if (typeof data.access_token !== 'string' || typeof data.expires_in !== 'number') {
    throw new Error('Unexpected Zoom token response shape');
  }

  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 300) * 1000, // 5-min buffer
  };
  return cachedToken.token;
}

export async function createZoomMeeting(params: {
  title: string;
  startAt: string; // ISO 8601 with offset
  durationMinutes: number;
  timezone: string; // IANA timezone, e.g. "America/New_York"
}): Promise<ZoomMeetingResult> {
  try {
    const accessToken = await getZoomAccessToken();
    const res = await fetch(`${ZOOM_API_BASE}/users/me/meetings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        topic: params.title,
        type: 2, // Scheduled one-time meeting
        start_time: params.startAt,
        duration: params.durationMinutes,
        timezone: params.timezone,
        settings: { join_before_host: true },
      }),
    });

    if (!res.ok) {
      await res.json().catch(() => ({}));
      // Do NOT log the full error object — it may contain auth context
      return { ok: false, error: `Zoom meeting creation failed (${res.status})` };
    }

    const meeting = await res.json();
    // Runtime guards — never cast external API fields
    if (typeof meeting.id !== 'number' || typeof meeting.join_url !== 'string') {
      return { ok: false, error: 'Unexpected Zoom meeting response shape' };
    }
    // Do NOT store start_url — it contains an ephemeral ZAK token
    return {
      ok: true,
      meetingId: meeting.id,
      joinUrl: meeting.join_url,
      password: typeof meeting.password === 'string' ? meeting.password : '',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown Zoom error';
    return { ok: false, error: msg };
  }
}
