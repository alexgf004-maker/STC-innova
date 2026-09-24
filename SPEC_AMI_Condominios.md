# Especificación: Modo Condominios en AMI

Documento para implementar con Claude Code. Leer junto con `CLAUDE.md`
(reglas de oro, estados reales, patrón de bug de parejas por área).

**Estado:** diseño aprobado. Decisiones de las preguntas abiertas cerradas el
2026-09-24 (ver sección 10). Sigue bloqueado el arranque de la Fase 1
(importador) hasta tener el **Excel real de DELSUR** para condominios.

---

## 1. Contexto y problema

AMI va a trabajar ~2,000 cambios de medidor en condominios. Estructura física:

- Un condominio tiene varios **edificios**, que se trabajan **uno a la vez**.
- Cada edificio tiene varios **niveles** (ej. 5).
- En cada nivel hay un **cuarto eléctrico** con todos los medidores de ese
  nivel (ej. 20 por cuarto).

Todos los medidores de un edificio comparten prácticamente la misma
coordenada GPS. Consecuencias con el mapa actual:

- Asignar por polígono o por gota es inviable (cientos de pines encimados).
- La lista de gotas encimadas (radio ~22px, ya implementada) se vuelve una
  lista de 100+ órdenes sin orden útil.
- El técnico no puede saber qué le falta de un cuarto específico.

**Conclusión de diseño:** en condominios, la unidad de trabajo deja de ser el
punto en el mapa y pasa a ser el **cuarto eléctrico (nivel)**.

## 2. Principio no negociable: trazabilidad

**Cada medidor sigue siendo una orden individual en `ami_ordenes`.** No se
crean "órdenes de nivel" ni "órdenes de edificio". Así se conserva todo lo
que ya existe sin cambios:

- `hechaPor`, `parejaDelDia`, `fechaHecha` por medidor.
- Confirmación del admin por orden (`estadoCampo: 'aprobada'`,
  `aprobadoPor`, `fechaAprobacion`).
- Padrón de ya cambiados (`ami_cambiados`), historial, buscador por medidor.
- Conteos del dashboard y metas (siguen contando órdenes individuales).

Lo único que cambia es **cómo se navega, se asigna y se visualiza**.

## 3. Jerarquía y datos

| Nivel | Qué es | Uso en la app |
|---|---|---|
| Condominio | El complejo completo | Una sola gota en el mapa |
| Edificio | Cada torre | Se activa uno a la vez |
| Nivel / cuarto | Cuarto eléctrico del nivel | Unidad de asignación a parejas |
| Medidor | La orden individual | Se marca y confirma uno por uno |

**Campos nuevos en cada documento de `ami_ordenes`** (solo para órdenes de
condominio; las órdenes normales de ruta no los tienen):

```
tipoSitio:   'condominio'          // marca que la orden es de condominio
condominio:  'Nombre del complejo' // string, normalizado (trim)
edificio:    'Torre A'             // string
nivel:       '3'                   // string (puede venir "N3", "Nivel 3", "PB")
```

Opcional si el Excel lo trae distinto al nivel: `cuarto` (string).

Ordenar niveles de forma natural (PB/Sótano antes de 1, 2 antes de 10), no
alfabética.

## 4. Importación (esperar Excel real)

Tres escenarios posibles según cómo venga el archivo de DELSUR:

1. **El nivel viene en columna propia** → mapeo directo, caso ideal.
2. **Viene dentro de la dirección** (ej. "Condominio X, Torre A, Nivel 3") →
   se puede extraer con reglas, pero es frágil: mostrar en la
   previsualización cuántas filas NO se pudieron clasificar y no guardar
   esas sin confirmación.
3. **No viene** → agregar columnas al subir (Condominio, Edificio, Nivel).

Reglas del importador:

- Reusar la detección flexible de encabezados del importador actual de rutas
  (`importarRuta` en `ami.js`) y la lógica NC nuevo/existente.
- Previsualización antes de guardar: total, por edificio, por nivel, filas
  sin clasificar.
- Coordenada: usar la del Excel; si todas coinciden por edificio, bien. La
  gota del condominio usa el promedio o la primera coordenada válida.
- Las órdenes de condominio **no deben entrar a la lógica de residuos**
  (`fechaRuta` / "Arrastrada · N días"): es una campaña de semanas, no una
  ruta diaria. Pendiente confirmar con el usuario (ver sección 10).

## 5. Activación de edificio

Como se trabaja un edificio a la vez, el admin marca cuál está **activo**.
Guardar en `ami_config` (ya tiene regla de lectura para activos y escritura
para admin/asistente), por ejemplo documento `ami_config/condominios`:

```
{ activos: ['Condominio X|Torre A'] }
```

Efectos:

- El técnico solo ve órdenes de edificios activos.
- Las consultas pueden filtrar por edificio activo en vez de leer las 2,000
  órdenes: importante para las lecturas de Firebase (ver `CLAUDE.md`).

## 6. Mapa

- Las órdenes con `tipoSitio: 'condominio'` **no se dibujan como pines
  individuales** (excluirlas de `plotMarkers`).
- En su lugar, **una sola gota por condominio** (o por edificio activo), con
  ícono distinto (ej. edificio) y un contador de avance.
- Tocar esa gota abre la **Vista Condominio** (sección 7), no el panel de
  orden normal.
- Las órdenes normales de ruta se siguen viendo exactamente igual.

## 7. Vista Condominio — técnico

Flujo en campo:

1. Toca la gota del condominio en el mapa (o entra desde Órdenes).
2. Ve el edificio activo con sus niveles, cada uno con progreso
   (ej. `Nivel 2 · 14 / 20`).
3. Solo ve los niveles asignados a su pareja (filtro por `pareja`).
4. Entra a un nivel y ve la lista de medidores del cuarto: NC, número de
   medidor, estado.
5. Marca cada medidor con el **mismo flujo existente** de marcar realizada
   (mismos campos, misma `parejaDelDia` filtrada por área).
6. Buscador por número de medidor dentro del edificio (reusar la lógica de
   `buscarPorMedidor`: número antes del primer guion).

Reglas:

- Las órdenes en el padrón de ya cambiados se siguen **ocultando** al
  técnico, igual que hoy.
- **NO incluir un botón de "marcar nivel completo".** Rompe la trazabilidad
  porque no garantiza que cada medidor se cambió. Si se quiere agilizar,
  selección múltiple donde el técnico palomea cada medidor explícitamente, y
  cada uno se guarda como su propia orden con sus propios campos.
- Estilo: seguir el sistema `ds-` y la legibilidad de campo (alto contraste,
  datos clave destacados). Números de medidor grandes y legibles al sol.

## 8. Vista Condominio — admin / asistente

- Progreso por condominio → edificio → nivel → pareja.
- **Asignar un nivel (o un edificio completo) a una pareja** con un toque:
  actualización en lote del campo `pareja` de todas las órdenes de ese
  nivel (batches de 400, igual que el resto del proyecto).
- Permitir repartir niveles de un mismo edificio entre varias parejas.
- Confirmar hechas por nivel en lote es válido: es la aprobación del admin
  sobre órdenes que el técnico ya marcó una por una.
- Activar / desactivar edificio (sección 5).

## 9. Lo que no cambia

- Dashboard del técnico y del admin: siguen contando órdenes individuales,
  no requieren cambio de lógica (verificar que las de edificios inactivos no
  distorsionen el avance del día).
- Reglas de Firestore: el técnico sigue escribiendo solo los campos ya
  permitidos. Los campos nuevos (`condominio`, `edificio`, `nivel`,
  `tipoSitio`) los escribe solo admin/asistente al importar. Si alguna
  función nueva requiere que el técnico escriba otro campo, actualizar la
  regla de `ami_ordenes`.

## 10. Preguntas abiertas (estado al 2026-09-24)

1. **ABIERTA (bloquea Fase 1).** ¿Cómo viene el nivel/cuarto en el Excel de
   DELSUR? Define el importador. No se construye hasta tener el archivo real
   (ver sección 12 con el formato que se le pedirá a DELSUR).
2. **DECIDIDA.** Asignación por **nivel** como unidad fina, con un atajo para
   "asignar edificio completo a una pareja". Permite repartir niveles de un
   mismo edificio entre varias parejas (sección 8).
3. **DECIDIDA: sí.** Las órdenes de condominio se excluyen de la lógica de
   residuos ("arrastradas"): es una campaña de semanas, no ruta diaria.
   `tipoSitio:'condominio'` queda fuera de `esResiduo`/`fechaRuta`.
4. **DECIDIDA.** `cuarto` se deja como campo **opcional** desde el modelo,
   aunque al inicio nivel = cuarto. Evita migrar datos si luego aparece un
   nivel con más de un cuarto.
5. **DECIDIDA: sí, el número de medidor se lee bien** en el tablero físico.
   El **buscador por número de medidor** dentro del edificio es el flujo
   principal del técnico (la lista por nivel queda de apoyo).
6. **DECIDIDA: sin foto por ahora.** Se mantiene el flujo simple; si se
   necesita evidencia fotográfica se diseña aparte (implica almacenamiento).

## 11. Plan por fases (cambios quirúrgicos, uno a la vez)

1. **Importador + campos nuevos** (con el Excel real). Verificar
   previsualización con datos reales antes de guardar en producción.
2. **Vista Condominio del técnico** (lista por nivel + marcar individual +
   buscador). Probar con un edificio antes de soltar a campo.
3. **Vista del admin**: progreso por nivel y asignación por nivel/edificio.
4. **Activación de edificio** y exclusión de pines individuales del mapa.

No subir cambios a producción con parejas trabajando en campo. Probar cada
fase con calma antes de pasar a la siguiente.

## 12. Formato de Excel que necesitamos de DELSUR (para desbloquear Fase 1)

El importador de rutas actual (`importarRuta` en `ami.js`) ya detecta
encabezados de forma flexible (sin distinguir mayúsculas ni tildes) y maneja
NC nuevo/existente. Para condominios, el **escenario ideal (1)** es que el
Excel traiga el nivel en columnas propias. Columnas objetivo:

| Columna | Obligatoria | Va al campo | Notas |
|---|---|---|---|
| NC | sí | `nc` | identificador de la orden (AMI no usa WO) |
| NOMBRE / CLIENTE | no | `cliente` | |
| DIRECCION | no | `direccion` | |
| DS | no | `ds` | |
| MEDIDOR | sí* | `medidor` | *clave del flujo principal del técnico (buscador) |
| LATITUD | no | `latitud` | comparten casi la misma por edificio |
| LONGITUD | no | `longitud` | |
| CONDOMINIO | sí | `condominio` | nombre del complejo (normalizar trim) |
| EDIFICIO | sí | `edificio` | torre; se activa una a la vez |
| NIVEL | sí | `nivel` | admite "PB", "N3", "Nivel 3"; orden natural |
| CUARTO | no | `cuarto` | solo si un nivel tiene más de un cuarto |

Las órdenes importadas así llevan además `tipoSitio:'condominio'` (lo escribe
el importador, no el técnico).

**Si el Excel no puede traer esas columnas**, aplican los escenarios 2 y 3 de
la sección 4 (extraer de la dirección con previsualización de filas sin
clasificar, o capturar Condominio/Edificio/Nivel al subir). En cualquier caso:
previsualización obligatoria antes de guardar (total, por edificio, por nivel,
filas sin clasificar) y no guardar filas sin clasificar sin confirmación.

Lo que hay que conseguir de DELSUR antes de construir: **un archivo real de
ejemplo** (aunque sea de un condominio) para verificar el mapeo con datos
reales.
