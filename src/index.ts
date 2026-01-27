import { Hono } from 'hono';
import { cors } from 'hono/cors';
import * as MinIO from 'minio';
import { ipc } from './ipc';
import routes from './routes';

const app = new Hono();

// MinIO
export const minio = new MinIO.Client({
  endPoint: process.env.MINIO_ENDPOINT as string,
  port: Number(process.env.MINIO_PORT as string),
  useSSL: (process.env.MINIO_USE_SSL as string) === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY as string,
  secretKey: process.env.MINIO_SECRET_KEY as string
});

const ensureBucket = async (bucket: string): Promise<void> => {
  if (!(await minio.bucketExists(bucket).catch(() => false))) {
    await minio.makeBucket(bucket);

    console.log(`Bucket ${bucket} created`);
  }
};

// Ensure buckets exist
(async () => {
  await ensureBucket('cache');
  await ensureBucket('attachments');
  await ensureBucket('avatars');
})();

// Routes
app.use('/*', cors());

app.route('/', routes);

// Health check
app.get('/health', (c) => c.json({ ok: true }));

// Connect to IPC
ipc.connect();

export default app;
