# INNOVA STC — Contexto del proyecto

PWA en PRODUCCIÓN usada a diario por técnicos de campo y coordinación de
DELSUR (El Salvador). GitHub Pages: `alexgf004-maker.github.io/STC-innova/`.
Firebase `innova-950ff` (Blaze, plan pago por uso — cuidar el volumen de
lecturas). Usuario principal: David García (admin/Coordinadora).

## Reglas de oro (rotas antes, con costo real — no repetir)

1. **NUNCA copiar-pegar archivos grandes de un lado a otro.** Se truncan a
   mitad y el módulo da "Módulo en desarrollo" sin explicación clara. Si hay
   que mover un archivo grande, usarlo directo desde el repo o entregarlo
   comprimido — nunca pedir/dar el contenido pegado en texto.

2. **JAMÁS un emoji dentro de un archivo `.js` de este proyecto.** Rompe el
   parseo del módulo ES en producción. Antes de terminar cualquier edición,
   verificar que no se coló ningún emoji (ni siquiera un ✓ o ⚠️ heredado de
   una versión anterior).

3. **Verificar SIEMPRE que el archivo sea la versión real de producción**
   antes de editarlo. Hay muchas versiones dando vueltas; trabajar sobre una
   vieja revierte trabajo ya hecho. Si hay duda, pedir el archivo actual, no
   asumir que el que se tiene a mano es el bueno.

4. **Cambios quirúrgicos, uno a la vez, y verificar con diff** que solo se
   tocó lo que se pretendía tocar — nunca reescribir un archivo completo
   "por si acaso".

5. **No experimentar en producción con gente trabajando en campo.** Antes de
   subir un cambio a una vista que usan los técnicos, confirmar si hay
   alguien activo en ese momento. Los cambios de fondo (mapas, Service
   Worker) se hacen con calma, no urgente.

## Patrón de bug real que ya mordió dos veces

Cualquier consulta a la colección `users` que filtre por `pareja`/`destino`
**debe filtrar también por `area`**. `users` es compartida entre las 4
áreas (Cambios, Caracterización, AMI, Reclamos), y cada una puede tener su
propia "Pareja 1", "Pareja 2", etc. Filtrar solo por pareja mezcla gente de
áreas distintas (ej. mostrar como "compañero de hoy" a alguien de otra
campaña). Ya pasó en `mapa.js` (parejaDelDia) y se replicó al clonar a
`ami_mapa.js`. Revisar este patrón en cualquier archivo nuevo que consulte
`users`.

## Arquitectura

```
index.html          shell delgado, SIN CSS embebido (todo el CSS vive en css/styles.css)
css/styles.css       TODO el CSS de la app, incluido el sistema de diseño (ver abajo)
js/
  app.js, auth.js, router.js, ui.js (toast), firebase.js (db), stats.js, sw.js
  views/
    home.js                dashboards (técnico / admin / asistente / Reclamos)
    cambios.js + mapa.js           área Cambios (identificador: WO)
    caracterizacion.js + caracterizacion_mapa.js   instalación + retiro (titular/suplentes)
    ami.js + ami_mapa.js           área AMI (identificador: NC, NO tiene WO)
    reclamos.js             bitácora Reclamos SIGET
    bodega.js, usuarios.js, areas.js
```

XLSX (SheetJS) y Firebase compat son **globales** (`XLSX.utils.*`,
`firebase.firestore.Timestamp.now()`), no se importan como módulos.
`session` trae `role`, `displayName`, `uid`, `asignacionActual:{area,destino}`
(destino = nombre de la pareja). Cada vista exporta `init(container, session)`.

## Las 4 áreas — diferencias clave

| Área | Identificador | Colección órdenes | Notas |
|---|---|---|---|
| Cambios | WO | `cambios_ordenes` | tiene urgentes y "marcar azul" |
| Caracterización | NC | `caracterizacion_ordenes` + `caracterizacion_retiros` | instalación (titular+2 suplentes, cascada de niveles) y retiro son colecciones separadas; el dashboard debe sumar AMBAS |
| AMI | **NC (no WO)** | `ami_ordenes` | ruta diaria (no lista completa como Cambios); tiene sistema de residuos (`fechaRuta`), padrón de "ya cambiados" (`ami_cambiados`), historial (`ami_historial`), metas configurables (`ami_config`) |
| Reclamos | WO+NC | `reclamos_siget` | solo obligatorios: WO, NC, Concepto; el resto opcional |

**Estados reales que escriben los mapas** (usar exactamente estos, no inventar):
- Cambios/AMI: `estadoCampo` = `null` (pendiente) → `'hecha'` → `'aprobada'`
- Caracterización instalación: `estado` = `null` → `'por_confirmar'` → `'confirmada'`
  (NUNCA usa el valor `'hecha'` — es un error común confundirlo con Cambios/AMI)
- Caracterización retiro: `estado` = `null` → `'retirado'` / `'no_retirado'`

## Sistema de diseño (rediseño premium en curso, ir por partes)

CSS con prefijo `ds-` al final de `styles.css` — documentado ahí mismo con
una guía de qué clase usar para qué (tipografía, tarjetas, chips, acciones,
barras). Antes de crear estilos nuevos en una pantalla, revisar si ya existe
la clase `ds-` correspondiente. Regla de estandarización: **reusar clases
existentes** (`estado-badge`, `pareja-chip`) en vez de crear otro sistema de
chips paralelo.

Estilo de referencia: tarjeta premium con degradado (una sola por vista, la
protagonista — no abusar de varias tarjetas con degradado en la misma
pantalla), tipografía fina (peso 500, no 800), mucho aire entre secciones.
Colores de acento por área ya definidos: cm (aqua, Cambios), cr (rojo,
Caracterización), am (morado, AMI), rc (amarillo, Reclamos).

**Legibilidad de campo:** los técnicos trabajan bajo el sol — cualquier
panel de detalle en un mapa necesita alto contraste (blancos, no grises
tenues) y la dirección/dato clave destacado en un recuadro, no en texto
plano. Ya aplicado en los tres mapas.

## Migración de rediseño — estado

Hecho: dashboards (técnico, admin, asistente, Reclamos), login, topbar/navbar,
paneles de detalle de los 3 mapas, botones fijos abajo en el panel de Cambios.
Pendiente cuando se retome: mismo tratamiento de "botones fijos" en AMI y
Caracterización, leyendas/barras de control de los mapas si hace falta más
pulido, listas de órdenes, Bodega, Usuarios.

## Cómo funciona la app en la operación real (contexto de negocio)

**El ciclo general de una orden** (Cambios, AMI): DELSUR entrega un listado
de medidores a cambiar → el admin lo sube a la app → se asigna a cuadrillas
("parejas", 2 técnicos) dibujando un polígono en el mapa o uno por uno →
el técnico ve solo sus puntos, va a cada dirección, marca la orden como
hecha (con posibles pasos intermedios: visita sin éxito, mal ubicado,
pedir ayuda) → el admin/asistente revisa lo marcado y lo confirma/aprueba →
solo entonces cuenta como cerrado del todo.

**Caracterización es más compleja**: cada punto tiene un titular y hasta 2
suplentes (por si el titular no está o no coopera). El técnico intenta
primero con el titular; si no resulta, "revela" al siguiente suplente en
cascada. Al marcar hecha, queda registrado CON QUIÉN se logró (`logranoEn`:
titular/suplente1/suplente2) — importante para trazabilidad. Además de
instalar, hay una campaña paralela de RETIRO de medidores viejos —
son flujos y colecciones separadas que conviene siempre sumar juntas para
cualquier métrica de avance de esa área.

**AMI es distinto a Cambios en el origen del trabajo**: en Cambios, DELSUR
da el listado completo y el equipo decide qué trabajar cuando quiere. En
AMI, DELSUR manda una RUTA DIARIA (~30 puntos) que se espera terminar ESE
día; rara vez se completa, y llega una ruta nueva al día siguiente. De ahí
salen dos necesidades reales del negocio:
  - **Residuos**: lo que quedó pendiente de rutas de días anteriores debe
    distinguirse de la ruta de hoy (campo `fechaRuta` por orden, calculado
    como "arrastrada" si es de un día anterior y sigue sin hacer). Al subir
    una ruta con anticipación (ej. viernes para el sábado), el admin puede
    elegir la fecha real de esa ruta para que no cuente como arrastrada
    antes de tiempo.
  - **Puntos ya cambiados por error**: como varias parejas trabajan zonas
    contiguas, a veces mandan a un técnico a un punto que otra pareja (o
    una campaña anterior) ya resolvió. El asistente lleva un registro
    manual de esto; se sube a un padrón permanente (`ami_cambiados`) que
    cruza automáticamente contra las órdenes: al técnico esos puntos se le
    ESCONDEN del todo (para que nunca vaya), al admin se le muestran en
    verde "Ya cambiada" sin tocar el estado real de trabajo.

**Metas**: cada área tiene una meta diaria de referencia para saber si el
ritmo de trabajo va bien. Cambios y Caracterización la tienen fija en el
código (15 y, para Caracterización, 10 instalaciones + 12 retiros por
separado — llevan metas independientes porque son trabajos distintos). AMI
la tiene configurable por el admin, pareja por pareja, porque el volumen de
la ruta diaria varía.

**Bodega**: los técnicos reciben material (medidores, insumos) y lo van
consumiendo en campo; hay que poder ver existencias, registrar salidas, y
que el material se pueda devolver si sobra. Es transversal a todas las
áreas, no específico de una.

**Reclamos SIGET**: no es una campaña de instalación en campo con mapa —
es una bitácora de órdenes que ya se atendieron por otra vía y hay que
dejar constancia regulatoria (WO, NC, concepto de lo que se hizo). Cada
mes llega un archivo oficial de DELSUR con el detalle completo; ese
archivo debe COMPLETAR (no duplicar) lo que los técnicos ya metieron
día a día con lo mínimo.



- **Service Worker**: cachea de forma agresiva: subir un archivo nuevo no
  siempre llega solo a los teléfonos (hay que reinstalar la PWA a veces).
  Se decidió NO tocarlo sin calma y sin gente trabajando — es el archivo más
  delicado, un error ahí tumba la app para todos.
- **Lecturas de Firebase**: vigilar el volumen (picos grandes cuando varias
  parejas abren la app a la vez en la mañana). El dashboard de admin se
  simplificó a propósito (ya no lee todas las áreas) para no agravarlo.
  
