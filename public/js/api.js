/**
 * Thin fetch wrapper: JSON in, JSON out, rich errors.
 *
 * When the deployment sets ACCESS_CODE the server answers 401 with
 * `error: "access_code_required"`. The unlock flow keeps the code for the tab
 * (sessionStorage) and sends it as `X-Access-Code`; the server also issues an
 * HttpOnly session cookie, so the header is only a fallback for browsers that
 * block cookies.
 */

const ACCESS_KEY = 'fb-access-code';
const STUDENT_KEY = 'fb_student_id';
const STUDENT_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/** RFC 4122 v4 UUID, with a Math.random fallback for insecure contexts. */
function newStudentId() {
  const cryptoApi = typeof window !== 'undefined' ? window.crypto : null;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID();
  const bytes = new Uint8Array(16);
  if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') cryptoApi.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Stable per-browser student UUID (`fb_student_id`). The server counts the
 * daily 60-call quota against this ID, not the IP, so a whole classroom behind
 * one campus NAT keeps individual budgets.
 */
export function getStudentId() {
  let stored = '';
  try {
    stored = window.localStorage.getItem(STUDENT_KEY) || '';
  } catch (err) { /* private mode: an in-memory ID is used for this page */ }
  if (!STUDENT_ID_PATTERN.test(stored)) {
    stored = newStudentId();
    try {
      window.localStorage.setItem(STUDENT_KEY, stored);
    } catch (err) { /* ignore */ }
  }
  return stored;
}

export function setAccessCode(code) {
  const value = String(code || '').trim();
  try {
    if (value) window.sessionStorage.setItem(ACCESS_KEY, value);
    else window.sessionStorage.removeItem(ACCESS_KEY);
  } catch (err) { /* private mode: the cookie still authorises this tab */ }
  return value;
}

export function getAccessCode() {
  try {
    return window.sessionStorage.getItem(ACCESS_KEY) || '';
  } catch (err) {
    return '';
  }
}

function withAccessCode(headers = {}) {
  const next = { ...headers, 'x-client-session-id': getStudentId() };
  const code = getAccessCode();
  if (code) next['X-Access-Code'] = code;
  return next;
}

/** Lets the app show the daily-limit banner / disable the mic. */
function notifyUsageLimit(payload, status) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  const error = payload && payload.error;
  if (error !== 'user_limit_reached' && error !== 'daily_budget_exhausted') return;
  window.dispatchEvent(new CustomEvent('fb:usage-limit', {
    detail: { ...(payload || {}), error, status }
  }));
}

/** Lets the app show the passcode dialog whenever a request is refused. */
function notifyAccessRequired(payload) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  // Only the deployment passcode should open that dialog. A wrong participant
  // PIN is also a 401, but it is answered inside the login modal instead.
  if (payload && payload.error && payload.error !== 'access_code_required') return;
  window.dispatchEvent(new CustomEvent('fb:access-required', { detail: payload || null }));
}

async function request(url, options = {}) {
  const response = await fetch(url, { ...options, headers: withAccessCode(options.headers) });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (err) {
    data = { raw: text };
  }
  if (!response.ok) {
    const error = new Error((data && (data.message || data.error)) || `HTTP ${response.status}`);
    error.status = response.status;
    error.code = data && data.error;
    error.payload = data;
    if (response.status === 401) notifyAccessRequired(data);
    notifyUsageLimit(data, response.status);
    throw error;
  }
  return data;
}

const jsonRequest = (url, method, body) => request(url, {
  method,
  headers: { 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body)
});

export const getHealth = (options = {}) => request(options.usage ? '/api/health?usage=1' : '/api/health');
export const getScenarios = () => request('/api/scenarios');
export const getSession = () => request('/api/session');

/** Exchanges the passcode for a session cookie (and keeps the header fallback). */
export async function unlockSession(code) {
  // setAccessCode() returns the trimmed value even when storage is blocked, so
  // the POST body is still correct with sessionStorage disabled.
  const value = setAccessCode(code);
  try {
    return await jsonRequest('/api/session', 'POST', { code: value });
  } catch (err) {
    setAccessCode('');
    throw err;
  }
}

export async function lockSession() {
  setAccessCode('');
  try {
    return await jsonRequest('/api/session', 'DELETE');
  } catch (err) {
    return null;
  }
}

export const assessAudio = (payload) => jsonRequest('/api/assess', 'POST', payload);
export const chatRecast = (payload) => jsonRequest('/api/chat', 'POST', payload);

/* --------------------------- v1.1.0: identity ---------------------------- */

/**
 * LinguaBridge roster sign-in.
 * @param {{studentId: string, pin: string}} credentials
 * @returns {Promise<{ok: boolean, studentId: string, pseudonym: string, role: 'student'}>}
 */
export const authLogin = ({ studentId, pin }) => jsonRequest('/api/auth/login', 'POST', { studentId, pin });

/** One-click guest id (`guest_xxxxxx`) from the server. */
export const authGuest = () => jsonRequest('/api/auth/guest', 'POST', {});

/**
 * Telemetry: one record per scored turn. The server adds id, timestamp and
 * app_version, and appends to Netlify Blobs (production) or data/interactions.json.
 */
export const postInteraction = (payload) => jsonRequest('/api/interactions', 'POST', payload);

export async function azureTts({ text, rate = 0.85, voice, phoneme }) {
  const response = await fetch('/api/tts', {
    method: 'POST',
    headers: withAccessCode({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ text, rate, voice, phoneme })
  });
  if (!response.ok) {
    let message = `TTS HTTP ${response.status}`;
    let data = null;
    try {
      data = await response.json();
      message = data.message || data.error || message;
    } catch (err) { /* ignore */ }
    if (response.status === 401) notifyAccessRequired(data);
    notifyUsageLimit(data, response.status);
    const error = new Error(message);
    error.status = response.status;
    error.code = data && data.error;
    throw error;
  }
  return {
    blob: await response.blob(),
    serverMs: Number(response.headers.get('X-TTS-Ms') || 0),
    voice: response.headers.get('X-TTS-Voice') || voice || 'azure'
  };
}
