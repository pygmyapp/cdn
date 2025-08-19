import { createMiddleware } from 'hono/factory';
// @ts-ignore ipc-client is lacking typing... fix this
import type { IPCMessage } from 'ipc-client';
import { Errors } from './constants';
import { ipc, send } from './ipc';

// Authorized middleware
export const authMiddleware = createMiddleware<{
  Variables: {
    userId: string;
  };
}>(async (c, next) => {
  // Get header
  const header = c.req.header('Authorization');
  if (!header || header === '')
    return c.json({ error: Errors.InvalidToken }, 401);

  // Check it is valid (Bearer and non-empty)
  const [type, token, ...other] = header.split(' ');

  if (!type || !token || other.length !== 0)
    return c.json({ error: Errors.InvalidToken }, 401);

  if (type !== 'Bearer') return c.json({ error: Errors.InvalidTokenType }, 401);

  try {
    // Validate token using IPC
    const { valid, userId } = await new Promise<{
      valid: boolean;
      userId: string | null;
    }>((resolve, _reject) => {
      ipc.on('message', (message: IPCMessage) => {
        if (
          message.from === 'rest' &&
          'type' in message.payload &&
          (message.payload.type as string) === 'response' &&
          'action' in message.payload &&
          (message.payload.action as string) === 'VERIFY_TOKEN' &&
          'token' in message.payload &&
          (message.payload.token as string) === token &&
          'valid' in message.payload &&
          'userId' in message.payload
        ) {
          return resolve({
            valid: message.payload.valid as boolean,
            userId: message.payload.userId as string | null
          });
        }
      });

      send('rest', 'request', 'VERIFY_TOKEN', {
        token
      });
    });

    if (!valid || userId === null)
      return c.json({ error: Errors.InvalidToken }, 401);

    // Set session variables and continue request
    c.set('userId', userId);

    await next();
  } catch (err) {
    console.error(err);

    return c.json({ error: Errors.InvalidToken }, 401);
  }
});
