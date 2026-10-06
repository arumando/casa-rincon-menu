// Prueba de hora pico: manda muchos pedidos al mismo tiempo y revisa que todo cuadre.
// Uso:  PANEL_PIN=xxxx node pruebas/carga.mjs [cuántos] [url-api]
// Al final cancela los pedidos de prueba para que no se queden en cocina.
const N = Number(process.argv[2] || 10);
const API = process.argv[3] || "https://milpadigital-casa-rincon.netlify.app";
const PIN = process.env.PANEL_PIN;
if (!PIN) throw new Error("Falta PANEL_PIN");

const llamar = async (ruta, { method = "GET", body, pin } = {}) => {
  const t = performance.now();
  const r = await fetch(API + ruta, {
    method,
    headers: { "content-type": "application/json", ...(pin ? { "x-panel-pin": PIN } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json().catch(() => null), ms: Math.round(performance.now() - t) };
};

const pedido = (i) => ({
  tipo: i % 3 === 0 ? "domicilio" : "llevar",
  nombre: `PRUEBA CARGA ${i + 1}`,
  tel: "0000000000",
  dir: i % 3 === 0 ? "Prueba" : "",
  zona: i % 3 === 0 ? { id: "pueblo", nombre: "En el pueblo" } : null,
  envio: i % 3 === 0 ? 5 : 0,
  pago: "efectivo",
  lineas: [{ qty: 1, nombre: "Pizza Hawaiana", detalle: "Mediana", precio: 195 }],
});

console.log(`\nMandando ${N} pedidos al mismo tiempo a ${API} …`);
const t0 = performance.now();
const res = await Promise.all(Array.from({ length: N }, (_, i) => llamar("/api/pedidos", { method: "POST", body: pedido(i) })));
const total = Math.round(performance.now() - t0);

const ok = res.filter((r) => r.status === 201);
const codigos = ok.map((r) => r.data.codigo);
const repetidos = codigos.filter((c, i) => codigos.indexOf(c) !== i);
const tiempos = res.map((r) => r.ms).sort((a, b) => a - b);
console.log(`  Aceptados: ${ok.length}/${N}  (fallidos: ${res.filter((r) => r.status !== 201).map((r) => r.status).join(", ") || "ninguno"})`);
console.log(`  Números de pedido: ${codigos.map(Number).sort((a, b) => a - b).join(", ")}`);
console.log(`  Números repetidos: ${repetidos.length ? [...new Set(repetidos)].join(", ") + "  ❌" : "ninguno ✓"}`);
console.log(`  Respuesta: la más rápida ${tiempos[0]} ms, la más lenta ${tiempos.at(-1)} ms (todo junto ${total} ms)`);

const lista = await llamar("/api/pedidos", { pin: true });
const ids = new Set(lista.data.pedidos.map((p) => p.id));
const perdidos = ok.filter((r) => !ids.has(r.data.id));
console.log(`  En la lista de caja/cocina: ${ok.length - perdidos.length}/${ok.length} ${perdidos.length ? "❌" : "✓"}  (leer la lista tardó ${lista.ms} ms, ${lista.data.pedidos.length} pedidos guardados)`);

// Caja y cocina mueven el mismo pedido al mismo tiempo: no se debe perder ningún cambio.
const uno = ok[0].data.id;
await Promise.all([
  llamar(`/api/pedidos?id=${uno}`, { method: "PATCH", body: { pagado: true }, pin: true }),
  llamar(`/api/pedidos?id=${uno}`, { method: "PATCH", body: { estado: "listo" }, pin: true }),
]);
const visto = (await llamar("/api/pedidos", { pin: true })).data.pedidos.find((p) => p.id === uno);
console.log(`  Dos cambios a la vez al mismo pedido: ${visto.pagado && visto.estado === "listo" ? "se guardaron los dos ✓" : "se perdió uno ❌"}`);

await Promise.all(ok.map((r) => llamar(`/api/pedidos?id=${r.data.id}`, { method: "PATCH", body: { estado: "cancelado" }, pin: true })));
console.log(`  Pedidos de prueba cancelados ✓`);

// Tres tickets para la misma mesa al mismo tiempo: deben quedar en una sola cuenta.
const mesa = await Promise.all(
  [1, 2, 3].map((i) =>
    llamar("/api/pedidos", {
      method: "POST",
      pin: true,
      body: { origen: "caja", tipo: "mesa", mesa: "99", lineas: [{ qty: 1, nombre: `Refresco prueba ${i}`, precio: 30 }] },
    }),
  ),
);
const cuentas = new Set(mesa.map((r) => r.data?.cuenta));
console.log(`  3 tickets a la vez para la Mesa 99: ${cuentas.size === 1 ? "una sola cuenta ✓" : `${cuentas.size} cuentas separadas ❌`}`);
for (const c of cuentas) await llamar(`/api/pedidos?cuenta=${c}`, { method: "PATCH", body: { cerrar: true, pago: "efectivo" }, pin: true });
console.log(`  Mesa 99 de prueba cerrada ✓\n`);
