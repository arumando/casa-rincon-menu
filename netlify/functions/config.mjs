// Ajustes del día que fija el encargado desde la caja:
// tiempo general de espera, si se reciben pedidos en línea y qué está agotado.
// Cualquiera puede leerlos (las apps los necesitan); solo se cambian con PIN.
import { json, preflight, pinCorrecto, tienda, leerConfig, texto } from "../lib/comun.mjs";

const limpiarLista = (v) =>
  Array.isArray(v) ? [...new Set(v.map((x) => texto(x, 40)).filter(Boolean))].slice(0, 200) : null;

export default async (req) => {
  if (req.method === "OPTIONS") return preflight();

  if (req.method === "GET") return json({ ahora: Date.now(), ...(await leerConfig()) });

  if (req.method === "PATCH") {
    if (!pinCorrecto(req)) return json({ error: "PIN incorrecto" }, 401);
    let body;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Cambio inválido" }, 400);
    }
    const c = await leerConfig();
    if (typeof body.abierto === "boolean") c.abierto = body.abierto;
    for (const tipo of ["llevar", "domicilio"]) {
      const m = Number(body.tiempo?.[tipo]);
      if (Number.isFinite(m) && m >= 5 && m <= 240) c.tiempo[tipo] = Math.round(m);
    }
    const ing = limpiarLista(body.agotados?.ingredientes);
    const prod = limpiarLista(body.agotados?.productos);
    if (ing) c.agotados.ingredientes = ing;
    if (prod) c.agotados.productos = prod;
    c.actualizado = Date.now();
    await tienda("config").setJSON("estado", c);
    return json({ ahora: Date.now(), ...c });
  }

  return json({ error: "Método no permitido" }, 405);
};

export const config = { path: "/api/config" };
