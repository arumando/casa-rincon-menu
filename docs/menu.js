// Menú interactivo. Lo usan tres apps, según <body data-modo="…">:
//   mesa    → QR en las mesas: solo para ver (la orden la toman los meseros)
//   pedidos → clientes: para llevar y a domicilio, con seguimiento en vivo
//   caja    → encargado: arma tickets de todo el menú y los manda a cocina
(() => {
  "use strict";

  const C = Core;
  const { $, money, esc, norm, horaDe, store } = C;
  const MODO = document.body.dataset.modo || "pedidos";
  const MESA = MODO === "mesa";
  const CAJA = MODO === "caja";
  const PEDIDOS = MODO === "pedidos";

  const catById = Object.fromEntries(CATEGORIAS.map((c) => [c.id, c]));
  const TIPOS = CAJA ? { mesa: "Mesa", llevar: "Pasan", domicilio: "A domicilio" } : { llevar: "Pasan", domicilio: "A domicilio" };
  const PAGOS = C.PAGO_TXT;
  const K = (k) => `cr-${MODO}-${k}`;

  // ---------- Estado ----------
  const ORDEN_VACIA = { tipo: CAJA ? "mesa" : "llevar", mesa: "", nombre: "", tel: "", zona: "", dir: "", ref: "", pago: "efectivo", pagaCon: "", notas: "" };
  let cart = store.get(K("cart"), []);
  // El cliente guarda sus datos para la próxima vez; en caja cada ticket empieza limpio.
  let orden = Object.assign({ ...ORDEN_VACIA }, PEDIDOS ? store.get("cr-orden", {}) : {});
  if (!TIPOS[orden.tipo]) orden.tipo = ORDEN_VACIA.tipo;
  orden.ubic = null; // la ubicación no se guarda: se pide en cada pedido
  let ubicEstado = "";
  let query = "";
  let sheet = null;
  let seg = PEDIDOS ? store.get("cr-seguimiento", null) : null; // { id, codigo, tipo, msg, enviadoWA }
  let segData = null;
  let pollTimer = null;
  // Caja: cuando se agregan cosas a la cuenta abierta de una mesa → { cuenta, mesa }
  let destino = null;

  const saveCart = () => { store.set(K("cart"), cart); renderBars(); };
  const saveOrden = () => { if (PEDIDOS) store.set("cr-orden", { ...orden, ubic: undefined }); };
  const abierto = () => C.estado.abierto !== false;
  const minutosDe = (tipo) => C.estado.tiempo?.[tipo === "domicilio" ? "domicilio" : "llevar"] ?? 30;

  // ---------- Vistas: inicio (cuadros), categoría y búsqueda ----------
  const catActual = () => {
    const h = decodeURIComponent(location.hash.slice(1));
    return h.startsWith("cat/") && catById[h.slice(4)] ? h.slice(4) : null;
  };
  const itemsDe = (cat) => ITEMS.filter((i) => i.cat === cat);
  const variosPrecios = (i) => i.tipo === "pizza" || C.variantes(i).length > 1;

  function tags(i) {
    return (i.picante ? '<span class="tag hot">Picante</span>' : "") + (i.sinCarne ? '<span class="tag veg">Sin carne</span>' : "");
  }

  // "Hoy sin chorizo": el platillo se puede pedir, pero se preguntará cómo lo quieren.
  function avisoFalta(i) {
    const f = C.faltantesEn(C.textoItem(i));
    return f.length ? `<span class="tag warn">Hoy sin ${esc(f.map((x) => x.nombre.toLowerCase()).join(", "))}</span>` : "";
  }

  function card(i) {
    const ok = C.itemDisponible(i);
    const media = i.img ? `<img src="img/${i.img}" alt="" loading="lazy">` : `<div class="ph" aria-hidden="true">${i.icono || "🍕"}</div>`;
    return `<button class="card ${ok ? "" : "agotado"}" data-open="${i.id}" ${ok ? "" : 'aria-disabled="true"'}>
      ${media}
      <div class="card-body">
        <h3>${esc(i.nombre)}</h3>
        ${i.lema ? `<p class="lema">${esc(i.lema)}</p>` : ""}
        <p class="desc">${esc(i.desc)}</p>
        <div class="card-foot">${ok ? avisoFalta(i) + tags(i) : '<span class="tag out">Agotado por hoy</span>'}<span class="price">${variosPrecios(i) ? "Desde " : ""}${money(C.precioDesde(i))}</span></div>
      </div>
    </button>`;
  }

  const promo = `<div class="promo"><img src="img/pizza-mitad.jpg" alt="Pizza mitad y mitad"><div><b>Mitad y mitad</b><span>Combina dos sabores sin costo extra · La Gigante hasta 4</span></div></div>`;

  function inicioHtml() {
    const tiles = CATEGORIAS.map((c) => {
      const items = itemsDe(c.id);
      const disp = items.filter(C.itemDisponible);
      const desde = Math.min(...items.map(C.precioDesde));
      const media = c.img ? `<img src="img/${c.img}" alt="" loading="lazy">` : `<div class="tile-ph" aria-hidden="true">${c.icono}</div>`;
      const sub = disp.length ? `${disp.length} ${disp.length === 1 ? "opción" : "opciones"} · desde ${money(desde)}` : "Agotado por hoy";
      return `<a class="tile ${disp.length ? "" : "agotado"}" href="#cat/${c.id}">${media}
        <div class="tile-text"><b>${esc(c.nombre)}</b><span>${sub}</span></div></a>`;
    }).join("");
    return `<h2 class="home-title">${CAJA ? "Nuevo ticket: elige una categoría" : "¿Qué se te antoja?"}</h2><div class="tiles">${tiles}</div>${CAJA ? "" : promo}`;
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
    const items = [...itemsDe(cat)].sort((a, b) => C.itemDisponible(b) - C.itemDisponible(a));
    return `<section class="sec">${nota ? `<p class="sec-note">${nota}</p>` : ""}
      ${!CAJA && (cat === "clasicas" || cat === "especialidades") ? promo : ""}
      <div class="grid">${items.map(card).join("")}</div></section>`;
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
    if ($("#hero")) $("#hero").hidden = !!cat;
    if ($("#info")) $("#info").hidden = !enInicio;
    if ($("#tiempoHoy")) $("#tiempoHoy").hidden = !!cat;
    $("#topbar").hidden = !cat;
    $("#cats").hidden = !cat;
    if (cat) {
      $("#topbar").innerHTML = `<a class="back" href="#" aria-label="Volver a las categorías">‹ ${CAJA ? "Categorías" : "Menú"}</a><h2>${esc(catById[cat].nombre)}</h2>`;
      $("#cats").innerHTML = CATEGORIAS.map((c) => `<a class="cat ${c.id === cat ? "on" : ""}" href="#cat/${c.id}">${esc(c.nombre)}</a>`).join("");
      $(".cat.on")?.scrollIntoView({ block: "nearest", inline: "center" });
    }
    $("#list").innerHTML = q ? busquedaHtml(q) : cat ? categoriaHtml(cat) : inicioHtml();
  }

  // Aviso del tiempo de hoy (solo en pedidos)
  function renderTiempoHoy() {
    const el = $("#tiempoHoy");
    if (!el) return;
    el.innerHTML = abierto()
      ? `<span class="clock">⏱️</span><span>Ahorita: <b>pasan ~${minutosDe("llevar")} min</b> · <b>a domicilio ~${minutosDe("domicilio")} min</b></span>`
      : `<span class="clock">🌙</span><span><b>Por ahora no estamos recibiendo pedidos en línea.</b> Puedes ver el menú.</span>`;
    el.classList.toggle("cerrado", !abierto());
  }

  // ---------- Se acabó un ingrediente: ¿sin él o con otro? ----------
  const ingNombre = (id) => (INGREDIENTES.find((i) => i.id === id)?.nombre || id).toLowerCase();

  function faltantesDeSheet(s) {
    const textos = s.kind === "pizza"
      ? s.sabores.map((id) => C.textoItem(C.byId[id]))
      : [C.textoItem(s.item), ...s.sabores.map(C.textoSabor)];
    const vistos = new Map();
    textos.forEach((t) => C.faltantesEn(t).forEach((i) => vistos.set(i.id, i)));
    for (const k of Object.keys(s.cambios)) if (!vistos.has(k)) delete s.cambios[k];
    return [...vistos.values()];
  }
  const pendientes = (s) => (MESA ? [] : faltantesDeSheet(s).filter((i) => !s.cambios[i.id]));

  function cambiosHtml(s) {
    const faltan = faltantesDeSheet(s);
    if (!faltan.length) return "";
    if (MESA) {
      return `<div class="falta"><p>😕 Hoy se nos acabó <b>${esc(faltan.map((i) => i.nombre.toLowerCase()).join(", "))}</b>. Tu mesero te ofrece cambiarlo por otro ingrediente.</p></div>`;
    }
    return `<div class="falta">${faltan.map((ing) => {
      const elegido = s.cambios[ing.id];
      return `<div class="falta-item"><p>😕 Hoy se nos acabó <b>${esc(ing.nombre.toLowerCase())}</b>. ¿Cómo lo quieres?</p>
        <div class="chips">
          <button class="chip ${elegido === "sin" ? "on" : ""}" data-cambio="${ing.id}" data-por="sin">Sin ${esc(ing.nombre.toLowerCase())}</button>
          ${C.reemplazos(ing.id).map((r) => `<button class="chip ${elegido === r.id ? "on" : ""}" data-cambio="${ing.id}" data-por="${r.id}">Con ${esc(r.nombre.toLowerCase())}</button>`).join("")}
        </div></div>`;
    }).join("")}<p class="hint">Cambiar un ingrediente no tiene costo extra.</p></div>`;
  }

  function textoCambios(s) {
    return faltantesDeSheet(s).map((ing) => {
      const c = s.cambios[ing.id];
      return c === "sin" ? `SIN ${ing.nombre.toLowerCase()}` : `${ing.nombre.toLowerCase()} → ${ingNombre(c)}`;
    });
  }
  const porQueFalta = (s) => {
    const p = pendientes(s);
    return p.length ? `¿Sin ${p[0].nombre.toLowerCase()} o con otro?` : null;
  };
  const sinHoy = (texto) => {
    const f = C.faltantesEn(texto);
    return f.length ? ` · sin ${f.map((x) => x.nombre.toLowerCase()).join(", ")} hoy` : "";
  };

  // ---------- Pizzas ----------
  function pizzaSheet(s) {
    const i = s.item;
    const max = C.maxSabores(s.size);
    const orillaOk = C.orillaDisponible();
    if (!orillaOk) s.orilla = false;
    const picker = s.picker
      ? `<div class="picker">${["clasica", "especialidad"].map((l) => `
          <p>${l === "clasica" ? "Clásicas" : "Especialidades"}</p>
          <div class="chips">${C.PIZZAS.filter((p) => p.linea === l).map((p) => {
            const ok = C.pizzaDisponible(p);
            return `<button class="chip ${ok ? "" : "out"}" data-add-sabor="${p.id}" ${s.sabores.includes(p.id) || !ok ? "disabled" : ""}>${esc(p.nombre)}${ok ? sinHoy(C.textoItem(p)) : " · agotada"}</button>`;
          }).join("")}</div>`).join("")}
        </div>`
      : "";
    return `
      ${top()}
      <div class="sheet-body">
        ${foto(i)}
        <h3>Pizza ${esc(i.nombre)}</h3>
        ${i.lema ? `<p class="lema">${esc(i.lema)}</p>` : ""}
        <p class="desc">${esc(i.desc)}</p>

        <h4>1. Tamaño</h4>
        <div class="opts sizes">${TAMANOS.map((t, ix) => `
          <button class="opt ${ix === s.size ? "on" : ""}" data-size="${ix}">
            <b>${t.nombre}</b><span>${t.reb} rebanadas</span><em>${money(C.precioPizza(s, ix))}</em>
          </button>`).join("")}</div>

        <h4>2. Sabores <small>${s.sabores.length} de ${max}</small></h4>
        <div class="chips">${s.sabores.map((id) => `
          <span class="chip on">${esc(C.byId[id].nombre)}${s.sabores.length > 1 ? `<button class="x" data-rm-sabor="${id}" aria-label="Quitar ${esc(C.byId[id].nombre)}">×</button>` : ""}</span>`).join("")}</div>
        ${s.sabores.length < max ? `<button class="link" data-picker>${s.picker ? "Cerrar lista de sabores" : s.sabores.length === 1 ? "+ Mitad y mitad: agregar otro sabor" : "+ Agregar otro sabor"}</button>` : ""}
        ${picker}
        <p class="hint">Mitad y mitad sin costo. La Gigante acepta hasta 4 sabores (+${money(EXTRA_SABOR.clasica)} por sabor clásico extra, +${money(EXTRA_SABOR.especialidad)} por especialidad). Si combinas con una especialidad, se cobra precio de especialidad.</p>
        ${cambiosHtml(s)}

        <h4>3. Extras</h4>
        <label class="check ${orillaOk ? "" : "off"}"><input type="checkbox" data-orilla ${s.orilla ? "checked" : ""} ${orillaOk ? "" : "disabled"}>
          <span>Orilla rellena de queso Philadelphia${orillaOk ? "" : " · agotada hoy"}</span><b>+${money(ORILLA[s.size])}</b></label>
        <label class="field"><span>Indicaciones (opcional)</span>
          <textarea rows="2" data-notas placeholder="Ej. sin cebolla, bien doradita">${esc(s.notas)}</textarea></label>
      </div>
      ${foot(s, C.precioPizza(s), !pendientes(s).length, porQueFalta(s))}`;
  }

  // ---------- Otros productos ----------
  function precioProducto(s) {
    const v = C.variantes(s.item)[s.v];
    return v.precio + (s.extra >= 0 ? s.item.extras[s.extra].precio : 0);
  }

  function productoSheet(s) {
    const i = s.item;
    const vs = C.variantes(i);
    const v = vs[s.v];
    const lista = C.saboresDe(v);
    const max = v.max || 1;
    const falta = lista.length > 0 && s.sabores.length === 0;
    return `
      ${top()}
      <div class="sheet-body">
        ${foto(i)}
        <h3>${esc(i.nombre)}</h3>
        ${i.lema ? `<p class="lema">${esc(i.lema)}</p>` : ""}
        <p class="desc">${esc(i.desc)}</p>
        ${vs.length > 1 ? `<h4>Elige</h4><div class="opts">${vs.map((o, ix) => {
          const ok = C.varianteDisponible(o);
          return `<button class="opt row ${ix === s.v ? "on" : ""}" data-var="${ix}" ${ok ? "" : "disabled"}><b>${esc(o.nombre)}${ok ? "" : " · agotado"}</b><em>${money(o.precio)}</em></button>`;
        }).join("")}</div>` : ""}
        ${lista.length ? `<h4>${max > 1 ? `Sabores <small>hasta ${max}</small>` : "Sabor"}</h4>
          <div class="chips">${lista.map((n) => {
            const ok = C.saborDisponible(n);
            return `<button class="chip ${s.sabores.includes(n) ? "on" : ""} ${ok ? "" : "out"}" data-sabor="${esc(n)}" ${ok ? "" : "disabled"}>${esc(n)}${ok ? sinHoy(C.textoSabor(n)) : " · agotado"}</button>`;
          }).join("")}</div>` : ""}
        ${cambiosHtml(s)}
        ${i.extras ? `<h4>Extras</h4><div class="opts">${i.extras.map((e, ix) => {
          const ok = C.extraDisponible(e);
          return `<button class="opt row ${ix === s.extra ? "on" : ""}" data-extra="${ix}" ${ok ? "" : "disabled"}><b>${esc(e.nombre)}${ok ? "" : " · agotado"}</b><em>+${money(e.precio)}</em></button>`;
        }).join("")}</div>` : ""}
        <label class="field"><span>Indicaciones (opcional)</span>
          <textarea rows="2" data-notas placeholder="Ej. sin cebolla">${esc(s.notas)}</textarea></label>
      </div>
      ${foot(s, precioProducto(s), !falta && !pendientes(s).length, falta ? "Elige un sabor" : porQueFalta(s))}`;
  }

  function top() {
    return `<div class="sheet-top"><span class="grab" aria-hidden="true"></span><button class="close" data-close aria-label="Cerrar">×</button></div>`;
  }
  const foto = (i) => (i.img ? `<img class="sheet-img" src="img/${i.img}" alt="${esc(i.nombre)}">` : "");

  function foot(s, precio, ok, porQue) {
    if (MESA) {
      return `<div class="sheet-foot"><p class="mesa-note">Para pedirlo, llama a tu mesero</p><b>${money(precio)}</b></div>`;
    }
    return `<div class="sheet-foot">
      <div class="stepper"><button data-qty="-1" aria-label="Menos">−</button><span>${s.qty}</span><button data-qty="1" aria-label="Más">+</button></div>
      <button class="primary" data-add ${ok ? "" : "disabled"}><span>${porQue || (CAJA ? "Agregar al ticket" : "Agregar")}</span><span>${money(precio * s.qty)}</span></button>
    </div>`;
  }

  function addFromSheet() {
    const s = sheet;
    let linea;
    if (s.kind === "pizza") {
      const t = TAMANOS[s.size];
      const det = [C.describeSabores(s.sabores), ...textoCambios(s)];
      if (s.orilla) det.push("orilla rellena de Philadelphia");
      if (s.notas.trim()) det.push(`Nota: ${s.notas.trim()}`);
      linea = { nombre: `Pizza ${t.nombre} (${t.reb} reb.)`, detalle: det.join(" · "), precio: C.precioPizza(s), pizza: s.sabores.slice(), orilla: s.orilla };
    } else {
      const v = C.variantes(s.item)[s.v];
      const det = [];
      if (s.sabores.length) det.push(s.sabores.join(" / "));
      det.push(...textoCambios(s));
      if (s.extra >= 0) det.push(s.item.extras[s.extra].nombre.toLowerCase());
      if (s.notas.trim()) det.push(`Nota: ${s.notas.trim()}`);
      linea = {
        nombre: v.nombre || s.item.nombre, detalle: det.join(" · "), precio: precioProducto(s),
        item: s.item.id, sabores: s.sabores.slice(), extra: s.extra >= 0 ? s.item.extras[s.extra].nombre : null,
      };
    }
    linea.qty = s.qty;
    linea.key = Date.now() + Math.random();
    cart.push(linea);
    saveCart();
    closeSheet();
    pulse($("#cartbar"));
  }

  // ¿Algo del pedido se agotó mientras se armaba?
  function lineaAgotada(l) {
    if (l.pizza) return l.pizza.some((id) => !C.pizzaDisponible(C.byId[id])) || (l.orilla && !C.orillaDisponible());
    const i = C.byId[l.item];
    if (!i) return false;
    return !C.itemDisponible(i) || (l.sabores || []).some((n) => !C.saborDisponible(n)) || (l.extra && !C.extraDisponible({ nombre: l.extra }));
  }

  // ---------- Pedido / ticket ----------
  const subtotal = () => cart.reduce((a, l) => a + l.precio * l.qty, 0);
  const envio = () => (orden.tipo === "domicilio" ? C.zonaPorId[orden.zona]?.costo || 0 : 0);
  const total = () => subtotal() + envio();
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
        <small>Precisión aprox. ${u.acc} m · <a href="${mapa(u)}" target="_blank" rel="noopener">Ver en el mapa</a></small></div>
        <button class="link" data-quitar-ubic>Quitar</button></div>`;
    }
    if (ubicEstado === "buscando") {
      return `<div class="ubic"><span class="pin">📍</span><div><b>Buscando tu ubicación…</b><small>Acepta el permiso si tu celular lo pide.</small></div></div>`;
    }
    return `<button class="ubic-btn" data-ubic>📍 Compartir mi ubicación (opcional)</button>
      ${ubicEstado ? `<p class="hint warn">${esc(ubicEstado)}</p>` : ""}`;
  }

  function cartSheet(errores = []) {
    const paga = Number(orden.pagaCon) || 0;
    const t = total();
    const domicilio = orden.tipo === "domicilio";
    const contacto = CAJA
      ? orden.tipo === "mesa"
        ? `<label class="field"><span>Número de mesa</span><input data-f="mesa" inputmode="numeric" value="${esc(orden.mesa)}" placeholder="Ej. 4"></label>
           <div class="chips mesas">${Array.from({ length: 12 }, (_, n) => `<button class="chip ${orden.mesa === String(n + 1) ? "on" : ""}" data-mesa="${n + 1}">${n + 1}</button>`).join("")}</div>`
        : `<div class="two">
            <label class="field"><span>Nombre ${domicilio ? "" : "(opcional)"}</span><input data-f="nombre" value="${esc(orden.nombre)}"></label>
            <label class="field"><span>Teléfono ${domicilio ? "" : "(opcional)"}</span><input data-f="tel" type="tel" inputmode="tel" value="${esc(orden.tel)}"></label></div>`
      : `<div class="two">
          <label class="field"><span>Tu nombre</span><input data-f="nombre" value="${esc(orden.nombre)}" autocomplete="name"></label>
          <label class="field"><span>Tu teléfono</span><input data-f="tel" type="tel" inputmode="tel" value="${esc(orden.tel)}" autocomplete="tel"></label></div>`;
    const entrega = domicilio ? `
        <h4>¿A dónde lo llevamos?</h4>
        <div class="opts zonas">${ZONAS.map((z) => `<button class="opt row ${orden.zona === z.id ? "on" : ""}" data-zona="${z.id}"><b>${esc(z.nombre)}</b><em>${money(z.costo)}</em></button>`).join("")}</div>
        <label class="field"><span>Dirección</span><input data-f="dir" value="${esc(orden.dir)}" autocomplete="street-address" placeholder="Calle, número o cómo llegar"></label>
        <label class="field"><span>Referencias (opcional)</span><input data-f="ref" value="${esc(orden.ref)}" placeholder="Ej. portón verde, frente a la tienda"></label>
        ${PEDIDOS ? ubicHtml() : ""}` : "";
    const min = minutosDe(orden.tipo);
    return `
      ${top()}
      <div class="sheet-body">
        <h3>${destino ? `Agregar a Mesa ${esc(destino.mesa)}` : CAJA ? "Ticket" : "Tu pedido"}</h3>
        ${cart.map((l, ix) => `<div class="line ${lineaAgotada(l) ? "out" : ""}">
            <div class="line-main"><b>${esc(l.nombre)}</b>${l.detalle ? `<small>${esc(l.detalle)}</small>` : ""}
              <small>${lineaAgotada(l) ? "⚠️ Se agotó: quítalo del pedido" : `${money(l.precio)} c/u`}</small></div>
            <div class="stepper"><button data-line="${ix}" data-d="-1" aria-label="Menos">−</button><span>${l.qty}</span><button data-line="${ix}" data-d="1" aria-label="Más">+</button></div>
          </div>`).join("")}
        <button class="link" data-close>+ Agregar más cosas</button>

        ${destino ? `<div class="eta"><span class="clock">🍽️</span><div><b>Se suma a la cuenta abierta de Mesa ${esc(destino.mesa)}</b>
          <small>Lo nuevo va a cocina como otra ronda; se cobra todo junto al cerrar la mesa.</small></div></div>` : `
        <h4>${CAJA ? "¿Para dónde es?" : "¿Cómo lo quieres?"}</h4>
        <div class="seg">${Object.entries(TIPOS).map(([k, n]) => `<button class="${orden.tipo === k ? "on" : ""}" data-tipo="${k}">${n}</button>`).join("")}</div>
        ${contacto}
        ${entrega}`}

        <h4>Pago</h4>
        <div class="seg">${Object.entries(PAGOS).map(([k, n]) => `<button class="${orden.pago === k ? "on" : ""}" data-pago="${k}">${n}</button>`).join("")}</div>
        ${orden.pago === "efectivo" ? `<label class="field"><span>${CAJA ? "¿Con cuánto paga?" : "¿Con cuánto pagas? (para llevar tu cambio)"}</span>
          <input data-f="pagaCon" inputmode="decimal" value="${esc(orden.pagaCon)}" placeholder="Ej. 500"></label>
          <p class="hint" id="cambio">${paga > t ? `Cambio: ${money(paga - t)}` : ""}</p>` : ""}
        <label class="field"><span>Notas ${CAJA ? "para cocina" : "para el restaurante"} (opcional)</span>
          <textarea rows="2" data-f="notas" placeholder="Ej. sin cubiertos">${esc(orden.notas)}</textarea></label>

        <div class="sum">
          ${domicilio ? `<div><span>Productos</span><span>${money(subtotal())}</span></div>
            <div><span>Envío${orden.zona ? ` · ${esc(C.zonaPorId[orden.zona].nombre)}` : ""}</span><span>${orden.zona ? money(envio()) : "elige zona"}</span></div>` : ""}
          <div class="big"><span>Total</span><span>${money(t)}</span></div>
          <small>Precios sin IVA.${CAJA ? "" : " Si necesitas factura, pídela al pagar."}</small>
        </div>
        ${PEDIDOS ? `<div class="eta"><span class="clock">⏱️</span><div>
          <b>${domicilio ? "Llega" : "Listo"} en ~${min} min</b>
          <small>Es el tiempo de espera de ahorita. Lo verás actualizarse en vivo al confirmar.</small></div></div>` : ""}
        ${errores.length ? `<ul class="errors">${errores.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : ""}
      </div>
      <div class="sheet-foot">
        <button class="primary" data-enviar ${PEDIDOS && !abierto() ? "disabled" : ""}>
          <span>${CAJA ? "Mandar a cocina" : abierto() ? `Pedir (~${min} min)` : "No recibimos pedidos ahorita"}</span><span>${money(t)}</span></button>
      </div>`;
  }

  function validar() {
    const e = [];
    if (cart.some(lineaAgotada)) e.push("Hay algo agotado en el pedido: quítalo para continuar.");
    if (CAJA && orden.tipo === "mesa" && !orden.mesa.trim()) e.push("Escribe el número de mesa.");
    if (!CAJA || orden.tipo === "domicilio") {
      if (!orden.nombre.trim()) e.push("Escribe el nombre.");
      if (orden.tel.replace(/\D/g, "").length < 10) e.push("Escribe un teléfono de 10 dígitos.");
    }
    if (orden.tipo === "domicilio") {
      if (!orden.zona) e.push("Elige la zona de entrega.");
      if (!orden.dir.trim() && !orden.ubic) e.push("Escribe la dirección o comparte tu ubicación.");
    }
    if (orden.pago === "efectivo" && orden.pagaCon && Number(orden.pagaCon) < total()) e.push("El efectivo no alcanza para el total.");
    return e;
  }

  function mensaje(codigo) {
    const t = total();
    const L = [`*Nuevo pedido${codigo ? ` #${codigo}` : ""} — ${CONFIG.nombre}*`, `Tipo: ${TIPOS[orden.tipo]}`,
      `Nombre: ${orden.nombre.trim()}`, `Teléfono: ${orden.tel.trim()}`];
    if (orden.tipo === "domicilio") {
      L.push(`Zona: ${C.zonaPorId[orden.zona]?.nombre || "—"}`);
      if (orden.dir.trim()) L.push(`Dirección: ${orden.dir.trim()}`);
      if (orden.ref.trim()) L.push(`Referencias: ${orden.ref.trim()}`);
      if (orden.ubic) L.push(`Ubicación: ${mapa(orden.ubic)}`);
    }
    L.push("");
    for (const l of cart) {
      L.push(`${l.qty}× ${l.nombre} — ${money(l.precio * l.qty)}`);
      if (l.detalle) L.push(`   ${l.detalle}`);
    }
    if (orden.tipo === "domicilio") L.push("", `Envío: ${money(envio())}`);
    L.push(`*Total: ${money(t)}* (sin IVA)`);
    let pago = `Pago: ${PAGOS[orden.pago]}`;
    const paga = Number(orden.pagaCon) || 0;
    if (orden.pago === "efectivo" && paga > t) pago += `, paga con ${money(paga)} (cambio ${money(paga - t)})`;
    L.push(pago);
    if (orden.notas.trim()) L.push(`Notas: ${orden.notas.trim()}`);
    return L.join("\n");
  }

  function payload() {
    return {
      origen: CAJA ? "caja" : "cliente",
      tipo: orden.tipo, mesa: orden.mesa, nombre: orden.nombre, tel: orden.tel, dir: orden.dir, ref: orden.ref, ubic: orden.ubic,
      zona: orden.tipo === "domicilio" ? { id: orden.zona, nombre: C.zonaPorId[orden.zona]?.nombre } : null,
      pago: orden.pago, pagaCon: Number(orden.pagaCon) || 0, notas: orden.notas,
      subtotal: subtotal(), envio: envio(), total: total(), cuenta: destino?.cuenta || null,
      lineas: cart.map((l) => ({ qty: l.qty, nombre: l.nombre, detalle: l.detalle, precio: l.precio })),
    };
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
    const datos = payload();
    let reg;
    try {
      reg = await C.api("/api/pedidos", { method: "POST", body: datos, conPin: CAJA });
    } catch (e) {
      sheet = { kind: "cart", errores: [e.status === 401 ? "Tu sesión de caja expiró: vuelve a entrar con el PIN." : e.message === "Failed to fetch" || e.name === "AbortError" ? "Sin conexión. Revisa el internet e intenta de nuevo." : e.message] };
      if (e.status === 403) C.cargarEstado();
      return renderSheet();
    }
    C.offset = reg.ahora - Date.now();

    if (CAJA) {
      const ticket = { ...datos, id: reg.id, codigo: reg.codigo, creado: reg.ahora, cliente: { nombre: datos.nombre, tel: datos.tel, dir: datos.dir, ref: datos.ref } };
      const sumado = datos.tipo === "mesa" && reg.cuenta !== reg.id;
      cart = [];
      orden = { ...ORDEN_VACIA, ubic: null };
      destino = null;
      renderDestino();
      saveCart();
      sheet = { kind: "ticketListo", ticket, sumado };
      renderSheet(true);
      document.dispatchEvent(new CustomEvent("ticket-enviado", { detail: { tipo: datos.tipo } }));
      return;
    }

    seg = { id: reg.id, codigo: reg.codigo, tipo: orden.tipo, msg: mensaje(reg.codigo), enviadoWA: false };
    store.set("cr-seguimiento", seg);
    segData = { estado: "preparando", listoEn: reg.listoEn, actualizado: reg.ahora, ahora: reg.ahora };
    cart = [];
    saveCart();
    sheet = { kind: "seguimiento" };
    renderSheet(true);
    startPolling();
  }

  function ticketListoSheet(s) {
    const t = s.ticket;
    return `${top()}
      <div class="sheet-body">
        <div class="done-hero"><div class="big">👨‍🍳</div><h3>#${esc(t.codigo)} enviado a cocina</h3>
          <p class="hint">${esc(C.tipoLargo(t))} · ${money(t.total)}${s.sumado ? " · se sumó a la cuenta abierta de la mesa" : ""}</p>
          ${t.tipo === "mesa" ? '<p class="hint">La cuenta de la mesa sigue abierta en la pestaña “Mesas” para agregar más o cobrar.</p>' : ""}</div>
      </div>
      <div class="sheet-foot">
        <button class="secondary" data-imprimir>🖨️ ${t.tipo === "mesa" ? "Comanda" : "Ticket"}</button>
        <button class="primary" data-nuevo-ticket><span>Nuevo ticket</span><span>›</span></button>
      </div>`;
  }

  // ---------- Bienvenida: avisar el tiempo antes de pedir ----------
  function bienvenidaSheet() {
    if (!abierto()) {
      return `${top()}<div class="sheet-body"><div class="done-hero"><div class="big">🌙</div>
        <h3>Por ahora no recibimos pedidos en línea</h3>
        <p class="hint">Puedes ver el menú. Vuelve más tarde o llámanos.</p></div></div>
        <div class="sheet-foot"><button class="primary" data-close><span>Ver el menú</span><span>›</span></button></div>`;
    }
    return `${top()}<div class="sheet-body"><div class="done-hero"><div class="big">⏱️</div>
        <h3>Ahorita el tiempo de espera es de:</h3></div>
        <div class="espera">
          <div><span>Pasan</span><b>~${minutosDe("llevar")} min</b></div>
          <div><span>A domicilio</span><b>~${minutosDe("domicilio")} min</b></div>
        </div>
        <p class="hint c">Todo se hornea al momento. ¿Seguimos con tu pedido?</p></div>
      <div class="sheet-foot">
        <button class="secondary" data-luego>Ahora no</button>
        <button class="primary" data-close><span>Sí, ver el menú</span><span>›</span></button>
      </div>`;
  }

  // ---------- Seguimiento en tiempo real ----------
  const pasosDe = (tipo) => tipo === "domicilio"
    ? [["recibido", "Recibido"], ["preparando", "En el horno"], ["listo", "Listo"], ["en_camino", "En camino"], ["entregado", "Entregado"]]
    : [["recibido", "Recibido"], ["preparando", "En el horno"], ["listo", "Listo para recoger"], ["entregado", "Entregado"]];
  const ahoraServidor = () => Date.now() + C.offset;
  const minutosRestantes = () => Math.max(0, Math.ceil((segData.listoEn - ahoraServidor()) / 60000));
  const faltan = () => (minutosRestantes() > 0 ? `${minutosRestantes()} min` : "ya casi");

  function estadoCorto() {
    if (!segData) return "Enviado";
    const e = segData.estado;
    if (e === "cancelado") return "Cancelado";
    if (e === "entregado") return "Entregado";
    if (e === "listo") return seg.tipo === "domicilio" ? "Listo, sale pronto" : "¡Listo para recoger!";
    if (e === "en_camino") return `En camino · ${faltan()}`;
    return `${e === "recibido" ? "Recibido" : "En el horno"} · ${faltan()}`;
  }

  function tiempoHtml() {
    const d = segData;
    if (d?.estado === "cancelado") return `<div class="eta warn-box"><span class="clock">✖️</span><div><b>Pedido cancelado</b><small>Escríbenos por WhatsApp si tienes dudas.</small></div></div>`;
    if (d?.estado === "entregado") return `<div class="eta"><span class="clock">🍕</span><div><b>¡Pedido entregado!</b><small>Gracias por pedir en ${esc(CONFIG.nombre)}.</small></div></div>`;
    if (d?.estado === "listo" && seg.tipo !== "domicilio") return `<div class="eta live"><span class="clock">✅</span><div><b>¡Tu pedido está listo!</b><small>Ya puedes pasar por él.</small></div></div>`;
    if (!d?.listoEn) return `<div class="eta live"><span class="dot" aria-hidden="true"></span><div><b>Recibimos tu pedido</b><small>En un momento te mostramos el tiempo.</small></div></div>`;
    const min = minutosRestantes();
    const verbo = seg.tipo === "domicilio" ? "Llega" : "Listo";
    return `<div class="eta live"><span class="big-min">${min > 0 ? min : "¡Ya!"}</span><div>
      <b>${min > 0 ? `${verbo} en ${min} min aprox.` : "Ya casi está"}</b>
      <small>${verbo} cerca de las ${horaDe(d.listoEn - C.offset)} · se actualiza solo</small></div></div>`;
  }

  function seguimientoSheet() {
    const estado = segData?.estado || "recibido";
    const pasos = pasosDe(seg.tipo);
    const ix = Math.max(0, pasos.findIndex((p) => p[0] === estado));
    const final = C.FINALES.includes(estado);
    const wa = `https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent(seg.msg)}`;
    return `
      ${top()}
      <div class="sheet-body">
        <div class="done-hero"><div class="big">🍕</div>
          <h3>Pedido #${esc(seg.codigo)}</h3>
          <p class="hint">${seg.tipo === "domicilio" ? "A domicilio" : "Pasan"}</p></div>
        ${estado !== "cancelado" ? `<ol class="steps">${pasos.map((p, i) => `<li class="${i < ix ? "done" : i === ix ? "now" : ""}">${p[1]}</li>`).join("")}</ol>` : ""}
        ${tiempoHtml()}
        ${!seg.enviadoWA && !final ? `<p class="hint">Mándalo también por WhatsApp para que el restaurante tenga tus datos a la mano.</p>` : ""}
      </div>
      <div class="sheet-foot">
        ${final
          ? `<button class="primary" data-nuevo><span>Hacer otro pedido</span><span>›</span></button>`
          : `<a class="primary ${seg.enviadoWA ? "ghost" : ""}" href="${wa}" target="_blank" rel="noopener" data-wa>
              <span>${seg.enviadoWA ? "Escribir al restaurante" : "Enviar por WhatsApp"}</span><span>›</span></a>`}
      </div>`;
  }

  async function poll() {
    if (!seg?.id) return;
    try {
      segData = await C.api(`/api/pedidos?id=${encodeURIComponent(seg.id)}`);
      C.offset = segData.ahora - Date.now();
    } catch (e) {
      if (e.status === 404) segData = { estado: "cancelado" };
    }
    if (segData && C.FINALES.includes(segData.estado)) stopPolling();
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

  // ---------- Ventana inferior ----------
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
    const vistas = { pizza: pizzaSheet, prod: productoSheet, cart: () => cartSheet(sheet.errores), seguimiento: seguimientoSheet, bienvenida: bienvenidaSheet, ticketListo: ticketListoSheet };
    el.innerHTML = vistas[sheet.kind](sheet);
    $("#overlay").hidden = false;
    lockScroll();
    const body = el.querySelector(".sheet-body");
    if (body) body.scrollTop = fresh ? 0 : keep;
    renderBars();
  }

  // Cierra la ventana. Si se abrió con historial, regresa un paso (así el botón "atrás" del celular también la cierra).
  // El "atrás" llega después; se ignora para que no cierre una ventana que se abrió justo enseguida.
  let atrasPendientes = 0;
  function closeSheet(desdeHistorial) {
    if (!sheet) return;
    sheet = null;
    $("#overlay").hidden = true;
    unlockScroll();
    renderBars();
    if (!desdeHistorial && history.state?.sheet) {
      atrasPendientes++;
      history.back();
    }
  }

  function renderBars() {
    const bar = $("#cartbar");
    const n = piezas();
    bar.hidden = n === 0 || MESA || !!sheet;
    document.body.classList.toggle("with-cart", !bar.hidden);
    bar.innerHTML = `<span class="count">${n}</span><span>${CAJA ? "Ver ticket" : "Ver pedido"}</span><span class="total">${money(subtotal())}</span>`;
    const tb = $("#track");
    if (tb) {
      tb.hidden = !seg || !!sheet || !PEDIDOS;
      if (seg) tb.innerHTML = `<span class="dot" aria-hidden="true"></span><span>Pedido #${esc(seg.codigo)} · ${esc(estadoCorto())}</span><span>›</span>`;
      document.body.classList.toggle("with-track", !tb.hidden);
    }
  }

  function pulse(el) {
    el.animate?.([{ transform: "translateX(-50%) scale(1)" }, { transform: "translateX(-50%) scale(1.04)" }, { transform: "translateX(-50%) scale(1)" }], { duration: 300 });
  }

  function openItem(id) {
    const item = C.byId[id];
    if (!item) return;
    if (!C.itemDisponible(item)) return C.aviso(`${item.nombre}: agotado por hoy`);
    openSheet(item.tipo === "pizza"
      ? { kind: "pizza", item, size: 2, sabores: [item.id], orilla: false, notas: "", qty: 1, picker: false, cambios: {} }
      : { kind: "prod", item, v: Math.max(0, C.variantes(item).findIndex(C.varianteDisponible)), sabores: [], extra: -1, notas: "", qty: 1, cambios: {} });
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
  window.addEventListener("popstate", () => {
    if (atrasPendientes > 0) {
      atrasPendientes--;
      return;
    }
    if (sheet) closeSheet(true);
  });

  $("#q").addEventListener("input", (e) => {
    query = e.target.value;
    render();
  });

  $("#cartbar").addEventListener("click", () => openSheet({ kind: "cart", errores: [] }));
  $("#track")?.addEventListener("click", () => {
    openSheet({ kind: "seguimiento" });
    if (seg?.id && !pollTimer && !C.FINALES.includes(segData?.estado)) startPolling();
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
    if ("luego" in d) { closeSheet(); return C.aviso("Cuando quieras, aquí estamos 🍕"); }
    if ("add" in d) return addFromSheet();
    if ("cambio" in d && s.cambios) {
      s.cambios[d.cambio] = s.cambios[d.cambio] === d.por ? undefined : d.por;
      if (!s.cambios[d.cambio]) delete s.cambios[d.cambio];
      return renderSheet();
    }
    if ("qty" in d) { s.qty = Math.max(1, s.qty + Number(d.qty)); return renderSheet(); }

    if (s.kind === "pizza") {
      if ("size" in d) {
        s.size = Number(d.size);
        s.sabores = s.sabores.slice(0, C.maxSabores(s.size));
      } else if ("picker" in d) {
        s.picker = !s.picker;
      } else if ("addSabor" in d) {
        if (s.sabores.length < C.maxSabores(s.size)) s.sabores.push(d.addSabor);
        if (s.sabores.length >= C.maxSabores(s.size)) s.picker = false;
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
        const max = C.variantes(s.item)[s.v].max || 1;
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
      } else if ("mesa" in d) {
        orden.mesa = d.mesa;
      } else if ("zona" in d) {
        orden.zona = d.zona;
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

    if (s.kind === "ticketListo") {
      if ("imprimir" in d) return C.imprimirTicket(s.ticket);
      if ("nuevoTicket" in d) {
        closeSheet();
        location.hash = "";
      }
      return;
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
        const c = $("#cambio");
        if (c) c.textContent = paga > total() ? `Cambio: ${money(paga - total())}` : "";
      }
    }
  });

  // Si el encargado cambia agotados, tiempo o si se reciben pedidos, la pantalla se actualiza sola.
  C.alCambiarEstado(() => {
    render();
    renderTiempoHoy();
    renderBars();
    const escribiendo = sheet && $("#sheet").contains(document.activeElement) && /INPUT|TEXTAREA/.test(document.activeElement.tagName);
    if (sheet && !escribiendo && sheet.kind !== "ticketListo") renderSheet();
  });

  // ---------- Caja: agregar a la cuenta de una mesa ----------
  function renderDestino() {
    const el = $("#destino");
    if (!el) return;
    el.hidden = !destino;
    if (destino) el.innerHTML = `<span>➕ Agregando a la cuenta de <b>Mesa ${esc(destino.mesa)}</b></span><button data-cancelar-destino>Cancelar</button>`;
  }
  document.addEventListener("agregar-a-mesa", (e) => {
    destino = e.detail;
    orden.tipo = "mesa";
    orden.mesa = String(destino.mesa);
    renderDestino();
    if (location.hash) location.hash = "";
    else render();
  });
  $("#destino")?.addEventListener("click", (e) => {
    if (!e.target.closest("[data-cancelar-destino]")) return;
    destino = null;
    renderDestino();
  });

  // ---------- Inicio ----------
  // Botón flotante para escribirle al restaurante por WhatsApp cuando quieran.
  if (!CAJA) {
    // Sin emojis: el enlace de WhatsApp los convierte en símbolos raros.
    const saludo = MESA ? "Hola Casa Rincón, tengo una pregunta: " : "Hola Casa Rincón, ";
    document.body.insertAdjacentHTML("beforeend",
      `<a class="wa-fab" href="https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent(saludo)}" target="_blank" rel="noopener" aria-label="Escríbenos por WhatsApp">
        <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><path fill="#fff" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.4.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3Z"/></svg>
        <span>Escríbenos</span></a>`);
  }
  if (MESA) {
    $("#hero")?.insertAdjacentHTML("afterend", '<p class="mesa-banner">Estás viendo el menú de mesa. Para ordenar, llama a tu mesero 🙋</p>');
  }
  if (PEDIDOS) {
    $("#hero")?.insertAdjacentHTML("afterend", '<div class="tiempo-hoy" id="tiempoHoy"></div>');
  }
  render();
  renderTiempoHoy();
  renderBars();
  C.vigilarEstado(CAJA ? 15000 : 30000);
  if (PEDIDOS) {
    if (seg?.id) startPolling();
    // Siempre preguntar el tiempo de espera antes de pedir (una vez por visita).
    let preguntado = false;
    try { preguntado = sessionStorage.getItem("cr-bienvenida") === "1"; } catch { /* nada */ }
    if (!preguntado && !seg) {
      C.cargarEstado().then(() => {
        try { sessionStorage.setItem("cr-bienvenida", "1"); } catch { /* nada */ }
        if (!sheet) openSheet({ kind: "bienvenida" });
      });
    }
  }
})();
