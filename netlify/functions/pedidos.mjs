// API de pedidos: el cliente registra su pedido y consulta el tiempo;
// el encargado (con PIN) ve los pedidos y actualiza estado y tiempo.
import { getStore } from "@netlify/blobs";

const ESTADOS = ["recibido", "preparando", "listo", "en_camino", "entregado", "cancelado"];
const VIDA_MS = 36 * 3600 * 1000; // los pedidos se borran después de 36 horas

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const pedidosStore = () => getStore({ name: "pedidos", consistency: "strong" });
const pinCorrecto = (req) => req.headers.get("x-panel-pin") === (process.env.PANEL_PIN || "2468");

const texto = (v, max) => String(v ?? "").trim().slice(0, max);
const numero = (v, max) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= max ? Math.round(n * 100) / 100 : 0;
};

function token(n) {
  const abc = "abcdefghjkmnpqrstuvwxyz23456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => abc[b % abc.length]).join("");
}

// Lo que puede ver cualquiera con el enlace de seguimiento (sin datos personales).
const publico = (p) => ({
  codigo: p.codigo,
  tipo: p.tipo,
  estado: p.estado,
  listoEn: p.listoEn,
  creado: p.creado,
  actualizado: p.actualizado,
  ahora: Date.now(),
});

function nuevoPedido(b) {
  const ahora = Date.now();
  const u = b.ubic;
  const ubic =
    u && Number.isFinite(u.lat) && Number.isFinite(u.lng) && Math.abs(u.lat) <= 90 && Math.abs(u.lng) <= 180
      ? { lat: u.lat, lng: u.lng, acc: numero(u.acc, 100000) }
      : null;
  return {
    id: token(14),
    codigo: String(1000 + Math.floor(Math.random() * 9000)),
    creado: ahora,
    actualizado: ahora,
    estado: "recibido",
    listoEn: null,
    tipo: b.tipo === "domicilio" ? "domicilio" : "llevar",
    cliente: {
      nombre: texto(b.nombre, 60),
      tel: texto(b.tel, 20),
      dir: texto(b.dir, 200),
      ref: texto(b.ref, 200),
      ubic,
    },
    lineas: (Array.isArray(b.lineas) ? b.lineas.slice(0, 60) : []).map((l) => ({
      qty: Math.max(1, Math.min(99, Math.round(numero(l.qty, 99)))),
      nombre: texto(l.nombre, 80),
      detalle: texto(l.detalle, 300),
      precio: numero(l.precio, 100000),
    })),
    total: numero(b.total, 1000000),
    pago: texto(b.pago, 20),
    pagaCon: numero(b.pagaCon, 1000000),
    notas: texto(b.notas, 300),
  };
}

export default async (req) => {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const store = pedidosStore();

  // Cliente: registrar pedido
  if (req.method === "POST") {
    let body;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Pedido inválido" }, 400);
    }
    const pedido = nuevoPedido(body || {});
    if (!pedido.lineas.length) return json({ error: "El pedido está vacío" }, 400);
    await store.setJSON(`p/${pedido.id}`, pedido);
    return json({ id: pedido.id, codigo: pedido.codigo }, 201);
  }

  // Cliente: consultar estado y tiempo
  if (req.method === "GET" && id) {
    const p = await store.get(`p/${id}`, { type: "json" });
    return p ? json(publico(p)) : json({ error: "No encontrado" }, 404);
  }

  // Panel del restaurante: requiere PIN
  if (!pinCorrecto(req)) return json({ error: "PIN incorrecto" }, 401);

  if (req.method === "GET") {
    const { blobs } = await store.list({ prefix: "p/" });
    const todos = (await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })))).filter(Boolean);
    const limite = Date.now() - VIDA_MS;
    await Promise.all(todos.filter((p) => p.creado < limite).map((p) => store.delete(`p/${p.id}`)));
    const pedidos = todos.filter((p) => p.creado >= limite).sort((a, b) => b.creado - a.creado);
    return json({ ahora: Date.now(), pedidos });
  }

  if (req.method === "PATCH" && id) {
    const p = await store.get(`p/${id}`, { type: "json" });
    if (!p) return json({ error: "No encontrado" }, 404);
    let body;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Cambio inválido" }, 400);
    }
    const ahora = Date.now();
    if (ESTADOS.includes(body.estado)) p.estado = body.estado;
    if (typeof body.minutos === "number" && body.minutos >= 0 && body.minutos <= 240) {
      p.listoEn = ahora + body.minutos * 60000;
    }
    if (typeof body.sumar === "number" && Math.abs(body.sumar) <= 120) {
      p.listoEn = Math.max(ahora, p.listoEn || ahora) + body.sumar * 60000;
    }
    if (p.estado === "recibido" && p.listoEn) p.estado = "preparando";
    p.actualizado = ahora;
    await store.setJSON(`p/${p.id}`, p);
    return json({ ahora, pedido: p });
  }

  return json({ error: "Método no permitido" }, 405);
};

export const config = { path: "/api/pedidos" };
