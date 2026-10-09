# Servidor de STC-innova (Cloud Functions)

El login y todo lo del PIN pasan por aquí: el servidor revisa el PIN (con
límite de intentos) y entrega un token de acceso. Así nadie puede entrar como
otro usuario desde la consola del navegador. Detalle en `index.js`.

Funciones: `login`, `cambiarPin`, `adminPin`, `crearUsuario`, `migrarPines`.
Los PIN cifrados viven en la colección `pins` (nadie la lee desde la app).

## Publicación

Se publican solas desde GitHub Actions (`.github/workflows/firebase-funciones.yml`)
cuando cambia algo de `functions/` en `main`, o a mano en Actions → "Publicar
funciones de Firebase" → Run workflow.

Configuración (una sola vez):

1. En Google Cloud Console, proyecto **innova-950ff** → IAM y administración →
   Cuentas de servicio → Crear cuenta de servicio (por ejemplo `github-despliegue`)
   con el rol **Propietario**.
2. En esa cuenta → Claves → Agregar clave → Crear clave nueva → JSON. Se descarga
   un archivo.
3. En GitHub, repositorio STC-innova → Settings → Secrets and variables →
   Actions → New repository secret: nombre `FIREBASE_SERVICE_ACCOUNT`, valor: todo
   el contenido del archivo JSON. Después borrar el archivo de la computadora.

## Probar en local

Con los emuladores de Firebase (no toca producción):

```
cd functions && npm install && cd ..
npx firebase-tools emulators:exec --project demo-innova --only auth,firestore,functions "node prueba.mjs"
```

## Reglas de Firestore

Las colecciones `pins` y `seguridad_intentos` deben quedar cerradas a la app:

```
match /pins/{id} { allow read, write: if false; }
match /seguridad_intentos/{id} { allow read, write: if false; }
```
