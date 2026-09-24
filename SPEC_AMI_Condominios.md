# Especificación: Modo Condominios en AMI

Documento para implementar con Claude Code. Leer junto con `CLAUDE.md`
(reglas de oro, estados reales, patrón de bug de parejas por área).

**Estado:** diseño aprobado en conversación. NO construir el importador hasta
tener el Excel real de DELSUR para condominios (ver "Preguntas abiertas").

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

## 10. Preguntas abiertas (resolver antes de construir)

1. ¿Cómo viene el nivel/cuarto en el Excel de DELSUR? (define el importador)
2. ¿Las parejas se reparten por **nivel** o por **edificio** completo?
3. ¿Las órdenes de condominio deben excluirse de la lógica de residuos
   ("arrastradas")? Recomendación: sí.
4. ¿Nivel y cuarto son siempre lo mismo, o hay niveles con más de un cuarto?
5. ¿El número de medidor es visible y legible en el tablero físico? (define
   si el buscador por medidor es el flujo principal)
6. ¿Se requiere foto como evidencia por medidor?

## 11. Plan por fases (cambios quirúrgicos, uno a la vez)

1. **Importador + campos nuevos** (con el Excel real). Verificar
   previsualización con datos reales antes de guardar en producción.
2. **Vista Condominio del técnico** (lista por nivel + marcar individual +
   buscador). Probar con un edificio antes de soltar a campo.
3. **Vista del admin**: progreso por nivel y asignación por nivel/edificio.
4. **Activación de edificio** y exclusión de pines individuales del mapa.

No subir cambios a producción con parejas trabajando en campo. Probar cada
fase con calma antes de pasar a la siguiente.
