'use strict';

// Netlify Functions entrypoint. Wraps the Express API (no static serving — the
// Netlify CDN serves /public) so all /api/* routes run as one serverless
// function. The netlify.toml redirect sends /api/* here.

const serverless = require('serverless-http');
const { createApp } = require('../../server/app');

const app = createApp({ serveStatic: false });
const wrapped = serverless(app);

exports.handler = async (event, context) => {
  // Don't wait for the BigQuery client's idle sockets before returning.
  context.callbackWaitsForEmptyEventLoop = false;

  // Normalize the path so Express always sees `/api/...`, regardless of whether
  // Netlify hands us the original path or the rewritten function path.
  if (event.path) {
    event.path = event.path.replace('/.netlify/functions/api', '/api');
    if (!event.path.startsWith('/api')) {
      event.path = '/api' + (event.path.startsWith('/') ? '' : '/') + event.path;
    }
  }
  return wrapped(event, context);
};
