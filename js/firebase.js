/**
 * js/firebase.js
 * Inicializa Firebase y exporta las instancias db y auth, y `llamar` para
 * las funciones del servidor (login y PIN, ver functions/index.js).
 * Importar desde cualquier módulo que necesite Firebase.
 */

const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyBAtWI9xoww3hgUAfUtiYtWcUoiqaw3wsg",
  authDomain:        "innova-950ff.firebaseapp.com",
  projectId:         "innova-950ff",
  storageBucket:     "innova-950ff.firebasestorage.app",
  messagingSenderId: "91373826328",
  appId:             "1:91373826328:web:fc266a303eeb78acc26e6d",
};

// Inicializar solo una vez
if (!firebase.apps.length) {
  firebase.initializeApp(FIREBASE_CONFIG);
}

export const db   = firebase.firestore();
export const auth = firebase.auth();

// Persistencia offline — encola escrituras sin señal y sincroniza al volver
db.enablePersistence({ synchronizeTabs: true })
  .catch(err => {
    if (err.code === 'failed-precondition') {
      console.warn('[firebase] Persistencia no disponible: múltiples pestañas abiertas.');
    } else if (err.code === 'unimplemented') {
      console.warn('[firebase] Persistencia no soportada en este navegador.');
    }
  });

// Funciones del servidor. Devuelve lo que responde la función; si falla,
// el error trae `code` ('functions/permission-denied', ...) y un mensaje
// pensado para mostrarse tal cual.
// Están publicadas en dos regiones: primero us-central1 y, si no contesta
// (caída de la región, aún sin publicar), us-east1. Solo se reintenta
// cuando la llamada no llegó a la función, no cuando la función respondió
// con un error suyo (PIN incorrecto, sin permiso...).
const REGIONES = ['us-central1', 'us-east1'].map(r => firebase.app().functions(r));
const NO_LLEGO = ['functions/internal', 'functions/unavailable', 'functions/not-found'];
export async function llamar(nombre, datos) {
  let ultimo;
  for (const f of REGIONES) {
    try {
      return (await f.httpsCallable(nombre)(datos || {})).data;
    } catch (err) {
      ultimo = err;
      if (!NO_LLEGO.includes(String(err?.code || ''))) throw err;
    }
  }
  throw ultimo;
}

// Mensaje para la persona a partir de un error de `llamar`
export function mensajeServidor(err, porDefecto = 'No se pudo completar. Intenta de nuevo.') {
  const code = String(err?.code || '');
  if (code === 'functions/unavailable' || code === 'functions/deadline-exceeded' || !navigator.onLine) return 'Sin conexión. Verifica tu internet.';
  if (code === 'functions/internal' || !err?.message || /^internal$/i.test(err.message)) return porDefecto;
  return err.message;
}
