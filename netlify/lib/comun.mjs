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

export const texto = (v, max) => String(v ?? "").trim().slice(0, max);
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
