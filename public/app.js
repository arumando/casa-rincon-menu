(() => {
  "use strict";

  const $ = (s, el = document) => el.querySelector(s);
  const money = (n) => "$" + Number(n).toLocaleString("es-MX", { maximumFractionDigits: 2 });
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const norm = (s) => String(s).normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const horaDe = (ts) => new Date(ts).toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit" });

  const API = "/api/pedidos";
  const byId = Object.fromEntries(ITEMS.map((i) => [i.id, i]));
  const catById = Object.fromEntries(CATEGORIAS.map((c) => [c.id, c]));
  const PIZZAS = ITEMS.filter((i) => i.tipo === "pizza");
  // En el restaurante los meseros siguen tomando la orden: la app solo recibe pedidos para llevar y a domicilio.
  const TIPOS = { llevar: "Para llevar", domicilio: "A domicilio" };
  const PAGOS = { efectivo: "Efectivo", tarjeta: "Tarjeta", transferencia: "Transferencia" };
  // El QR de las mesas abre el menú con ?mesa: solo para ver, sin carrito.
  const MODO_MESA = new URLSearchParams(location.search).has("mesa");

  // ---------- Estado guardado en el teléfono ----------
  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* nada */ } },
  };
  let cart = store.get("cr-cart", []);
  let orden = Object.assign(
    { tipo: "llevar", nombre: "", tel: "", dir: "", ref: "", pago: "efectivo", pagaCon: "", notas: "" },
    store.get("cr-orden", {})
  );
  if (!TIPOS[orden.tipo]) orden.tipo = "llevar";
  orden.ubic = null; // la ubicación no se guarda: se pide en cada pedido
  let ubicEstado = "";
  let query = "";
  let sheet = null;
  // Pedido en seguimiento: { id, codigo, tipo, msg, enviadoWA }
  let seg = store.get("cr-seguimiento", null);
  let segData = null;
  let segOffset = 0;
  let pollTimer = null;

  const saveCart = () => { store.set("cr-cart", cart); renderBars(); };
  const saveOrden = () => store.set("cr-orden", { ...orden, ubic: undefined });

  // ---------- Datos del menú ----------
  function variantes(i) {
    return i.variantes || [{ nombre: null, precio: i.precio, sabores: i.sabores || null, max: i.max || 1 }];
  }
  function saboresDe(v) {
    if (!v.sabores) return [];
    if (v.sabores === "clasica" || v.sabores === "especialidad") return PIZZAS.filter((p) => p.linea === v.sabores).map((p) => p.nombre);
    return v.sabores;
  }
  function precioDesde(i) {
    if (i.tipo === "pizza") return PRECIOS[i.linea][0];
    return Math.min(...variantes(i).map((v) => v.precio));
  }
  const variosPrecios = (i) => i.tipo === "pizza" || variantes(i).length > 1;
  const itemsDe = (cat) => ITEMS.filter((i) => i.cat === cat);

  // ---------- Vistas: inicio (cuadros), categoría y búsqueda ----------
  const catActual = () => {
    const h = decodeURIComponent(location.hash.slice(1));
    return h.startsWith("cat/") && catById[h.slice(4)] ? h.slice(4) : null;
  };

  function tags(i) {
    return (i.picante ? '<span class="tag hot">Picante</span>' : "") + (i.sinCarne ? '<span class="tag veg">Sin carne</span>' : "");
  }

  function card(i) {
    const media = i.img
      ? `<img src="img/${i.img}" alt="" loading="lazy">`
      : `<div class="ph" aria-hidden="true">${i.icono || "🍕"}</div>`;
    return `<button class="card" data-open="${i.id}">
      ${media}
      <div class="card-body">
        <h3>${esc(i.nombre)}</h3>
        ${i.lema ? `<p class="lema">${esc(i.lema)}</p>` : ""}
        <p class="desc">${esc(i.desc)}</p>
        <div class="card-foot">${tags(i)}<span class="price">${variosPrecios(i) ? "Desde " : ""}${money(precioDesde(i))}</span></div>
      </div>
    </button>`;
  }

  const promo = `<div class="promo"><img src="img/pizza-mitad.jpg" alt="Pizza mitad y mitad"><div><b>Mitad y mitad</b><span>Combina dos sabores sin costo extra · La Gigante hasta 4</span></div></div>`;

  function inicioHtml() {
    const tiles = CATEGORIAS.map((c) => {
      const items = itemsDe(c.id);
      const desde = Math.min(...items.map(precioDesde));
      const media = c.img ? `<img src="img/${c.img}" alt="" loading="lazy">` : `<div class="tile-ph" aria-hidden="true">${c.icono}</div>`;
      return `<a class="tile" href="#cat/${c.id}">${media}
        <div class="tile-text"><b>${esc(c.nombre)}</b><span>${items.length} ${items.length === 1 ? "opción" : "opciones"} · desde ${money(desde)}</span></div></a>`;
    }).join("");
    return `<h2 class="home-title">¿Qué se te antoja?</h2><div class="tiles">${tiles}</div>${promo}`;
  }

  function seccionNota(cat) {
    if (cat === "clasicas" || cat === "especialidades") {
      const p = PRECIOS[cat === "clasicas" ? "clasica" : "especialidad"];
      return `Personal ${money(p[0])} · Grande ${money(p[2])} · La Gigante ${money(p[5])}`;
    }
    return "";
  }

  function categoriaHtml(cat) {
    const nota = seccionNota(cat);
    return `<section class="sec">${nota ? `<p class="sec-note">${nota}</p>` : ""}
      ${cat === "clasicas" || cat === "especialidades" ? promo : ""}
      <div class="grid">${itemsDe(cat).map(card).join("")}</div></section>`;
  }

  function busquedaHtml(q) {
    const html = CATEGORIAS.map((c) => {
      const items = itemsDe(c.id).filter((i) => norm(`${i.nombre} ${i.lema || ""} ${i.desc} ${(i.sabores || []).join(" ")}`).includes(q));
      return items.length ? `<section class="sec"><h2>${esc(c.nombre)}</h2><div class="grid">${items.map(card).join("")}</div></section>` : "";
    }).join("");
    return html || `<p class="empty">No encontramos “${esc(query)}”.</p>`;
  }

  function render() {
    const cat = catActual();
    const q = norm(query.trim());
    const enInicio = !cat && !q;
    $("#hero").hidden = !!cat;
    $("#info").hidden = !enInicio;
    $("#topbar").hidden = !cat;
    $("#cats").hidden = !cat;
    if (cat) {
      $("#topbar").innerHTML = `<a class="back" href="#" aria-label="Volver al menú">‹ Menú</a><h2>${esc(catById[cat].nombre)}</h2>`;
      $("#cats").innerHTML = CATEGORIAS.map((c) =>
        `<a class="cat ${c.id === cat ? "on" : ""}" href="#cat/${c.id}">${esc(c.nombre)}</a>`).join("");
      $(".cat.on")?.scrollIntoView({ block: "nearest", inline: "center" });
    }
    $("#list").innerHTML = q ? busquedaHtml(q) : cat ? categoriaHtml(cat) : inicioHtml();
  }

  // ---------- Pizzas ----------
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

  function pizzaSheet(s) {
    const i = s.item;
    const max = maxSabores(s.size);
    const picker = s.picker
      ? `<div class="picker">${["clasica", "especialidad"].map((l) => `
          <p>${l === "clasica" ? "Clásicas" : "Especialidades"}</p>
          <div class="chips">${PIZZAS.filter((p) => p.linea === l).map((p) =>
            `<button class="chip" data-add-sabor="${p.id}" ${s.sabores.includes(p.id) ? "disabled" : ""}>${esc(p.nombre)}</button>`).join("")}</div>`).join("")}
        </div>`
      : "";
    return `
      ${top()}
      <div class="sheet-body">
        ${foto(i)}
        <h3>Pizza ${esc(i.nombre)}</h3>
        ${i.lema ? `<p class="lema">${esc(i.lema)}</p>` : ""}
        <p class="desc">${esc(i.desc)}</p>

        <h4>Tamaño</h4>
        <div class="opts sizes">${TAMANOS.map((t, ix) => `
          <button class="opt ${ix === s.size ? "on" : ""}" data-size="${ix}">
            <b>${t.nombre}</b><span>${t.reb} rebanadas</span><em>${money(precioPizza(s, ix))}</em>
          </button>`).join("")}</div>

        <h4>Sabores <small>${s.sabores.length} de ${max}</small></h4>
        <div class="chips">${s.sabores.map((id) => `
          <span class="chip on">${esc(byId[id].nombre)}${s.sabores.length > 1 ? `<button class="x" data-rm-sabor="${id}" aria-label="Quitar ${esc(byId[id].nombre)}">×</button>` : ""}</span>`).join("")}</div>
        ${s.sabores.length < max ? `<button class="link" data-picker>${s.picker ? "Cerrar lista de sabores" : s.sabores.length === 1 ? "+ Mitad y mitad: agregar otro sabor" : "+ Agregar otro sabor"}</button>` : ""}
        ${picker}
        <p class="hint">Mitad y mitad sin costo. La Gigante acepta hasta 4 sabores (+${money(EXTRA_SABOR.clasica)} por sabor clásico extra, +${money(EXTRA_SABOR.especialidad)} por especialidad). Si combinas con una especialidad, se cobra precio de especialidad.</p>

        <label class="check"><input type="checkbox" data-orilla ${s.orilla ? "checked" : ""}>
          <span>Orilla rellena de queso Philadelphia</span><b>+${money(ORILLA[s.size])}</b></label>
        <label class="field"><span>Indicaciones (opcional)</span>
          <textarea rows="2" data-notas placeholder="Ej. sin cebolla, bien doradita">${esc(s.notas)}</textarea></label>
      </div>
      ${foot(s, precioPizza(s), true)}`;
  }

  // ---------- Otros productos ----------
  function precioProducto(s) {
    const v = variantes(s.item)[s.v];
    return v.precio + (s.extra >= 0 ? s.item.extras[s.extra].precio : 0);
  }

  function productoSheet(s) {
    const i = s.item;
    const vs = variantes(i);
    const v = vs[s.v];
    const lista = saboresDe(v);
    const max = v.max || 1;
    const falta = lista.length > 0 && s.sabores.length === 0;
    return `
      ${top()}
      <div class="sheet-body">
        ${foto(i)}
        <h3>${esc(i.nombre)}</h3>
        ${i.lema ? `<p class="lema">${esc(i.lema)}</p>` : ""}
        <p class="desc">${esc(i.desc)}</p>
        ${vs.length > 1 ? `<h4>Elige</h4><div class="opts">${vs.map((o, ix) => `
          <button class="opt row ${ix === s.v ? "on" : ""}" data-var="${ix}"><b>${esc(o.nombre)}</b><em>${money(o.precio)}</em></button>`).join("")}</div>` : ""}
        ${lista.length ? `<h4>${max > 1 ? `Sabores <small>hasta ${max}</small>` : "Sabor"}</h4>
          <div class="chips">${lista.map((n) => `<button class="chip ${s.sabores.includes(n) ? "on" : ""}" data-sabor="${esc(n)}">${esc(n)}</button>`).join("")}</div>` : ""}
        ${i.extras ? `<h4>Extras</h4><div class="opts">${i.extras.map((e, ix) => `
          <button class="opt row ${ix === s.extra ? "on" : ""}" data-extra="${ix}"><b>${esc(e.nombre)}</b><em>+${money(e.precio)}</em></button>`).join("")}</div>` : ""}
        <label class="field"><span>Indicaciones (opcional)</span>
          <textarea rows="2" data-notas placeholder="Ej. sin cebolla">${esc(s.notas)}</textarea></label>
      </div>
      ${foot(s, precioProducto(s), !falta, falta ? "Elige un sabor" : null)}`;
  }

  function top() {
    return `<div class="sheet-top"><span class="grab" aria-hidden="true"></span><button class="close" data-close aria-label="Cerrar">×</button></div>`;
  }
  const foto = (i) => (i.img ? `<img class="sheet-img" src="img/${i.img}" alt="${esc(i.nombre)}">` : "");

  function foot(s, precio, ok, porQue) {
    if (MODO_MESA) {
      return `<div class="sheet-foot"><p class="mesa-note">Para pedirlo, llama a tu mesero</p><b>${money(precio)}</b></div>`;
    }
    return `<div class="sheet-foot">
      <div class="stepper"><button data-qty="-1" aria-label="Menos">−</button><span>${s.qty}</span><button data-qty="1" aria-label="Más">+</button></div>
      <button class="primary" data-add ${ok ? "" : "disabled"}><span>${porQue || "Agregar"}</span><span>${money(precio * s.qty)}</span></button>
    </div>`;
  }

  function addFromSheet() {
    const s = sheet;
    let linea;
    if (s.kind === "pizza") {
      const t = TAMANOS[s.size];
      const det = [describeSabores(s.sabores)];
      if (s.orilla) det.push("orilla rellena de Philadelphia");
      if (s.notas.trim()) det.push(`Nota: ${s.notas.trim()}`);
      linea = { nombre: `Pizza ${t.nombre} (${t.reb} reb.)`, detalle: det.join(" · "), precio: precioPizza(s) };
    } else {
      const v = variantes(s.item)[s.v];
      const det = [];
      if (s.sabores.length) det.push(s.sabores.join(" / "));
      if (s.extra >= 0) det.push(s.item.extras[s.extra].nombre.toLowerCase());
      if (s.notas.trim()) det.push(`Nota: ${s.notas.trim()}`);
      linea = { nombre: v.nombre || s.item.nombre, detalle: det.join(" · "), precio: precioProducto(s) };
    }
    linea.qty = s.qty;
    linea.key = Date.now() + Math.random();
    cart.push(linea);
    saveCart();
    closeSheet();
    pulse($("#cartbar"));
  }

  // ---------- Pedido ----------
  const subtotal = () => cart.reduce((a, l) => a + l.precio * l.qty, 0);
  const piezas = () => cart.reduce((a, l) => a + l.qty, 0);
  const mapa = (u) => `https://maps.google.com/?q=${u.lat},${u.lng}`;

  function pedirUbicacion() {
    if (!window.isSecureContext || !navigator.geolocation) {
      ubicEstado = "Aquí no se puede compartir la ubicación. Escribe tu dirección.";
      return renderSheet();
    }
    ubicEstado = "buscando";
    renderSheet();
    navigator.geolocation.getCurrentPosition(
      (p) => {
        orden.ubic = { lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6), acc: Math.round(p.coords.accuracy) };
        ubicEstado = "";
        if (sheet?.kind === "cart") renderSheet();
      },
      (err) => {
        ubicEstado = err.code === 1
          ? "No diste permiso para ver tu ubicación. Puedes escribir tu dirección."
          : "No pudimos obtener tu ubicación. Intenta de nuevo o escribe tu dirección.";
        if (sheet?.kind === "cart") renderSheet();
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  }

  function ubicHtml() {
    const u = orden.ubic;
    if (u) {
      return `<div class="ubic ok"><span class="pin">📍</span><div><b>Ubicación lista</b>
        <small>Precisión aprox. ${u.acc} m · <a href="${mapa(u)}" target="_blank" rel="noopener">Ver en el mapa</a></small>
        ${u.acc > 100 ? '<small class="warn">La precisión es baja: agrega referencias.</small>' : ""}</div>
        <button class="link" data-quitar-ubic>Quitar</button></div>`;
    }
    if (ubicEstado === "buscando") {
      return `<div class="ubic"><span class="pin">📍</span><div><b>Buscando tu ubicación…</b><small>Acepta el permiso si tu celular lo pide.</small></div></div>`;
    }
    return `<button class="ubic-btn" data-ubic>📍 Usar mi ubicación actual</button>
      <p class="hint ${ubicEstado ? "warn" : ""}">${esc(ubicEstado || "Así el repartidor llega directo, sin escribir la dirección.")}</p>`;
  }

  function cartSheet(errores = []) {
    const t = subtotal();
    const paga = Number(orden.pagaCon) || 0;
    const contacto = `<div class="two">
        <label class="field"><span>Nombre</span><input data-f="nombre" value="${esc(orden.nombre)}" autocomplete="name"></label>
        <label class="field"><span>Teléfono</span><input data-f="tel" type="tel" inputmode="tel" value="${esc(orden.tel)}" autocomplete="tel"></label></div>`;
    const entrega = orden.tipo === "domicilio" ? `
        <h4>¿A dónde te lo llevamos?</h4>
        ${ubicHtml()}
        <label class="field"><span>Dirección ${orden.ubic ? "(opcional)" : ""}</span><input data-f="dir" value="${esc(orden.dir)}" autocomplete="street-address" placeholder="Calle, número y colonia"></label>
        <label class="field"><span>Referencias</span><input data-f="ref" value="${esc(orden.ref)}" placeholder="Ej. portón verde, frente a la tienda"></label>` : "";
    return `
      ${top()}
      <div class="sheet-body">
        <h3>Tu pedido</h3>
        ${cart.map((l, ix) => `<div class="line">
            <div class="line-main"><b>${esc(l.nombre)}</b>${l.detalle ? `<small>${esc(l.detalle)}</small>` : ""}<small>${money(l.precio)} c/u</small></div>
            <div class="stepper"><button data-line="${ix}" data-d="-1" aria-label="Menos">−</button><span>${l.qty}</span><button data-line="${ix}" data-d="1" aria-label="Más">+</button></div>
          </div>`).join("")}
        <button class="link" data-close>+ Agregar más cosas</button>

        <h4>¿Cómo lo quieres?</h4>
        <div class="seg">${Object.entries(TIPOS).map(([k, n]) => `<button class="${orden.tipo === k ? "on" : ""}" data-tipo="${k}">${n}</button>`).join("")}</div>
        ${contacto}
        ${entrega}

        <h4>Pago</h4>
        <div class="seg">${Object.entries(PAGOS).map(([k, n]) => `<button class="${orden.pago === k ? "on" : ""}" data-pago="${k}">${n}</button>`).join("")}</div>
        ${orden.pago === "efectivo" ? `<label class="field"><span>¿Con cuánto pagas? (para llevar tu cambio)</span>
          <input data-f="pagaCon" inputmode="decimal" value="${esc(orden.pagaCon)}" placeholder="Ej. 500"></label>
          <p class="hint" id="cambio">${paga > t ? `Tu cambio: ${money(paga - t)}` : ""}</p>` : ""}
        <label class="field"><span>Notas para el restaurante (opcional)</span>
          <textarea rows="2" data-f="notas" placeholder="Ej. sin cubiertos">${esc(orden.notas)}</textarea></label>

        <div class="sum">
          <div class="big"><span>Total</span><span>${money(t)}</span></div>
          ${orden.tipo === "domicilio" ? "<small>El costo de envío se confirma por WhatsApp.</small>" : ""}
          <small>Precios sin IVA. Si necesitas factura, pídela al pagar.</small>
        </div>
        <div class="eta"><span class="clock">⏱️</span><div>
          <b>Te confirmamos el tiempo en vivo</b>
          <small>Todo se hornea al momento. Al recibir tu pedido, el encargado te dice en cuánto estará y lo verás aquí.</small></div></div>
        ${errores.length ? `<ul class="errors">${errores.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : ""}
      </div>
      <div class="sheet-foot">
        <button class="primary" data-enviar><span>Confirmar pedido</span><span>${money(t)}</span></button>
      </div>`;
  }

  function validar() {
    const e = [];
    if (!orden.nombre.trim()) e.push("Escribe tu nombre.");
    if (orden.tel.replace(/\D/g, "").length < 10) e.push("Escribe un teléfono de 10 dígitos.");
    if (orden.tipo === "domicilio" && !orden.ubic && !orden.dir.trim()) e.push("Comparte tu ubicación o escribe tu dirección.");
    if (orden.pago === "efectivo" && orden.pagaCon && Number(orden.pagaCon) < subtotal()) e.push("El efectivo no alcanza para el total.");
    return e;
  }

  function mensaje(codigo) {
    const t = subtotal();
    const L = [`*Nuevo pedido${codigo ? ` #${codigo}` : ""} — ${CONFIG.nombre}*`, `Tipo: ${TIPOS[orden.tipo]}`,
      `Nombre: ${orden.nombre.trim()}`, `Teléfono: ${orden.tel.trim()}`];
    if (orden.tipo === "domicilio") {
      if (orden.ubic) L.push(`Ubicación: ${mapa(orden.ubic)}`);
      if (orden.dir.trim()) L.push(`Dirección: ${orden.dir.trim()}`);
      if (orden.ref.trim()) L.push(`Referencias: ${orden.ref.trim()}`);
    }
    L.push("");
    for (const l of cart) {
      L.push(`${l.qty}× ${l.nombre} — ${money(l.precio * l.qty)}`);
      if (l.detalle) L.push(`   ${l.detalle}`);
    }
    L.push("", `*Total: ${money(t)}* (sin IVA)`);
    if (orden.tipo === "domicilio") L.push("Envío: por confirmar");
    let pago = `Pago: ${PAGOS[orden.pago]}`;
    const paga = Number(orden.pagaCon) || 0;
    if (orden.pago === "efectivo" && paga > t) pago += `, paga con ${money(paga)} (cambio ${money(paga - t)})`;
    L.push(pago);
    if (orden.notas.trim()) L.push(`Notas: ${orden.notas.trim()}`);
    return L.join("\n");
  }

  async function enviar(boton) {
    const errores = validar();
    if (errores.length) {
      sheet = { kind: "cart", errores };
      renderSheet();
      const b = $("#sheet .sheet-body");
      b.scrollTop = b.scrollHeight;
      return;
    }
    boton.disabled = true;
    boton.firstElementChild.textContent = "Enviando…";
    const payload = {
      tipo: orden.tipo, nombre: orden.nombre, tel: orden.tel, dir: orden.dir, ref: orden.ref, ubic: orden.ubic,
      pago: orden.pago, pagaCon: Number(orden.pagaCon) || 0, notas: orden.notas, total: subtotal(),
      lineas: cart.map((l) => ({ qty: l.qty, nombre: l.nombre, detalle: l.detalle, precio: l.precio })),
    };
    let reg = null;
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 8000);
      const r = await fetch(API, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), signal: ctrl.signal });
      clearTimeout(to);
      if (r.ok) reg = await r.json();
    } catch { /* sin servidor: se manda solo por WhatsApp */ }
    seg = { id: reg?.id || null, codigo: reg?.codigo || null, tipo: orden.tipo, msg: mensaje(reg?.codigo), enviadoWA: false };
    store.set("cr-seguimiento", seg);
    segData = null;
    cart = [];
    saveCart();
    sheet = { kind: "seguimiento" };
    renderSheet(true);
    startPolling();
  }

  // ---------- Seguimiento en tiempo real ----------
  const FINALES = ["entregado", "cancelado"];
  const pasosDe = (tipo) => tipo === "domicilio"
    ? [["recibido", "Recibido"], ["preparando", "En el horno"], ["en_camino", "En camino"], ["entregado", "Entregado"]]
    : [["recibido", "Recibido"], ["preparando", "En el horno"], ["listo", "Listo para recoger"], ["entregado", "Entregado"]];
  const ahoraServidor = () => Date.now() + segOffset;
  const minutosRestantes = () => Math.max(0, Math.ceil((segData.listoEn - ahoraServidor()) / 60000));

  function estadoCorto() {
    if (!seg.id) return "Confírmalo por WhatsApp";
    if (!segData) return "Enviado";
    if (segData.estado === "cancelado") return "Cancelado";
    if (segData.estado === "entregado") return "Entregado";
    if (segData.estado === "listo") return "¡Listo para recoger!";
    if (segData.estado === "en_camino") return segData.listoEn ? `En camino · ${minutosRestantes()} min` : "En camino";
    if (!segData.listoEn) return "Esperando confirmación";
    return `${segData.estado === "recibido" ? "Recibido" : "En el horno"} · ${minutosRestantes()} min`;
  }

  function tiempoHtml() {
    if (!seg.id) {
      return `<div class="eta"><span class="clock">💬</span><div><b>Te confirmamos el tiempo por WhatsApp</b>
        <small>Envía tu pedido con el botón de abajo.</small></div></div>`;
    }
    const d = segData;
    if (d && d.estado === "cancelado") {
      return `<div class="eta warn-box"><span class="clock">✖️</span><div><b>Pedido cancelado</b><small>Escríbenos por WhatsApp si tienes dudas.</small></div></div>`;
    }
    if (d && d.estado === "entregado") {
      return `<div class="eta"><span class="clock">🍕</span><div><b>¡Pedido entregado!</b><small>Gracias por pedir en ${esc(CONFIG.nombre)}.</small></div></div>`;
    }
    if (d && d.estado === "listo") {
      return `<div class="eta live"><span class="clock">✅</span><div><b>¡Tu pedido está listo!</b><small>Ya puedes pasar por él.</small></div></div>`;
    }
    if (!d || !d.listoEn) {
      return `<div class="eta live"><span class="dot" aria-hidden="true"></span><div><b>Esperando a que el restaurante confirme el tiempo…</b>
        <small>En cuanto lo confirmen, aparece aquí solo. No cierres esta página.</small></div></div>`;
    }
    const min = minutosRestantes();
    const verbo = seg.tipo === "domicilio" ? "Llega" : "Listo";
    return `<div class="eta live"><span class="big-min">${min > 0 ? min : "¡Ya!"}</span><div>
      <b>${min > 0 ? `${verbo} en ${min} min aprox.` : "En cualquier momento"}</b>
      <small>${verbo} cerca de las ${horaDe(d.listoEn - segOffset)} · actualizado ${horaDe(d.actualizado - segOffset)}</small></div></div>`;
  }

  function seguimientoSheet() {
    const d = segData;
    const estado = d?.estado || "recibido";
    const pasos = pasosDe(seg.tipo);
    const ix = Math.max(0, pasos.findIndex((p) => p[0] === estado));
    const final = FINALES.includes(estado);
    const wa = `https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent(seg.msg)}`;
    return `
      ${top()}
      <div class="sheet-body">
        <div class="done-hero"><div class="big">🍕</div>
          <h3>${seg.codigo ? `Pedido #${esc(seg.codigo)}` : "Pedido listo para enviar"}</h3>
          <p class="hint">${seg.tipo === "domicilio" ? "A domicilio" : "Para llevar"}</p></div>
        ${seg.id && estado !== "cancelado" ? `<ol class="steps">${pasos.map((p, i) =>
          `<li class="${i < ix ? "done" : i === ix ? "now" : ""}">${p[1]}</li>`).join("")}</ol>` : ""}
        ${tiempoHtml()}
        ${!seg.enviadoWA && !final ? `<p class="hint">${seg.id ? "Envíalo también por WhatsApp para que el restaurante tenga tus datos y te confirme el envío." : "Toca el botón para mandar tu pedido al restaurante."}</p>` : ""}
        ${seg.id ? `<p class="demo-note">Demo: <a href="panel.html" target="_blank" rel="noopener">abrir el panel del restaurante</a> para poner el tiempo.</p>` : ""}
      </div>
      <div class="sheet-foot">
        ${final
          ? `<button class="primary" data-nuevo><span>Hacer otro pedido</span></button>`
          : `<a class="primary ${seg.enviadoWA ? "ghost" : ""}" href="${wa}" target="_blank" rel="noopener" data-wa>
              <span>${seg.enviadoWA ? "Escribir al restaurante" : "Enviar por WhatsApp"}</span><span>›</span></a>`}
      </div>`;
  }

  async function poll() {
    if (!seg?.id) return;
    try {
      const r = await fetch(`${API}?id=${encodeURIComponent(seg.id)}`, { cache: "no-store" });
      if (r.ok) {
        segData = await r.json();
        segOffset = segData.ahora - Date.now();
      } else if (r.status === 404) {
        segData = { estado: "cancelado" };
      }
    } catch { /* sin conexión: se reintenta */ }
    if (segData && FINALES.includes(segData.estado)) stopPolling();
    renderBars();
    if (sheet?.kind === "seguimiento") renderSheet();
  }
  function startPolling() {
    stopPolling();
    if (!seg?.id) return;
    poll();
    pollTimer = setInterval(() => { if (document.visibilityState === "visible") poll(); }, 5000);
  }
  function stopPolling() {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && pollTimer) poll(); });

  // ---------- Hoja inferior ----------
  let scrollY = 0;
  function lockScroll() {
    if (document.body.classList.contains("locked")) return;
    scrollY = window.scrollY;
    document.body.style.top = `-${scrollY}px`;
    document.body.classList.add("locked");
  }
  function unlockScroll() {
    if (!document.body.classList.contains("locked")) return;
    document.body.classList.remove("locked");
    document.body.style.top = "";
    window.scrollTo(0, scrollY);
  }

  function openSheet(s) {
    const yaAbierta = !!sheet;
    sheet = s;
    if (!yaAbierta) history.pushState({ sheet: true }, "");
    renderSheet(true);
  }

  function renderSheet(fresh) {
    const el = $("#sheet");
    const prev = el.querySelector(".sheet-body");
    const keep = prev ? prev.scrollTop : 0;
    if (sheet.kind === "pizza") el.innerHTML = pizzaSheet(sheet);
    else if (sheet.kind === "prod") el.innerHTML = productoSheet(sheet);
    else if (sheet.kind === "cart") el.innerHTML = cartSheet(sheet.errores);
    else if (sheet.kind === "seguimiento") el.innerHTML = seguimientoSheet();
    $("#overlay").hidden = false;
    lockScroll();
    const body = el.querySelector(".sheet-body");
    if (body) body.scrollTop = fresh ? 0 : keep;
    renderBars();
  }

  // Cierra la hoja. Si se abrió con historial, regresa un paso (así el botón "atrás" del celular también cierra).
  function closeSheet(desdeHistorial) {
    if (!sheet) return;
    sheet = null;
    $("#overlay").hidden = true;
    unlockScroll();
    renderBars();
    if (!desdeHistorial && history.state?.sheet) history.back();
  }

  function renderBars() {
    const bar = $("#cartbar");
    const n = piezas();
    bar.hidden = n === 0 || MODO_MESA || !!sheet;
    bar.innerHTML = `<span class="count">${n}</span><span>Ver pedido</span><span class="total">${money(subtotal())}</span>`;
    const tb = $("#track");
    tb.hidden = !seg || !!sheet || MODO_MESA;
    if (seg) tb.innerHTML = `<span class="dot" aria-hidden="true"></span><span>${seg.codigo ? `Pedido #${esc(seg.codigo)}` : "Tu pedido"} · ${esc(estadoCorto())}</span><span>›</span>`;
    document.body.classList.toggle("with-track", !tb.hidden);
  }

  function pulse(el) {
    el.animate?.([{ transform: "translateX(-50%) scale(1)" }, { transform: "translateX(-50%) scale(1.04)" }, { transform: "translateX(-50%) scale(1)" }], { duration: 300 });
  }

  function openItem(id) {
    const item = byId[id];
    if (!item) return;
    openSheet(item.tipo === "pizza"
      ? { kind: "pizza", item, size: 2, sabores: [item.id], orilla: false, notas: "", qty: 1, picker: false }
      : { kind: "prod", item, v: 0, sabores: [], extra: -1, notas: "", qty: 1 });
  }

  // ---------- Eventos ----------
  $("#list").addEventListener("click", (e) => {
    const c = e.target.closest("[data-open]");
    if (c) openItem(c.dataset.open);
  });

  window.addEventListener("hashchange", () => {
    query = "";
    $("#q").value = "";
    render();
    window.scrollTo(0, 0);
  });
  window.addEventListener("popstate", () => { if (sheet) closeSheet(true); });

  $("#q").addEventListener("input", (e) => {
    query = e.target.value;
    render();
  });

  $("#cartbar").addEventListener("click", () => openSheet({ kind: "cart", errores: [] }));
  $("#track").addEventListener("click", () => {
    openSheet({ kind: "seguimiento" });
    if (seg?.id && !pollTimer && !FINALES.includes(segData?.estado)) startPolling();
  });

  $("#overlay").addEventListener("click", (e) => { if (e.target.id === "overlay") closeSheet(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && sheet) closeSheet(); });

  $("#sheet").addEventListener("click", (e) => {
    const link = e.target.closest("a[data-wa]");
    if (link && seg) {
      seg.enviadoWA = true;
      store.set("cr-seguimiento", seg);
      setTimeout(() => sheet?.kind === "seguimiento" && renderSheet(), 300);
      return;
    }
    const t = e.target.closest("button");
    if (!t || !sheet) return;
    const d = t.dataset;
    const s = sheet;

    if ("close" in d) return closeSheet();
    if ("add" in d) return addFromSheet();
    if ("qty" in d) { s.qty = Math.max(1, s.qty + Number(d.qty)); return renderSheet(); }

    if (s.kind === "pizza") {
      if ("size" in d) {
        s.size = Number(d.size);
        s.sabores = s.sabores.slice(0, maxSabores(s.size));
      } else if ("picker" in d) {
        s.picker = !s.picker;
      } else if ("addSabor" in d) {
        if (s.sabores.length < maxSabores(s.size)) s.sabores.push(d.addSabor);
        if (s.sabores.length >= maxSabores(s.size)) s.picker = false;
      } else if ("rmSabor" in d) {
        s.sabores = s.sabores.filter((id) => id !== d.rmSabor);
      } else return;
      return renderSheet();
    }

    if (s.kind === "prod") {
      if ("var" in d) {
        s.v = Number(d.var);
        s.sabores = [];
      } else if ("sabor" in d) {
        const max = variantes(s.item)[s.v].max || 1;
        const n = d.sabor;
        if (s.sabores.includes(n)) s.sabores = s.sabores.filter((x) => x !== n);
        else if (max === 1) s.sabores = [n];
        else if (s.sabores.length < max) s.sabores.push(n);
      } else if ("extra" in d) {
        s.extra = s.extra === Number(d.extra) ? -1 : Number(d.extra);
      } else return;
      return renderSheet();
    }

    if (s.kind === "cart") {
      if ("line" in d) {
        const l = cart[Number(d.line)];
        l.qty += Number(d.d);
        if (l.qty <= 0) cart.splice(Number(d.line), 1);
        saveCart();
        if (!cart.length) return closeSheet();
      } else if ("tipo" in d) {
        orden.tipo = d.tipo;
        saveOrden();
      } else if ("pago" in d) {
        orden.pago = d.pago;
        saveOrden();
      } else if ("ubic" in d) {
        return pedirUbicacion();
      } else if ("quitarUbic" in d) {
        orden.ubic = null;
      } else if ("enviar" in d) {
        return enviar(t);
      } else return;
      s.errores = [];
      return renderSheet();
    }

    if (s.kind === "seguimiento" && "nuevo" in d) {
      seg = null;
      segData = null;
      store.del("cr-seguimiento");
      stopPolling();
      closeSheet();
      location.hash = "";
    }
  });

  $("#sheet").addEventListener("change", (e) => {
    if (sheet?.kind === "pizza" && e.target.matches("[data-orilla]")) {
      sheet.orilla = e.target.checked;
      renderSheet();
    }
  });

  $("#sheet").addEventListener("input", (e) => {
    if (!sheet) return;
    if (e.target.matches("[data-notas]")) sheet.notas = e.target.value;
    const f = e.target.dataset.f;
    if (f) {
      orden[f] = e.target.value;
      saveOrden();
      if (f === "pagaCon") {
        const paga = Number(orden.pagaCon) || 0;
        const t = subtotal();
        const c = $("#cambio");
        if (c) c.textContent = paga > t ? `Tu cambio: ${money(paga - t)}` : "";
      }
    }
  });

  // ---------- Inicio ----------
  if (MODO_MESA) {
    $("#hero").insertAdjacentHTML("afterend",
      '<p class="mesa-banner">Estás viendo el menú de mesa. Para ordenar, llama a tu mesero 🙋</p>');
  }
  render();
  renderBars();
  if (seg?.id) startPolling();
})();
