/**
 * Netlify Function entry point.
 *
 * netlify.toml rewrites `/api/*` to `/.netlify/functions/api/:splat` with
 * status 200, so the original URL reaches this function untouched and Express
 * routing, the access-code gate, the IP rate limits and the daily quotas all
 * behave exactly as they do under `npm start`.
 *
 * The handler is cached by serverless-express across warm invocations, which
 * also keeps the Blobs client + usage counters warm.
 */

const serverlessExpress = require('@vendia/serverless-express');
const { app } = require('../../server.js');

const FUNCTION_PREFIX = '/.netlify/functions/api';

/**
 * Netlify invokes functions with a bare Lambda event: it carries `path`,
 * `httpMethod`, `headers`, `body` and `rawUrl`, but **no `requestContext`**.
 * @vendia/serverless-express detects the event source from that field and
 * throws `Unable to determine event source based on event` without it, which
 * made every /api/* call answer 502 in production (the UI then fell back to its
 * 3-line offline stub). Normalise Netlify's event into the API Gateway v1 shape
 * serverless-express does understand.
 */
function toApiGatewayV1Event(event = {}) {
  const headers = event.headers || {};
  const httpMethod = event.httpMethod || 'GET';

  let path = event.path || '/';
  if (typeof event.rawUrl === 'string') {
    try {
      path = new URL(event.rawUrl).pathname || path;
    } catch (err) { /* keep event.path */ }
  }
  // A direct function URL arrives as `/.netlify/functions/api/health`; the
  // /api/* rewrite normally hands over `/api/health` already.
  if (path === FUNCTION_PREFIX) path = '/';
  else if (path.startsWith(`${FUNCTION_PREFIX}/`)) path = `/api/${path.slice(FUNCTION_PREFIX.length + 1)}`;

  const multiValueHeaders = event.multiValueHeaders
    || Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, [String(value)]]));

  return {
    ...event,
    httpMethod,
    path,
    headers,
    multiValueHeaders,
    queryStringParameters: event.queryStringParameters || null,
    multiValueQueryStringParameters: event.multiValueQueryStringParameters || null,
    pathParameters: event.pathParameters || null,
    isBase64Encoded: Boolean(event.isBase64Encoded),
    // Minimal API Gateway v1 envelope: serverless-express only needs it to pick
    // the event source (the client IP for the rate limits comes from the
    // x-nf-client-connection-ip header in server.js).
    requestContext: event.requestContext || {
      path,
      httpMethod,
      protocol: 'HTTP/1.1',
      stage: 'prod',
      requestId: event.requestId || undefined,
      identity: { sourceIp: '' }
    }
  };
}

const proxy = serverlessExpress({
  app,
  binarySettings: {
    // Azure Neural TTS responds with audio/mpeg; without this the Lambda
    // transport would UTF-8 the MP3 bytes and corrupt the audio.
    isBinary: ({ headers }) => {
      const type = String(headers['content-type'] || headers['Content-Type'] || '').toLowerCase();
      return type.startsWith('audio/')
        || type.startsWith('image/')
        || type === 'application/octet-stream';
    }
  }
});

exports.handler = (event, context) => proxy(toApiGatewayV1Event(event), context);
exports.toApiGatewayV1Event = toApiGatewayV1Event;

