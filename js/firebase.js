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
const funciones = firebase.app().functions('us-central1');
export function llamar(nombre, datos) {
  return funciones.httpsCallable(nombre)(datos || {}).then(r => r.data);
}

// Mensaje para la persona a partir de un error de `llamar`
export function mensajeServidor(err, porDefecto = 'No se pudo completar. Intenta de nuevo.') {
  const code = String(err?.code || '');
  if (code === 'functions/unavailable' || code === 'functions/deadline-exceeded' || !navigator.onLine) return 'Sin conexión. Verifica tu internet.';
  if (code === 'functions/internal' || !err?.message || /^internal$/i.test(err.message)) return porDefecto;
  return err.message;
}
