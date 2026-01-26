// @ts-ignore ipc-client is lacking typing... fix this
import IPC, { type IPCMessage } from 'ipc-client';

export const ipc = new IPC('cdn');

/**
 * Send a request/response over IPC
 * @param to Recipient name
 * @param type Request/response
 * @param action Action name
 * @param args Additional payload data/args
 */
export const send = async (
  to: string,
  type: 'request' | 'response',
  action: string,
  args: {
    [key: string]: unknown;
  }
): Promise<void> => {
  await ipc.send(to, {
    type,
    action,
    ...args
  });
};

ipc.on('connect', () => console.log('Connected to IPC server/socket'));

ipc.on('disconnect', () => console.log('Lost connection to IPC server/socket'));

ipc.on('message', async (message: IPCMessage) => {
  if (!message.type || !message.action) return;

  const _type = message.payload.type as string;
  const _action = message.payload.action as string;

  // TODO: this
});
