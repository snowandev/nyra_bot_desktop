export function base64Of(bytes: Uint8Array) {
  let binary = "";
  // In pieces: one call with a whole file's bytes would pass too many arguments
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export const base64ToBytes = (base64: string) => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
