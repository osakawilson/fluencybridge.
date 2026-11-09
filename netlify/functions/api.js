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

exports.handler = serverlessExpress({
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
