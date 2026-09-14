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

## Decisiones de diseño específicas (el "por qué" de cómo se ve cada cosa)

Estas son decisiones de gusto/producto ya validadas con el usuario tras
varias iteraciones. No cambiar sin que el usuario lo pida — si algo parece
mejorable, preguntar primero, porque probablemente ya se probó otra forma
y se descartó por una razón concreta.

**Referencia de estilo elegida**: apps tipo fintech premium (Payloop). Se
evaluaron dos referencias (una app fiscal más sobria, y Payloop con tarjeta
de degradado) — el usuario prefirió el estilo Payloop: tarjeta con
degradado y sombra como elemento protagonista, tipografía fina.

**Tipografía**: los números grandes deben ser peso 500 (fino/elegante),
NO 800 (se ve "grueso" y no gustó en la primera iteración). Mucho aire
entre líneas y secciones — el primer intento se sintió "muy cargado" antes
de espaciarlo.

**Regla de "una sola tarjeta premium por vista"**: probamos poner dos
tarjetas con degradado en la misma pantalla (identidad+avance Y la meta) y
se sintió que "competían" visualmente — cansa. Se quedó en UNA protagonista
por vista; lo demás plano/sobrio (`ds-card`, no `ds-pcard`).

**Dashboard del técnico — estructura final acordada** (iterada varias veces,
esta es la versión aprobada):
  1. Tarjeta premium (degradado del color del área) arriba de todo, con:
     nombre del técnico, "Área · Pareja", fecha (badge arriba-derecha),
     LA META DEL DÍA (número grande, barra, "faltan N para la meta"), y
     debajo de una línea divisoria, la cuadrilla en texto ("Con Fulano,
     Mengano") — NO como chips sueltos, NO como sección aparte con título
     "Tu cuadrilla" (se probó y "se veía feo", desencajaba).
  2. Fila de accesos rápidos (Órdenes, Mapa, Bodega, Devolver) — planos,
     sin degradado.
  3. Tarjeta PLANA (`ds-card`, no premium) con el AVANCE TOTAL de la
     campaña (acumulado histórico de la pareja) — barra simple, label
     "Avance total" (nunca decir "avance de hoy" para un número que es el
     acumulado — confunde).
  4. Mini-stats (pendientes/hechas/total) en tarjetas planas.
  Nota: se intentó al revés (avance arriba en la premium, meta abajo
  plana) y el usuario pidió invertirlo — la meta es lo accionable del día,
  merece ser protagonista; el acumulado es solo contexto.

  Caso especial Caracterización: en vez de una barra de meta única, van
  DOS barras dentro de la misma tarjeta premium (Instalaciones X/10,
  Retiros X/12) porque son dos metas independientes.

**Chip de identidad (versión descartada)**: se probó un chip pequeño tipo
píldora ("AMI · Pareja 1") flotando como header separado de la tarjeta —
el usuario dijo "me encanta el chip pero debería estar arriba del todo,
integrado" → de ahí se llegó a fusionarlo dentro de la tarjeta premium
como está ahora. El estilo visual del chip (color de fondo del área al
15% de opacidad, texto en el color sólido del área) SÍ se conservó, solo
cambió dónde vive.

**Dashboard del admin/asistente — simplificado a propósito**: el usuario
pidió explícitamente NO reconstruir el panel viejo (que leía stats de
todas las áreas — caro en lecturas de Firebase). Versión aprobada: tarjeta
premium simple (nombre, rol, fecha, SIN métricas dentro) + accesos directos
en grid 2 columnas agrupados por "Campañas" y "Gestión" + sección "Personal
activo hoy" (sí se pidió explícitamente reincorporar esto, es información
que el admin considera crucial: quién trabaja, en qué área, con quién,
agrupado por área/pareja en chips).

**Reclamos usa el mismo patrón de tarjeta premium** que las demás áreas
(identidad + fecha) pero sin meta/avance porque no aplica a su flujo de
bitácora — solo accesos rápidos debajo.

**Legibilidad de campo (paneles de detalle en los 3 mapas)**: iteración
importante — la primera versión "legible" se pasó de tamaño (letras
gigantes, "se ve feo" fue el feedback). Se ajustó a un punto medio: el
peso real de la legibilidad lo da el CONTRASTE (blanco casi puro sobre
fondo con recuadro semitransparente), no el tamaño de fuente exagerado.
Tamaños finales: NC/WO título ~17px, dirección en recuadro destacado ~13px
peso 500, datos técnicos (medidor/DS/etc.) en grid de tarjetas ~14-15px.

**Botones de acción fijos (sticky) en el panel del mapa**: se pidió
SOLO para Cambios por ahora (no AMI ni Caracterización todavía) porque en
Cambios las direcciones son más largas y el panel scrollea más — el
usuario notó que tenía que hacer scroll para llegar a "Realizada". Técnica:
CSS `:has()` para separar un `.panel-scroll-info` (scrollea) de
`.panel-actions-fixed` (pegado abajo). Es CSS moderno; si algún teléfono
muy viejo no lo soporta, degrada con gracia a scroll normal (no rompe).

**Barra/leyenda de los mapas**: se evaluó rediseñarlas a fondo y se
concluyó que YA estaban bien (blur, buen contraste) — solo se les dio un
pulido de coherencia menor (efecto de escala al tocar, igual que la
navbar; redondeado de esquinas unificado). No vale la pena over-engineer
algo que ya funciona bien.

**Agrupamiento de pines en el mapa (spiderfy/cluster) — PROBADO Y
REVERTIDO**: se implementó con `Leaflet.markercluster` para resolver pines
muy encimados en AMI, pero los TÉCNICOS reportaron que les resultaba
incómodo en campo → se quitó por completo (incluidas las líneas de
`index.html`, que se pueden dejar sin usar, no estorban). En su lugar, el
problema de "no puedo tocar el pin de abajo" se resolvió distinto: al
tocar un punto, si hay varias órdenes dentro de un radio de ~22px en
pantalla, se muestra una LISTA para elegir cuál abrir — sin mover ni
agrupar visualmente ningún pin. Esta es la solución que se queda. No
reintroducir clustering sin que el usuario lo pida de nuevo explícitamente.

**Colores de degradado de tarjeta premium por área** (ya en `ds-pcard`):
cm (Cambios) `#2dd4bf→#1a9e94→#0f5f5a`, cr (Caracterización)
`#f87171→#c2443f→#7a2825`, am (AMI) `#6d54c8→#4f3a9e→#332363`, rc
(Reclamos) `#fbbf24→#d97706→#92590a`, otc/admin `#5b8def→#3f63b0→#26386e`.

**Login**: rediseño solo de CSS (no se tocó el HTML ni la lógica de auth).
Logo con degradado azul-cian (`#3b82f6→#22d3ee`) con sombra, botón de
ingresar sólido con el mismo degradado (antes era outline vacío — se
cambió a sólido para que se sintiera más "premium"/invitante).

## Pendientes de fondo conocidos (no resueltos, anotados a propósito)


- **Service Worker**: cachea de forma agresiva: subir un archivo nuevo no
  siempre llega solo a los teléfonos (hay que reinstalar la PWA a veces).
  Se decidió NO tocarlo sin calma y sin gente trabajando — es el archivo más
  delicado, un error ahí tumba la app para todos.
- **Lecturas de Firebase**: vigilar el volumen (picos grandes cuando varias
  parejas abren la app a la vez en la mañana). El dashboard de admin se
  simplificó a propósito (ya no lee todas las áreas) para no agravarlo.
