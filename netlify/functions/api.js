'use strict';

// Netlify Functions entrypoint. Wraps the Express API (no static serving — the
// Netlify CDN serves /public) so all /api/* routes run as one serverless
// function. The netlify.toml redirect sends /api/* here.

const serverless = require('serverless-http');
const { createApp } = require('../../server/app');

const app = createApp({ serveStatic: false });
// Excel exports are binary; without this, serverless-http treats the response
// body as UTF-8 text and mangles the bytes, producing a corrupt .xlsx file.
const wrapped = serverless(app, {
  binary: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
});

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
