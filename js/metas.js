/**
 * js/metas.js
 * Metas diarias fijas por área, en un solo lugar.
 *
 * Antes el Inicio del técnico y la pantalla de Caracterización tenían cada uno
 * su propia meta (10 y 7 instalaciones) y contaban distinto: el técnico veía
 * números diferentes según la pantalla.
 */

// Caracterización, por pareja y por día. Una instalación cuenta solo si se
// logró en algún punto (titular o suplente): cerrar una orden solo con
// visitas no es instalación. Los retiros cuentan retirados y no retirados.
export const META_CARACT = { instalaciones: 7, retiros: 12 };

/** ¿La orden de Caracterización cuenta como instalación hecha? */
export const instalacionLograda = o => (o.estado === 'por_confirmar' || o.estado === 'confirmada') && !!o.logranoEn;
