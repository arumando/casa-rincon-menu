// Utilidades compartidas por las funciones de la API.
import { getStore } from "@netlify/blobs";

// Las páginas viven en GitHub Pages y llaman a esta API desde otro dominio.
export const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PATCH,OPTIONS",
  "access-control-allow-headers": "content-type,x-panel-pin",
  "access-control-max-age": "86400",
};

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS },
  });

export const preflight = () => new Response(null, { status: 204, headers: CORS });

// Sin PANEL_PIN configurado no se abre ningún panel.
export const pinCorrecto = (req) => {
  const pin = process.env.PANEL_PIN;
  return !!pin && req.headers.get("x-panel-pin") === pin;
};

export const tienda = (name) => getStore({ name, consistency: "strong" });

// Hora pico: varias peticiones pueden querer cambiar el mismo dato en el mismo instante.
// En Netlify Blobs lo único que es seguro con escrituras simultáneas es "créalo solo si no existe"
// (onlyIfNew: gana exactamente una). Con eso se arma un candado: quien lo crea, trabaja; los demás esperan.
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const CANDADO_VENCE_MS = 10000; // si una función se cae con el candado puesto, se libera solo

async function conCandado(store, clave, trabajo) {
  const candado = `candados/${clave}`;
  const limite = Date.now() + 15000;
  while (true) {
    const { modified } = await store.setJSON(candado, { desde: Date.now() }, { onlyIfNew: true });
    if (modified) break;
    const actual = await store.get(candado, { type: "json" });
    if (actual && Date.now() - actual.desde > CANDADO_VENCE_MS) await store.delete(candado);
    if (Date.now() > limite) throw new Error(`Demasiados cambios a la vez en ${clave}`);
    await esperar(20 + Math.random() * 60);
  }
  try {
    return await trabajo();
  } finally {
    await store.delete(candado);
  }
}

// Cambiar un dato sin pisar a otro que lo cambió al mismo tiempo.
// `cambiar(actual)` regresa el valor nuevo, o undefined para no guardar nada.
export const modificar = (store, clave, cambiar) =>
  conCandado(store, clave, async () => {
    const nuevo = await cambiar(await store.get(clave, { type: "json" }));
    if (nuevo !== undefined) await store.setJSON(clave, nuevo);
    return nuevo;
  });

// Número consecutivo que nunca se repite aunque lleguen muchos juntos:
// cada número se "aparta" creando su propia clave; si ya estaba apartado, se prueba el siguiente.
export async function apartarNumero(store, prefijo) {
  const pista = async () => ((await store.get(`${prefijo}/ultimo`, { type: "json" })) || 0) + 1;
  let n = await pista();
  for (let intento = 1; intento <= 500; intento++) {
    const { modified } = await store.setJSON(`${prefijo}/n/${n}`, Date.now(), { onlyIfNew: true });
    if (modified) {
      await store.setJSON(`${prefijo}/ultimo`, n); // solo es una pista para empezar a buscar
      return n;
    }
    // Ocupado: probar el siguiente, y de vez en cuando saltar a lo que otros ya apartaron.
    n = intento % 3 === 0 ? Math.max(n + 1, await pista()) : n + 1;
  }
  throw new Error("No se pudo apartar número");
}

export const texto =(v, max) => String(v ?? "").trim().slice(0, max);
export const numero = (v, max) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= max ? Math.round(n * 100) / 100 : 0;
};

export const CONFIG_INICIAL = {
  abierto: true, // ¿se reciben pedidos en línea?
  tiempo: { llevar: 25, domicilio: 45 }, // minutos, los fija el encargado hasta nuevo aviso
  agotados: { ingredientes: [], productos: [] },
  actualizado: 0,
};

export async function leerConfig() {
  const c = (await tienda("config").get("estado", { type: "json" })) || {};
  return {
    ...CONFIG_INICIAL,
    ...c,
    tiempo: { ...CONFIG_INICIAL.tiempo, ...(c.tiempo || {}) },
    agotados: { ...CONFIG_INICIAL.agotados, ...(c.agotados || {}) },
  };
}

// Fecha del día en Oaxaca, para numerar los pedidos 1, 2, 3… cada día.
export const hoy = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
