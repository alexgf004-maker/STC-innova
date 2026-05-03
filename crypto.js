/**
 * js/crypto.js
 * Utilidades criptográficas — idénticas a la v1.
 * Sin dependencias externas. Web Crypto API nativa.
 */

// SEED para derivar contraseñas internas — NO cambiar después de crear usuarios
export const SEED = "INNOVA-STC-2024-xK9mP2qR7";

function bufferToHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256(text) {
  const encoded = new TextEncoder().encode(text);
  const hashBuf = await crypto.subtle.digest('SHA-256', encoded);
  return bufferToHex(hashBuf);
}

/**
 * Genera salt aleatorio de 32 bytes.
 * Usar al crear usuario o cambiar PIN.
 */
export function generateSalt() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bufferToHex(bytes.buffer);
}

/**
 * Hashea un PIN con su salt.
 * SHA-256(salt + pin) — orden exacto de la v1.
 * @param {string} salt - Salt hex del usuario (Firestore)
 * @param {string} pin  - PIN ingresado (solo dígitos)
 */
export async function hashPin(salt, pin) {
  return sha256(salt + pin);
}

/**
 * Deriva la contraseña interna de Firebase Auth.
 * SHA-256(uid + seed) — único por usuario.
 * @param {string} uid  - Firebase Auth UID
 * @param {string} seed - SEED del proyecto
 */
export async function derivePassword(uid, seed) {
  return sha256(uid + seed);
}
