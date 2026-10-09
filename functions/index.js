/**
 * functions/index.js
 * Servidor de STC-innova (Cloud Functions de Firebase).
 *
 * Por qué existe: antes el login entraba a Firebase con una contraseña que
 * NO dependía del PIN (salía del uid y de una clave fija del código) y el PIN
 * se revisaba después, en el teléfono. Con la consola del navegador se podía
 * entrar como otro usuario sin saber su PIN. Además los PIN cifrados estaban en
 * la ficha de cada usuario, que pueden leer todos.
 *
 * Ahora:
 *   - login:        el servidor revisa usuario + PIN (con límite de intentos) y
 *                   entrega un token de acceso de un solo uso.
 *   - cambiarPin:   el propio usuario cambia su PIN (revisa el actual).
 *   - adminPin:     el admin restablece el PIN de alguien.
 *   - crearUsuario: admin o asistente crean un usuario (la cuenta de Firebase
 *                   queda con una contraseña al azar que nadie conoce).
 *   - migrarPines:  el admin pasa todos los PIN a la colección protegida.
 *
 * Los PIN cifrados viven en `pins/{uid}` = { pinHash, pinSalt }. Las reglas de
 * Firestore deben negar todo acceso a `pins` y a `seguridad_intentos` desde
 * la app: solo este servidor (Admin SDK) los lee y escribe.
 *
 * El cálculo del PIN es el mismo de siempre: sha256(salt + pin) en hex.
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const crypto = require('crypto');

admin.initializeApp();
setGlobalOptions({ region: 'us-central1', maxInstances: 5 });

const db = () => admin.firestore();
const FV = FieldValue;

const MAX_FALLOS_USUARIO = 5;     // por usuario, en la ventana
const MAX_FALLOS_IP = 20;         // por conexión, en la ventana
const VENTANA_MS = 15 * 60 * 1000;
const BLOQUEO_MS = 15 * 60 * 1000;
const ROLES = ['admin', 'asistente', 'tecnico'];

const sha256 = t => crypto.createHash('sha256').update(String(t), 'utf8').digest('hex');
const hashPin = (salt, pin) => sha256((salt || '') + pin);
const nuevaSal = () => crypto.randomBytes(32).toString('hex');
const normUsuario = u => String(u || '').trim().toLowerCase();
const pinValido = p => /^\d{4,8}$/.test(String(p || ''));

// Comparación en tiempo constante (no da pistas por cuánto tarda)
function iguales(a, b) {
  const x = Buffer.from(String(a || ''), 'utf8'), y = Buffer.from(String(b || ''), 'utf8');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// ── Límite de intentos ────────────────────────────
async function revisarBloqueo(clave) {
  const d = await db().collection('seguridad_intentos').doc(clave).get();
  const v = d.exists ? d.data() : null;
  if (v && v.bloqueadoHasta && v.bloqueadoHasta > Date.now()) {
    const min = Math.ceil((v.bloqueadoHasta - Date.now()) / 60000);
    throw new HttpsError('resource-exhausted', `Demasiados intentos. Espera ${min} min e intenta de nuevo.`);
  }
}
async function anotarFallo(clave, maximo) {
  const ref = db().collection('seguridad_intentos').doc(clave);
  await db().runTransaction(async tx => {
    const d = await tx.get(ref);
    const ahora = Date.now();
    let v = d.exists ? d.data() : { fallos: 0, desde: ahora };
    if (!v.desde || ahora - v.desde > VENTANA_MS) v = { fallos: 0, desde: ahora };
    v.fallos = (v.fallos || 0) + 1;
    v.ultimo = ahora;
    if (v.fallos >= maximo) { v.bloqueadoHasta = ahora + BLOQUEO_MS; v.fallos = 0; v.desde = ahora; }
    tx.set(ref, v);
  });
}
const limpiarFallos = clave => db().collection('seguridad_intentos').doc(clave).delete().catch(() => {});

// ── PIN guardado de un usuario (colección protegida o, si aún no se migra, su ficha) ──
async function leerPin(uid) {
  const p = await db().collection('pins').doc(uid).get();
  if (p.exists && p.data().pinHash) return { ...p.data(), migrado: true };
  const u = await db().collection('users').doc(uid).get();
  if (u.exists && u.data().pinHash) return { pinHash: u.data().pinHash, pinSalt: u.data().pinSalt || '', migrado: false };
  return null;
}
// Guarda el PIN en `pins` y lo borra de la ficha del usuario (que leen todos)
async function guardarPin(uid, pin, extraUsuario = {}) {
  const salt = nuevaSal();
  const batch = db().batch();
  batch.set(db().collection('pins').doc(uid), { pinHash: hashPin(salt, pin), pinSalt: salt, actualizado: FV.serverTimestamp() });
  batch.set(db().collection('users').doc(uid), { pinHash: FV.delete(), pinSalt: FV.delete(), ...extraUsuario }, { merge: true });
  await batch.commit();
}
async function moverPinLegado(uid, pinHash, pinSalt) {
  const batch = db().batch();
  batch.set(db().collection('pins').doc(uid), { pinHash, pinSalt: pinSalt || '', actualizado: FV.serverTimestamp() });
  batch.set(db().collection('users').doc(uid), { pinHash: FV.delete(), pinSalt: FV.delete() }, { merge: true });
  await batch.commit();
}

// Quién llama (debe haber iniciado sesión y estar activo)
async function quienLlama(req) {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Inicia sesión de nuevo.');
  const u = await db().collection('users').doc(req.auth.uid).get();
  if (!u.exists || u.data().active === false) throw new HttpsError('permission-denied', 'Usuario sin acceso.');
  return { uid: req.auth.uid, ...u.data() };
}

async function uidDeUsuario(username) {
  const d = await db().collection('usernames').doc(username).get();
  if (d.exists && d.data().uid) return d.data().uid;
  const q = await db().collection('users').where('username', '==', username).limit(1).get();
  return q.empty ? null : q.docs[0].id;
}

// ── login ─────────────────────────────────────────
exports.login = onCall(async req => {
  const username = normUsuario(req.data?.username);
  const pin = String(req.data?.pin || '');
  if (!username || !pin) throw new HttpsError('invalid-argument', 'Escribe tu usuario y tu PIN.');

  const ip = String(req.rawRequest?.ip || req.rawRequest?.headers?.['x-forwarded-for'] || 'sin-ip').split(',')[0].trim();
  const claveU = 'u_' + sha256(username), claveIp = 'ip_' + sha256(ip);
  await revisarBloqueo(claveU);
  await revisarBloqueo(claveIp);

  const incorrecto = async () => {
    await Promise.all([anotarFallo(claveU, MAX_FALLOS_USUARIO), anotarFallo(claveIp, MAX_FALLOS_IP)]);
    throw new HttpsError('permission-denied', 'Usuario o PIN incorrecto');
  };

  const uid = await uidDeUsuario(username);
  if (!uid) return incorrecto();
  const userDoc = await db().collection('users').doc(uid).get();
  if (!userDoc.exists) return incorrecto();
  const guardado = await leerPin(uid);
  if (!guardado || !iguales(hashPin(guardado.pinSalt, pin), guardado.pinHash)) return incorrecto();

  const u = userDoc.data();
  if (u.active === false) throw new HttpsError('permission-denied', 'Usuario desactivado');
  if (!ROLES.includes(u.role)) throw new HttpsError('permission-denied', 'Usuario sin rol asignado');

  await limpiarFallos(claveU);
  if (!guardado.migrado) await moverPinLegado(uid, guardado.pinHash, guardado.pinSalt);

  const token = await admin.auth().createCustomToken(uid, { role: u.role });
  return { token };
});

// ── cambiarPin (el propio usuario) ────────────────
exports.cambiarPin = onCall(async req => {
  const yo = await quienLlama(req);
  const actual = String(req.data?.actual || ''), nuevo = String(req.data?.nuevo || '');
  if (!pinValido(nuevo)) throw new HttpsError('invalid-argument', 'El PIN nuevo debe tener de 4 a 8 números.');
  if (nuevo === actual) throw new HttpsError('invalid-argument', 'El PIN nuevo debe ser distinto al actual.');
  const clave = 'c_' + yo.uid;
  await revisarBloqueo(clave);
  const guardado = await leerPin(yo.uid);
  if (!guardado || !iguales(hashPin(guardado.pinSalt, actual), guardado.pinHash)) {
    await anotarFallo(clave, MAX_FALLOS_USUARIO);
    throw new HttpsError('permission-denied', 'El PIN actual no es correcto.');
  }
  await limpiarFallos(clave);
  await guardarPin(yo.uid, nuevo, { pinChanged: true });
  return { ok: true };
});

// ── adminPin (el admin restablece el PIN de alguien) ──
exports.adminPin = onCall(async req => {
  const yo = await quienLlama(req);
  if (yo.role !== 'admin') throw new HttpsError('permission-denied', 'Solo el admin puede cambiar el PIN de otra persona.');
  const uid = String(req.data?.uid || ''), pin = String(req.data?.pin || '');
  if (!uid || !pinValido(pin)) throw new HttpsError('invalid-argument', 'El PIN debe tener de 4 a 8 números.');
  const u = await db().collection('users').doc(uid).get();
  if (!u.exists) throw new HttpsError('not-found', 'No existe ese usuario.');
  await guardarPin(uid, pin);
  return { ok: true };
});

// ── crearUsuario (admin o asistente) ──────────────
exports.crearUsuario = onCall(async req => {
  const yo = await quienLlama(req);
  if (yo.role !== 'admin' && yo.role !== 'asistente') throw new HttpsError('permission-denied', 'No puedes crear usuarios.');
  const username = normUsuario(req.data?.username);
  const displayName = String(req.data?.displayName || '').trim();
  const role = String(req.data?.role || '');
  const pin = String(req.data?.pin || '');
  if (!/^[a-z0-9._-]{2,40}$/.test(username)) throw new HttpsError('invalid-argument', 'El usuario solo puede llevar letras, números, punto, guion y guion bajo.');
  if (!displayName) throw new HttpsError('invalid-argument', 'Escribe el nombre.');
  if (!ROLES.includes(role)) throw new HttpsError('invalid-argument', 'Rol no válido.');
  if (role === 'admin' && yo.role !== 'admin') throw new HttpsError('permission-denied', 'Solo el admin puede crear otro admin.');
  if (!pinValido(pin)) throw new HttpsError('invalid-argument', 'El PIN debe tener de 4 a 8 números.');
  if (await uidDeUsuario(username)) throw new HttpsError('already-exists', 'Ese usuario ya existe.');

  const email = `${username}@innova-stc.internal`;
  let cuenta;
  try {
    // Contraseña al azar que nadie conoce: se entra solo con el token del login
    cuenta = await admin.auth().createUser({ email, password: crypto.randomBytes(24).toString('hex'), displayName });
  } catch (e) {
    if (e.code === 'auth/email-already-exists') throw new HttpsError('already-exists', 'Ese usuario ya existe en el sistema.');
    throw new HttpsError('internal', 'No se pudo crear la cuenta.');
  }
  const uid = cuenta.uid;
  try {
    const salt = nuevaSal();
    const batch = db().batch();
    batch.set(db().collection('users').doc(uid), {
      uid, username, displayName, internalEmail: email, role, active: true,
      asignacionActual: null, usuarioOperativoAsignado: null,
      createdAt: FV.serverTimestamp(), createdBy: yo.uid,
    });
    batch.set(db().collection('pins').doc(uid), { pinHash: hashPin(salt, pin), pinSalt: salt, actualizado: FV.serverTimestamp() });
    batch.set(db().collection('usernames').doc(username), { uid, email });
    await batch.commit();
  } catch (e) {
    await admin.auth().deleteUser(uid).catch(() => {});
    throw new HttpsError('internal', 'No se pudo guardar el usuario.');
  }
  return { uid, email };
});

// ── migrarPines (admin): saca todos los PIN de las fichas de usuario ──
exports.migrarPines = onCall(async req => {
  const yo = await quienLlama(req);
  if (yo.role !== 'admin') throw new HttpsError('permission-denied', 'Solo el admin.');
  const snap = await db().collection('users').get();
  let movidos = 0;
  for (const d of snap.docs) {
    const v = d.data();
    if (!v.pinHash) continue;
    const ya = await db().collection('pins').doc(d.id).get();
    const batch = db().batch();
    if (!ya.exists) batch.set(db().collection('pins').doc(d.id), { pinHash: v.pinHash, pinSalt: v.pinSalt || '', actualizado: FV.serverTimestamp() });
    batch.set(d.ref, { pinHash: FV.delete(), pinSalt: FV.delete() }, { merge: true });
    await batch.commit();
    movidos++;
  }
  return { movidos };
});
