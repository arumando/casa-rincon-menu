// Código compartido por las 4 apps: menú de mesa, pedidos, caja y cocina.
const Core = (() => {
  "use strict";

  // ---------- Utilidades ----------
  const $ = (s, el = document) => el.querySelector(s);
  const money = (n) => "$" + Number(n || 0).toLocaleString("es-MX", { maximumFractionDigits: 2 });
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const norm = (s) => String(s ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const horaDe = (ts) => new Date(ts).toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit" });
  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* nada */ } },
  };

  // ---------- API ----------
  // En Netlify (o `netlify dev` en el puerto 8888) la API está en el mismo sitio;
  // en GitHub Pages o cualquier otro lugar se usa la API de Netlify.
  const mismoSitio = location.hostname.endsWith(".netlify.app") || location.port === "8888";
  const API = mismoSitio ? "" : CONFIG.api;

  let pin = store.get("cr-pin", "");
  const setPin = (p) => { pin = p; store.set("cr-pin", p); };

  async function api(ruta, { method = "GET", body, conPin = false, timeout = 10000 } = {}) {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), timeout);
    try {
      const headers = {};
      if (body) headers["content-type"] = "application/json";
      if (conPin) headers["x-panel-pin"] = pin;
      const r = await fetch(API + ruta, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: "no-store", signal: ctrl.signal });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        const e = new Error(data.error || `Error ${r.status}`);
        e.status = r.status;
        throw e;
      }
      return data;
    } finally {
      clearTimeout(to);
    }
  }

  // ---------- Ajustes del día: tiempo, abierto, agotados ----------
  let estado = store.get("cr-estado", { abierto: true, tiempo: { llevar: 25, domicilio: 45 }, agotados: { ingredientes: [], productos: [] } });
  let offset = 0; // diferencia entre el reloj del servidor y el del teléfono
  const oyentes = new Set();
  const alCambiarEstado = (fn) => oyentes.add(fn);

  function aplicarEstado(e) {
    if (e.ahora) offset = e.ahora - Date.now();
    estado = { abierto: e.abierto, tiempo: e.tiempo, agotados: e.agotados, actualizado: e.actualizado };
    store.set("cr-estado", estado);
    oyentes.forEach((fn) => fn(estado));
  }

  async function cargarEstado() {
    try { aplicarEstado(await api("/api/config")); } catch { /* sin conexión: se usa lo último guardado */ }
    return estado;
  }

  async function cambiarEstado(cambio) {
    aplicarEstado(await api("/api/config", { method: "PATCH", body: cambio, conPin: true }));
  }

  function vigilarEstado(ms = 30000) {
    cargarEstado();
    setInterval(() => { if (document.visibilityState === "visible") cargarEstado(); }, ms);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") cargarEstado(); });
  }

  // ---------- Menú y disponibilidad ----------
  const byId = Object.fromEntries(ITEMS.map((i) => [i.id, i]));
  const PIZZAS = ITEMS.filter((i) => i.tipo === "pizza");
  const pizzaPorNombre = Object.fromEntries(PIZZAS.map((p) => [norm(p.nombre), p]));
  const ingById = Object.fromEntries(INGREDIENTES.map((i) => [i.id, i]));

  // Ingrediente agotado que aparece en un texto (o null).
  function faltaEn(texto) {
    const t = norm(texto);
    for (const id of estado.agotados?.ingredientes || []) {
      const ing = ingById[id];
      if (ing && ing.buscar.some((b) => t.includes(norm(b)))) return ing;
    }
    return null;
  }

  function variantes(i) {
    return i.variantes || [{ nombre: null, precio: i.precio, sabores: i.sabores || null, max: i.max || 1 }];
  }
  function saboresDe(v) {
    if (!v.sabores) return [];
    if (v.sabores === "clasica" || v.sabores === "especialidad") return PIZZAS.filter((p) => p.linea === v.sabores).map((p) => p.nombre);
    return v.sabores;
  }

  const productoApagado = (i) => (estado.agotados?.productos || []).includes(i.id);
  function pizzaDisponible(p) {
    return !productoApagado(p) && !faltaEn(`${p.nombre} ${p.desc}`);
  }
  // Un sabor puede ser una pizza (calzones, rolls…) o un nombre suelto (emparedado, pastas).
  function saborDisponible(nombre) {
    const p = pizzaPorNombre[norm(nombre)];
    return p ? pizzaDisponible(p) : !faltaEn(nombre);
  }
  function varianteDisponible(v) {
    const lista = saboresDe(v);
    return !lista.length || lista.some(saborDisponible);
  }
  function itemDisponible(i) {
    if (productoApagado(i)) return false;
    if (i.tipo === "pizza") return pizzaDisponible(i);
    if (faltaEn(`${i.nombre} ${i.desc}`)) return false;
    return variantes(i).some(varianteDisponible);
  }
  const extraDisponible = (e) => !faltaEn(e.nombre);
  const orillaDisponible = () => !(estado.agotados?.ingredientes || []).includes("philadelphia");

  // ---------- Precios de pizza ----------
  const maxSabores = (size) => (TAMANOS[size].id === "gigante" ? 4 : 2);
  const lineaDe = (sabores) => (sabores.some((id) => byId[id].linea === "especialidad") ? "especialidad" : "clasica");
  function precioPizza(s, size = s.size) {
    const sabores = s.sabores.slice(0, maxSabores(size));
    const extra = sabores.slice(2).reduce((a, id) => a + EXTRA_SABOR[byId[id].linea], 0);
    return PRECIOS[lineaDe(sabores)][size] + extra + (s.orilla ? ORILLA[size] : 0);
  }
  function describeSabores(ids) {
    const n = ids.map((id) => byId[id].nombre);
    if (n.length === 1) return n[0];
    if (n.length === 2) return `Mitad ${n[0]} / mitad ${n[1]}`;
    return `${n.length} sabores: ${n.join(", ")}`;
  }
  function precioDesde(i) {
    if (i.tipo === "pizza") return PRECIOS[i.linea][0];
    return Math.min(...variantes(i).map((v) => v.precio));
  }

  // ---------- Pedidos ----------
  const TIPO_TXT = { mesa: "Mesa", llevar: "Para llevar", domicilio: "A domicilio" };
  const PAGO_TXT = { efectivo: "Efectivo", tarjeta: "Tarjeta", transferencia: "Transferencia" };
  const ESTADO_TXT = { recibido: "Nuevo", preparando: "En el horno", listo: "Listo", en_camino: "En camino", entregado: "Entregado", cancelado: "Cancelado" };
  const FINALES = ["entregado", "cancelado"];
  const zonaPorId = Object.fromEntries(ZONAS.map((z) => [z.id, z]));
  const tipoLargo = (p) => (p.tipo === "mesa" ? `Mesa ${p.mesa || "?"}` : TIPO_TXT[p.tipo] || p.tipo);

  // Ticket para impresora térmica (58/80 mm).
  function imprimirTicket(p) {
    const c = p.cliente || {};
    const paga = Number(p.pagaCon) || 0;
    const filas = (p.lineas || []).map((l) =>
      `<tr><td>${l.qty}×</td><td>${esc(l.nombre)}${l.detalle ? `<div class="det">${esc(l.detalle)}</div>` : ""}</td><td class="r">${money(l.precio * l.qty)}</td></tr>`).join("");
    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Ticket #${esc(p.codigo)}</title>
      <style>
        @page { size: 80mm auto; margin: 4mm; }
        body { font: 12px/1.35 "Courier New", monospace; color: #000; width: 72mm; margin: 0 auto; }
        h1 { font-size: 16px; text-align: center; margin: 0; } p { margin: 2px 0; } .c { text-align: center; }
        table { width: 100%; border-collapse: collapse; margin: 6px 0; } td { vertical-align: top; padding: 2px 0; }
        .r { text-align: right; white-space: nowrap; } .det { font-size: 11px; } .big { font-size: 15px; font-weight: bold; }
        hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
      </style></head><body>
      <h1>${esc(CONFIG.nombre)}</h1><p class="c">${esc(CONFIG.lema)}</p><hr>
      <p class="big">Pedido #${esc(p.codigo)} · ${esc(tipoLargo(p))}</p>
      <p>${new Date(p.creado - offset).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" })}</p>
      ${c.nombre ? `<p>Cliente: ${esc(c.nombre)}${c.tel ? ` · ${esc(c.tel)}` : ""}</p>` : ""}
      ${p.tipo === "domicilio" ? `<p>Zona: ${esc(p.zona?.nombre || "—")}</p>${c.dir ? `<p>${esc(c.dir)}</p>` : ""}${c.ref ? `<p>Ref.: ${esc(c.ref)}</p>` : ""}` : ""}
      <hr><table>${filas}</table><hr>
      ${p.envio ? `<p>Subtotal: <span style="float:right">${money(p.subtotal)}</span></p><p>Envío: <span style="float:right">${money(p.envio)}</span></p>` : ""}
      <p class="big">TOTAL <span style="float:right">${money(p.total)}</span></p>
      <p>Pago: ${esc(PAGO_TXT[p.pago] || p.pago || "")}${p.pago === "efectivo" && paga > p.total ? ` · con ${money(paga)} · cambio ${money(paga - p.total)}` : ""}</p>
      ${p.notas ? `<p>Notas: ${esc(p.notas)}</p>` : ""}
      <hr><p class="c">Precios sin IVA · ¡Gracias por su preferencia!</p>
      </body></html>`;
    const f = document.createElement("iframe");
    f.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
    document.body.appendChild(f);
    f.srcdoc = html;
    f.onload = () => {
      f.contentWindow.focus();
      f.contentWindow.print();
      setTimeout(() => f.remove(), 2000);
    };
  }

  // ---------- Avisos ----------
  let audio = null;
  function prepararAudio() {
    try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); audio.resume?.(); } catch { audio = null; }
  }
  function timbre() {
    if (!audio) return;
    [0, 0.25, 0.5].forEach((t) => {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, audio.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.35, audio.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + t + 0.2);
      o.connect(g).connect(audio.destination);
      o.start(audio.currentTime + t);
      o.stop(audio.currentTime + t + 0.22);
    });
    navigator.vibrate?.([200, 100, 200]);
  }

  function aviso(texto, tipo = "") {
    let t = $("#aviso");
    if (!t) {
      t = document.createElement("div");
      t.id = "aviso";
      t.setAttribute("role", "status");
      document.body.appendChild(t);
    }
    t.className = `aviso ${tipo}`;
    t.textContent = texto;
    t.hidden = false;
    clearTimeout(aviso.t);
    aviso.t = setTimeout(() => { t.hidden = true; }, 3500);
  }

  return {
    $, money, esc, norm, horaDe, store, api, setPin, get pin() { return pin; },
    get estado() { return estado; }, get offset() { return offset; }, set offset(v) { offset = v; },
    cargarEstado, cambiarEstado, vigilarEstado, alCambiarEstado,
    byId, PIZZAS, variantes, saboresDe, faltaEn, itemDisponible, pizzaDisponible, saborDisponible, varianteDisponible,
    extraDisponible, orillaDisponible, maxSabores, precioPizza, describeSabores, precioDesde,
    TIPO_TXT, PAGO_TXT, ESTADO_TXT, FINALES, zonaPorId, tipoLargo, imprimirTicket,
    prepararAudio, timbre, aviso,
  };
})();
