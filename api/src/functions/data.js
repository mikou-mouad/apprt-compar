const { app } = require('@azure/functions');
const { BlobServiceClient } = require('@azure/storage-blob');

const CONTAINER_NAME = 'apartment-data';
const BLOB_PREFIX = 'data-';

// Zero-padded, lexicographically-sortable timestamp so the newest save always
// sorts last (e.g. data-20260723-143005-123.json). Each save is its own file —
// nothing is ever overwritten, so an old/incomplete save can never clobber a newer one.
function newBlobName() {
  const d = new Date();
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  const stamp = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-`
    + `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}-${pad(d.getUTCMilliseconds(), 3)}`;
  return `${BLOB_PREFIX}${stamp}.json`;
}

async function getContainerClient() {
  const connStr = process.env.STORAGE_CONNECTION_STRING;
  if (!connStr) {
    throw new Error('STORAGE_CONNECTION_STRING app setting is not configured');
  }
  const blobServiceClient = BlobServiceClient.fromConnectionString(connStr);
  const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);
  await containerClient.createIfNotExists();
  return containerClient;
}

// Finds the most recent save by listing blobs and taking the lexicographically
// last name (the zero-padded timestamp format makes lexicographic == chronological).
async function getLatestBlobClient(containerClient) {
  let latestName = null;
  for await (const blob of containerClient.listBlobsFlat({ prefix: BLOB_PREFIX })) {
    if (latestName === null || blob.name > latestName) latestName = blob.name;
  }
  return latestName ? containerClient.getBlockBlobClient(latestName) : null;
}

async function streamToString(readableStream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    readableStream.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    readableStream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    readableStream.on('error', reject);
  });
}

app.http('data', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'data',
  handler: async (request, context) => {
    try {
      const containerClient = await getContainerClient();

      if (request.method === 'GET') {
        const blobClient = await getLatestBlobClient(containerClient);
        if (!blobClient) {
          return { status: 200, jsonBody: null }; // nothing saved yet
        }
        try {
          const downloadResponse = await blobClient.download();
          const content = await streamToString(downloadResponse.readableStreamBody);
          return { status: 200, jsonBody: JSON.parse(content) };
        } catch (err) {
          if (err.statusCode === 404) {
            return { status: 200, jsonBody: null };
          }
          throw err;
        }
      }

      if (request.method === 'POST') {
        const body = await request.json();
        const content = JSON.stringify(body);
        const blobName = newBlobName();
        const blobClient = containerClient.getBlockBlobClient(blobName);
        // Never overwrites: each save is a brand-new, uniquely-named blob.
        await blobClient.upload(content, Buffer.byteLength(content));
        return { status: 200, jsonBody: { ok: true, file: blobName } };
      }

      return { status: 405, body: 'Method not allowed' };
    } catch (err) {
      context.error(err);
      return { status: 500, jsonBody: { error: err.message } };
    }
  }
});
