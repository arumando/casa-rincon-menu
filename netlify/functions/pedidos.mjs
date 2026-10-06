// API de pedidos.
// - Clientes (sin PIN): registran pedidos para que pasen por ellos o a domicilio, y consultan su estado.
// - Caja y cocina (con PIN): hacen tickets, ven todos los pedidos y los actualizan.
// - Mesas: cada ticket de mesa pertenece a una "cuenta" abierta; se le agregan rondas,
//   se pueden quitar productos y al final se cobra y se cierra toda la cuenta.
import { json, preflight, pinCorrecto, tienda, texto, numero, leerConfig, hoy } from "../lib/comun.mjs";

const ESTADOS = ["recibido", "preparando", "listo", "en_camino", "entregado", "cancelado"];
const VIDA_MS = 36 * 3600 * 1000; // los pedidos se borran después de 36 horas

function token(n) {
  const abc = "abcdefghjkmnpqrstuvwxyz23456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => abc[b % abc.length]).join("");
}

// Número de pedido del día: 1, 2, 3…
async function siguienteCodigo() {
  const store = tienda("contadores");
  const clave = `dia/${hoy()}`;
  const n = ((await store.get(clave, { type: "json" })) || 0) + 1;
  await store.setJSON(clave, n);
  return String(n);
}

// Lo que puede ver el cliente con su enlace de seguimiento (sin datos personales).
const publico = (p) => ({
  codigo: p.codigo,
  tipo: p.tipo,
  estado: p.estado,
  listoEn: p.listoEn,
  creado: p.creado,
  actualizado: p.actualizado,
  ahora: Date.now(),
});

function ubicacion(u) {
  return u && Number.isFinite(u.lat) && Number.isFinite(u.lng) && Math.abs(u.lat) <= 90 && Math.abs(u.lng) <= 180
    ? { lat: u.lat, lng: u.lng, acc: numero(u.acc, 100000) }
    : null;
}

const limpiarLineas = (v) =>
  (Array.isArray(v) ? v.slice(0, 80) : []).map((l) => ({
    qty: Math.max(1, Math.min(99, Math.round(numero(l.qty, 99)))),
    nombre: texto(l.nombre, 80),
    detalle: texto(l.detalle, 300),
    precio: numero(l.precio, 100000),
  }));

// Los totales se calculan aquí, no se confía en los del teléfono.
function recalcular(p) {
  p.subtotal = Math.round(p.lineas.reduce((a, l) => a + l.precio * l.qty, 0) * 100) / 100;
  p.total = p.subtotal + (p.envio || 0);
}

async function todos(store) {
  const { blobs } = await store.list({ prefix: "p/" });
  return (await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })))).filter(Boolean);
}

const cuentaAbierta = (p) => !p.cerrada && p.estado !== "cancelado";

async function nuevoPedido(b, deCaja, cfg, store) {
  const ahora = Date.now();
  const tipos = deCaja ? ["mesa", "llevar", "domicilio"] : ["llevar", "domicilio"];
  const tipo = tipos.includes(b.tipo) ? b.tipo : "llevar";
  const minutos = cfg.tiempo[tipo === "domicilio" ? "domicilio" : "llevar"];
  const mesa = tipo === "mesa" ? texto(b.mesa, 10) : "";
  const id = token(14);

  // Mesa: si ya tiene una cuenta abierta, esta ronda se suma a ella.
  let cuenta = id;
  if (tipo === "mesa") {
    const abiertos = (await todos(store)).filter((p) => p.tipo === "mesa" && cuentaAbierta(p));
    const deCuenta = b.cuenta && abiertos.find((p) => p.cuenta === b.cuenta);
    const deMesa = abiertos.find((p) => p.mesa === mesa);
    cuenta = (deCuenta || deMesa)?.cuenta || id;
  }

  const p = {
    id,
    cuenta,
    codigo: await siguienteCodigo(),
    origen: deCaja ? "caja" : "cliente",
    creado: ahora,
    actualizado: ahora,
    // Llega directo a la pantalla de cocina: ya está en preparación.
    estado: "preparando",
    // El tiempo sale del tiempo general que fijó el encargado; se puede ajustar por pedido.
    listoEn: ahora + minutos * 60000,
    tipo,
    mesa,
    cliente: {
      nombre: texto(b.nombre, 60),
      tel: texto(b.tel, 20),
      dir: texto(b.dir, 200),
      ref: texto(b.ref, 200),
      ubic: ubicacion(b.ubic),
    },
    zona: tipo === "domicilio" && b.zona ? { id: texto(b.zona.id, 30), nombre: texto(b.zona.nombre, 60) } : null,
    lineas: limpiarLineas(b.lineas),
    envio: tipo === "domicilio" ? numero(b.envio, 10000) : 0,
    pago: texto(b.pago, 20),
    pagaCon: numero(b.pagaCon, 1000000),
    pagado: false,
    cerrada: false,
    notas: texto(b.notas, 300),
  };
  recalcular(p);
  return p;
}

const leerCuerpo = async (req) => {
  try {
    return await req.json();
  } catch {
    return null;
  }
};

export default async (req) => {
  if (req.method === "OPTIONS") return preflight();

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const cuenta = url.searchParams.get("cuenta");
  const store = tienda("pedidos");
  const conPin = pinCorrecto(req);

  // Registrar pedido (cliente) o ticket (caja, con PIN)
  if (req.method === "POST") {
    const body = await leerCuerpo(req);
    if (!body) return json({ error: "Pedido inválido" }, 400);
    const cfg = await leerConfig();
    const deCaja = conPin && body.origen === "caja";
    if (!deCaja && !cfg.abierto) return json({ error: "Por ahora no estamos recibiendo pedidos en línea." }, 403);
    const pedido = await nuevoPedido(body, deCaja, cfg, store);
    if (!pedido.lineas.length) return json({ error: "El pedido está vacío" }, 400);
    await store.setJSON(`p/${pedido.id}`, pedido);
    return json({ id: pedido.id, cuenta: pedido.cuenta, codigo: pedido.codigo, listoEn: pedido.listoEn, ahora: Date.now() }, 201);
  }

  // Cliente: consultar estado y tiempo
  if (req.method === "GET" && id) {
    const p = await store.get(`p/${id}`, { type: "json" });
    return p ? json(publico(p)) : json({ error: "No encontrado" }, 404);
  }

  // Caja y cocina: requieren PIN
  if (!conPin) return json({ error: "PIN incorrecto" }, 401);

  if (req.method === "GET") {
    const lista = await todos(store);
    const limite = Date.now() - VIDA_MS;
    await Promise.all(lista.filter((p) => p.creado < limite).map((p) => store.delete(`p/${p.id}`)));
    const pedidos = lista
      .filter((p) => p.creado >= limite)
      .map((p) => ({ cuenta: p.id, cerrada: false, ...p })) // pedidos de versiones anteriores
      .sort((a, b) => b.creado - a.creado);
    return json({ ahora: Date.now(), pedidos });
  }

  // Cobrar y cerrar toda la cuenta de una mesa
  if (req.method === "PATCH" && cuenta) {
    const body = (await leerCuerpo(req)) || {};
    const ahora = Date.now();
    const deCuenta = (await todos(store)).filter((p) => (p.cuenta || p.id) === cuenta);
    if (!deCuenta.length) return json({ error: "No encontrada" }, 404);
    if (body.cerrar) {
      for (const p of deCuenta) {
        p.cerrada = true;
        if (p.estado !== "cancelado") {
          p.pagado = true;
          p.estado = "entregado";
          if (body.pago) p.pago = texto(body.pago, 20);
        }
        p.actualizado = ahora;
        await store.setJSON(`p/${p.id}`, p);
      }
    }
    return json({ ahora, pedidos: deCuenta });
  }

  if (req.method === "PATCH" && id) {
    const p = await store.get(`p/${id}`, { type: "json" });
    if (!p) return json({ error: "No encontrado" }, 404);
    const body = await leerCuerpo(req);
    if (!body) return json({ error: "Cambio inválido" }, 400);
    const ahora = Date.now();
    if (ESTADOS.includes(body.estado)) p.estado = body.estado;
    if (typeof body.pagado === "boolean") p.pagado = body.pagado;
    if (typeof body.minutos === "number" && body.minutos >= 0 && body.minutos <= 240) {
      p.listoEn = ahora + body.minutos * 60000;
    }
    if (typeof body.sumar === "number" && Math.abs(body.sumar) <= 120) {
      p.listoEn = Math.max(ahora, p.listoEn || ahora) + body.sumar * 60000;
    }
    // Quitar un producto (por ejemplo, de una cuenta de mesa abierta)
    if (Number.isInteger(body.quitarLinea) && p.lineas[body.quitarLinea]) {
      p.lineas.splice(body.quitarLinea, 1);
      if (!p.lineas.length) p.estado = "cancelado";
      recalcular(p);
    }
    p.actualizado = ahora;
    await store.setJSON(`p/${p.id}`, p);
    return json({ ahora, pedido: p });
  }

  return json({ error: "Método no permitido" }, 405);
};

export const config = { path: "/api/pedidos" };
