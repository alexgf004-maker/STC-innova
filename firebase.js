/**
 * js/firebase.js
 * Inicializa Firebase y exporta las instancias db y auth.
 * Importar desde cualquier módulo que necesite Firebase.
 */

import { SEED } from './crypto.js';

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
export { SEED };
