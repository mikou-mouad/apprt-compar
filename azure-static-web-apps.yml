const { app } = require('@azure/functions');
const { BlobServiceClient } = require('@azure/storage-blob');

const CONTAINER_NAME = 'apartment-data';
const BLOB_NAME = 'data.json';

async function getBlobClient() {
  const connStr = process.env.STORAGE_CONNECTION_STRING;
  if (!connStr) {
    throw new Error('STORAGE_CONNECTION_STRING app setting is not configured');
  }
  const blobServiceClient = BlobServiceClient.fromConnectionString(connStr);
  const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);
  await containerClient.createIfNotExists();
  return containerClient.getBlockBlobClient(BLOB_NAME);
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
      const blobClient = await getBlobClient();

      if (request.method === 'GET') {
        try {
          const downloadResponse = await blobClient.download();
          const content = await streamToString(downloadResponse.readableStreamBody);
          return { status: 200, jsonBody: JSON.parse(content) };
        } catch (err) {
          if (err.statusCode === 404) {
            // nothing saved yet
            return { status: 200, jsonBody: null };
          }
          throw err;
        }
      }

      if (request.method === 'POST') {
        const body = await request.json();
        const content = JSON.stringify(body);
        await blobClient.upload(content, Buffer.byteLength(content), { overwrite: true });
        return { status: 200, jsonBody: { ok: true } };
      }

      return { status: 405, body: 'Method not allowed' };
    } catch (err) {
      context.error(err);
      return { status: 500, jsonBody: { error: err.message } };
    }
  }
});
