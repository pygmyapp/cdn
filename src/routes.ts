import { resolve } from 'node:path';
import { Hono } from 'hono';
import mime from 'mime';
import sharp, { type FormatEnum } from 'sharp';
import config from '../config.json';
import { authMiddleware } from './auth';
import { Errors } from './constants';
import { minio } from './index';
import { generateSnowflake } from './snowflake';

const app = new Hono();

const uploadTypeLimits: { [key: string]: string[] } = config.uploadFileTypes;

/**
 * Validates that format is an accepted image format
 * @param fmt Format string
 * @returns Input format, keyed to Sharp FormatEnum
 */
const isValidFormat = (fmt: string): fmt is keyof FormatEnum =>
  ['png', 'jpeg', 'webp', 'avif'].includes(fmt);

/**
 * Parses input size into width/height (ie. 512 becomes 512x512, 800x600 becomex 800x600)
 * @param str Size string
 * @returns Width/height object, null if no input/invalid input provided
 */
const parseSize = (
  str: string | undefined
): { width: number; height: number } | null => {
  if (!str) return null;

  if (str.includes('x')) {
    const [w, h] = str.split('x').map((s) => Number(s));

    if (!w || !h || Number.isNaN(w) || Number.isNaN(h)) return null;

    return { width: w, height: h };
  } else {
    const n = Number(str);

    if (Number.isNaN(n)) return null;

    return { width: n, height: n };
  }
};

/**
 * Invalidates all cached versions of a given image ID
 * @param id Image ID
 */
export const invalidateCacheFor = async (id: string): Promise<void> => {
  const objects: string[] = [];

  const stream = minio.listObjectsV2('cache', `${id}__`, true);

  return new Promise<void>((resolve, reject) => {
    stream.on('data', (obj) => {
      if (obj.name) objects.push(obj.name);
    });

    stream.on('end', async () => {
      if (objects.length > 0) await minio.removeObjects('cache', objects);

      resolve();
    });

    stream.on('error', reject);
  });
};

const streamToBuffer = (stream: NodeJS.ReadableStream): Promise<Buffer> => {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk) =>
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    );
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
};

// POST /upload
app.post('/upload', authMiddleware, async (c) => {
  const form = await c.req.formData();

  const file = form.get('file') as File | null;
  const bucket = form.get('bucket') as string | null;

  if (!file) return c.json({ error: Errors.MissingFile }, 400);
  if (!bucket) return c.json({ error: Errors.MissingBucket }, 400);
  if (bucket === '') return c.json({ error: Errors.InvalidBucket }, 400);

  // Validate file type
  const ext = mime.getExtension(file.type);
  if (ext === null || !uploadTypeLimits[bucket]?.includes(ext))
    return c.json({ error: Errors.InvalidFileType }, 400);

  // Validate file size
  if (file.size > config.uploadSizeLimit)
    return c.json({ error: Errors.ExceedsSizeLimit }, 400);

  // Check bucket exists
  const bucketExists = await minio.bucketExists(bucket);
  if (!bucketExists) return c.json({ error: Errors.InvalidBucket }, 400);

  // Generate metadata
  const id = ['attachments'].includes(bucket)
    ? generateSnowflake()
    : c.var.userId;
  const url = `${process.env.PUBLIC_URL_BASE as string}/${bucket}/${id}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const metadata = {
    'Content-Type': file.type,
    cdnId: id,
    userId: c.var.userId
  };

  // Upload file
  try {
    await minio.putObject(bucket, id, buffer, buffer.length, metadata);

    return c.json(
      {
        id,
        url
      },
      201
    );
  } catch (err) {
    console.error(err);

    return c.json({ error: Errors.ServerError }, 500);
  }
});

// GET /:bucket/:id
app.get('/:bucket/:id', async (c) => {
  const bucket = c.req.param('bucket');
  const id = c.req.param('id');

  if (!bucket || bucket === '')
    return c.json({ error: Errors.MissingBucket }, 400);
  if (!id || id === '') return c.json({ error: Errors.MissingID }, 400);

  const type = c.req.query('type');
  const size = Number(c.req.query('size'));
  const dimensions = parseSize(c.req.query('size'));

  if (type && !['png', 'jpeg', 'webp', 'avif'].includes(type))
    return c.json({ error: Errors.InvalidImageType }, 400);

  try {
    const stat = await minio.statObject(bucket, id);
    const stream = await minio.getObject(bucket, id);

    // If not an image, return the file directly
    if (!stat.metaData['content-type'].startsWith('image/')) {
      c.header('Content-Type', stat.metaData['content-type']);
      c.header('Content-Length', stat.size.toString());

      return new Response(stream, {
        headers: c.res.headers
      });
    }

    // Build cache key
    const cacheKey = `${id}__${type || mime.getExtension(stat.metaData['content-type'])}${size ? `_${size}` : ''}`;

    // Get width/height
    const buffer = await streamToBuffer(stream);
    const { width, height } = await sharp(buffer).metadata();

    // Attempt to fetch cached image
    try {
      const cachedStream = await minio.getObject('cache', cacheKey);
      const cachedStat = await minio.statObject('cache', cacheKey);

      const cachedEtag = cachedStat.metaData?.['x-original-etag'];

      // Compare original etag to cached etag
      if (cachedEtag === stat.etag) {
        // Original has not changed, serve cached version
        c.header('Content-Type', cachedStat.metaData['content-type']);
        c.header('Content-Length', cachedStat.size.toString());

        return new Response(cachedStream, {
          headers: c.res.headers
        });
      } else {
        // Original has changed, delete all cached versions
        await invalidateCacheFor(id);
      }
    } catch {
      // Not in cache, generate/serve image
    }

    // Determine if we need to use the transformer or not
    // Should be transformed if the type requested is different to the original,
    // or if the size requested is smaller than the original
    let bufferToServe: Buffer<ArrayBufferLike> | undefined = buffer;
    let useTransform = true;
    let isTransformed = false;

    if (dimensions) {
      if (dimensions.width >= width && dimensions.height >= height) {
        useTransform =
          type !== mime.getExtension(stat.metaData['content-type']);
        bufferToServe = useTransform ? undefined : buffer;
      }
    }

    if (
      !useTransform &&
      type !== mime.getExtension(stat.metaData['content-type'])
    ) {
      useTransform = type !== mime.getExtension(stat.metaData['content-type']);
      bufferToServe = useTransform ? undefined : buffer;
    }

    // Use transformer, if determined we need to
    if (useTransform) {
      let transformer = sharp(buffer);

      // Size
      if (c.req.query('size') !== undefined && dimensions !== null) {
        transformer = transformer.resize(
          dimensions ? dimensions.width : size,
          dimensions ? dimensions.height : size,
          {
            fit: 'inside',
            withoutEnlargement: true
          }
        );

        isTransformed = true;
      }

      // Type
      if (
        type !== undefined &&
        type !== mime.getExtension(stat.metaData['content-type'])
      ) {
        const format: keyof FormatEnum = isValidFormat(type) ? type : 'jpeg';

        transformer = transformer.toFormat(format);

        isTransformed = true;

        c.header('Content-Type', `image/${type}`);
      } else {
        c.header(
          'Content-Type',
          stat.metaData['content-type'] || 'application/octet-stream'
        );
      }

      bufferToServe = await stream.pipe(transformer).toBuffer();

      c.header('Content-Length', bufferToServe.byteLength.toString());
    }

    if (!bufferToServe) throw 'Buffer missing';

    // Cache transformed version back into MinIO, if transformed
    if (isTransformed)
      await minio.putObject(
        'cache',
        cacheKey,
        bufferToServe,
        buffer.byteLength,
        {
          'Content-Type': type
            ? `image/${type}`
            : stat.metaData['content-type'] || 'application/octet-stream',
          'x-original-etag': stat.etag,
          cdnId: cacheKey,
          userId: stat.metaData.userid
        }
      );

    return new Response(bufferToServe, {
      headers: c.res.headers
    });
  } catch (err) {
    if (typeof err !== 'object' || err === null || !('code' in err)) {
      console.error(err);
      return c.json({ error: Errors.ServerError }, 500);
    }

    if (err.code === 'NoSuchKey' || err.code === 'NotFound') {
      // If requesting an avatar, provide a fallback/default avatar
      if (bucket === 'avatars') {
        const fallbackPath = resolve(
          `./public/default-avatar.${type ? type : 'webp'}`
        );

        const fallbackFile = Bun.file(fallbackPath);

        if (!(await fallbackFile.exists()))
          return c.json({ error: Errors.FileNotFoundNoFallback }, 404);

        return new Response(fallbackFile, {
          headers: {
            'Content-Type': fallbackFile.type,
            'Content-Length': fallbackFile.size.toString()
          }
        });
      }

      return c.json({ error: Errors.FileNotFound }, 404);
    }

    console.error(err);

    return c.json({ error: Errors.ServerError }, 500);
  }
});

// GET /:bucket/:id/object
app.get('/:bucket/:id/object', authMiddleware, async (c) => {
  const bucket = c.req.param('bucket');
  const id = c.req.param('id');

  if (!bucket || bucket === '')
    return c.json({ error: Errors.MissingBucket }, 400);
  if (!id || id === '') return c.json({ error: Errors.MissingID }, 400);

  try {
    const stat = await minio.statObject(bucket, id);

    return c.json(stat);
  } catch (err) {
    if (typeof err !== 'object' || err === null || !('code' in err))
      return c.json({ error: Errors.ServerError }, 500);

    if (err.code === 'NoSuchKey' || err.code === 'NotFound')
      return c.json({ error: Errors.FileNotFound }, 404);

    console.error(err);

    return c.json({ error: Errors.ServerError }, 500);
  }
});

// DELETE /:bucket/:id/object
app.delete('/:bucket/:id/object', authMiddleware, async (c) => {
  const bucket = c.req.param('bucket');
  const id = c.req.param('id');

  if (!bucket || bucket === '')
    return c.json({ error: Errors.MissingBucket }, 400);
  if (!id || id === '') return c.json({ error: Errors.MissingID }, 400);

  try {
    const stat = await minio.statObject(bucket, id);

    // Only allow delete if authenticated user is the original uploader
    // TODO: this needs to be extended in the future, allowing server moderators to delete messages and delete the attachments
    // along with, when permissions are implemented then it must be implemented here (via IPC maybe?)
    if (c.var.userId !== stat.metaData.userid)
      return c.json({ error: Errors.Forbidden }, 400);

    // Delete original
    await minio.removeObject(bucket, id);

    // Delete any cached variants
    if (stat.metaData['content-type'].startsWith('image/'))
      await invalidateCacheFor(id);

    return c.body(null, 204);
  } catch (err) {
    if (typeof err !== 'object' || err === null || !('code' in err))
      return c.json({ error: Errors.ServerError }, 500);

    if (err.code === 'NoSuchKey' || err.code === 'NotFound')
      return c.json({ error: Errors.FileNotFound }, 404);

    console.error(err);

    return c.json({ error: Errors.ServerError }, 500);
  }
});

export default app;
