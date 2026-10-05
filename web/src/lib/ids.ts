/** Random URL-safe id (base64url alphabet). */
export function newId(length = 12): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let id = '';
  for (const b of bytes) id += alphabet[b & 63];
  return id;
}

/** 256-bit secret for authenticating this device with the reminder server. */
export function newToken(): string {
  return newId(43);
}
