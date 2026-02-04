// @ts-ignore ipc-client is lacking typing... fix this
import IPC, { type IPCMessage } from 'ipc-client';
import { minio } from './index';
import { invalidateCacheFor } from './routes';

export const ipc = new IPC('cdn');

export type IPCMessageActionPayload = {
  type: string;
  action: string;
  [key: string]: unknown;
};

type IPCMessageEventPayload = {
  type: string;
  event: string;
  client: string;
  [key: string]: unknown;
};

ipc.on('connect', () => console.log('Connected to IPC server/socket'));

ipc.on('disconnect', () => console.log('Lost connection to IPC server/socket'));

ipc.on('message', async (message: IPCMessage) => {
  const payload = message.payload as IPCMessageActionPayload | IPCMessageEventPayload;

  // Request:
  if (payload.type === 'request') {
    // Check if avatar exists
    if (payload.action && payload.action === 'CHECK_IF_AVATAR_EXISTS') {
      const userId = payload.userId as string;

      console.log(`checking avatar exists for user id: ${userId}`)

      try {
        const stat = await minio.statObject('avatars', userId);

        if (stat.metaData && 'userid' in stat.metaData && (stat.metaData.userid as string) === userId)
          return ipc.send('rest', {
            type: 'response',
            action: 'CHECK_IF_AVATAR_EXISTS',
            userId,
            exists: true
          });

        else throw false;
      } catch (err) {
        return ipc.send('rest', {
          type: 'response',
          action: 'CHECK_IF_AVATAR_EXISTS',
          userId,
          exists: false
        });
      }
    }

    // Delete avatar if exists
    if (payload.action && payload.action === 'DELETE_AVATAR_IF_EXISTS') {
      const userId = payload.userId as string;

      try {
        const stat = await minio.statObject('avatars', userId);

        // Delete original
        await minio.removeObject('avatars', userId);

        // Delete any cached variants
        if (stat.metaData['content-type'].startsWith('image/'))
          await invalidateCacheFor(userId);

        return true;
      } catch (err) {
        return false;
      }
    }
  }
});
