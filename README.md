# 🐰📁 pygmyapp/cdn
S3-compatible content server for uploading and serving images/attachments

## Dependencies
**Pygmy is built with Bun!** It doesn't run on node.js alone, [see here to install Bun](https://bun.com/docs/installation) or [here to learn more](https://bun.sh).

`pygmyapp/cdn` depends on a [MinIO](https://www.min.io/) server with:
- the following buckets: `cache`, `attachments`, `avatars`;
- access key (username) and secret key (password) configured.

It is *highly recommended* to change the default credentials to something unique and secure.

`pygmyapp/cdn` also depends on:
- an active IPC server (`pygmyapp/ipc-server`) and REST API (`pygmyapp/rest`), used for authentication

## API

`pygmyapp/cdn` is built on MinIO, which is a self-hostable S3-compatible storage server. All content is stored and retrieved
through the use of "buckets", which are akin to individual directories.

Authentication is required in the form of a `Authorization: Bearer <token>` header using your REST API session token.

It is important to note that file uploads are **public**, and can be retrieved by anyone with the public URL/bucket name and ID combination.
Once a file has been uploaded to the CDN, anyone with the URL can access it. Keep this in mind!

The following routes are available:
- `POST /upload`: Upload a file to a bucket using `(multipart/form-data)`
  - Fields: `file: File, bucket: string`
  - Returns: 201 `{ id, url }`, 400/401/500 `{ error }`

- `GET /<bucket>/<id>`: Returns the uploaded file as a content stream, `Content-Type` will be the file type
  - This route does *not* require authentication
  - If requesting from the `avatar` bucket, the following query params can be used: `type: png | jpeg | webp | avif, size: <number>`
  - Transformed versions are cached and will be returned unless the original is changed
  - If not found, returns: 404 `{ error }`

- `GET /<bucket>/<id>/object`: Returns the uploaded file's object/metadata
  - Returns: 200 `{ id, url, name, type, size, bucket }`, 401/404 `{ error }`

- `DELETE /<bucket>/<id>/object`: Delete a file/all cached variations
  - Only the original user that uploaded the file can delete it
  - Returns: 204 (deleted), 401/403/404 `{ error }`

This documentation will be updated & moved in the future.

## Install

### Manual

- Clone this repository
- Install dependencies with `bun install`
- Copy `.env.example` to `.env` and configure environment variables
- Copy `config.json.example` to `config.json` and configure file upload limit/accepted file upload types
  - By default, the upload limit is 10 MB, and a fairly wide range of extensions are supported

You can then start in production/dev mode:
```sh
bun run prod # production

bun run dev # dev mode - reloads on file changes
```

## Scripts

- `bun run lint`: runs Biome linting, applies safe fixes, and auto-organizes imports

## Licence
Copyright (c) 2025 Pygmy & contributors

All code & assets are licensed under GNU GPL v3 unless stated otherwise.  
See `LICENSE` or [see here](https://www.gnu.org/licenses/gpl-3.0.txt).