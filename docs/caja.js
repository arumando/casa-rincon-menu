// Caja (app principal): pedidos que llegan, tickets, tiempo de espera del día y agotados.
// La pestaña "Nuevo ticket" la maneja menu.js en modo caja.
(() => {
  "use strict";

  const C = Core;
  const { $, money, esc, horaDe } = C;

  let tab = "ticket";
  let filtro = "activos";
  let pedidos = [];
  let conocidos = null; // ids ya vistos, para avisar de pedidos nuevos
  let timer = null;
  let enLinea = true;

  const ahora = () => Date.now() + C.offset;
  const haceTxt = (ts) => {
    const m = Math.floor((ahora() - ts) / 60000);
    return m < 1 ? "hace un momento" : m < 60 ? `hace ${m} min` : `hace ${Math.floor(m / 60)} h ${m % 60} min`;
  };

  // ---------- Sesión ----------
  async function entrar(pinNuevo) {
    if (pinNuevo !== undefined) C.setPin(pinNuevo);
    try {
      await cargar(true);
    } catch (e) {
      return mostrarLogin(e.status === 401 ? "PIN incorrecto." : "No hay conexión. Intenta de nuevo.");
    }
    $("#login").hidden = true;
    $("#app").hidden = false;
    clearInterval(timer);
    timer = setInterval(() => cargar().catch(() => {}), 5000);
  }

  function mostrarLogin(error) {
    clearInterval(timer);
    $("#app").hidden = true;
    $("#login").hidden = false;
    $("#loginError").hidden = !error;
    $("#loginError").textContent = error || "";
    $("#estado").innerHTML = "";
    setTimeout(() => $("#pin").focus(), 50);
  }

  function salir() {
    C.setPin("");
    conocidos = null;
    mostrarLogin();
  }

  // ---------- Pedidos ----------
  async function cargar(lanzar) {
    try {
      const data = await C.api("/api/pedidos", { conPin: true });
      C.offset = data.ahora - Date.now();
      if (conocidos) {
        const nuevos = data.pedidos.filter((p) => !conocidos.has(p.id) && p.origen !== "caja");
        if (nuevos.length) {
          C.timbre();
          C.aviso(`🔔 Nuevo pedido en línea #${nuevos[0].codigo}`, "ok");
        }
      }
      conocidos = new Set(data.pedidos.map((p) => p.id));
      pedidos = data.pedidos;
      enLinea = true;
    } catch (e) {
      if (e.status === 401) {
        if (lanzar) throw e;
        return salir();
      }
      enLinea = false;
      if (lanzar) throw e;
    }
    renderEstado();
    if (tab === "pedidos") renderPedidos();
  }

  async function cambiar(id, cambio) {
    try {
      const { pedido, ahora: srv } = await C.api(`/api/pedidos?id=${encodeURIComponent(id)}`, { method: "PATCH", body: cambio, conPin: true });
      C.offset = srv - Date.now();
      pedidos = pedidos.map((p) => (p.id === id ? pedido : p));
      renderPedidos();
      renderEstado();
    } catch (e) {
      if (e.status === 401) return salir();
      C.aviso("No se pudo guardar. Revisa el internet.", "error");
    }
  }

  function renderEstado() {
    const activos = pedidos.filter((p) => !C.FINALES.includes(p.estado)).length;
    $("#nPedidos").textContent = activos ? activos : "";
    const e = C.estado;
    $("#estado").innerHTML = `${enLinea ? '<span class="dot" aria-hidden="true"></span> En vivo' : "⚠️ Sin conexión"}
      <span class="s-chip ${e.abierto === false ? "off" : ""}">${e.abierto === false ? "Pedidos en línea pausados" : `Pasan ${e.tiempo.llevar} · Domicilio ${e.tiempo.domicilio} min`}</span>
      <button class="salir" data-salir>Salir</button>`;
  }

  function tarjeta(p) {
    const c = p.cliente || {};
    const final = C.FINALES.includes(p.estado);
    const tel = (c.tel || "").replace(/\D/g, "");
    const wa = tel.length === 10 ? `https://wa.me/52${tel}` : "";
    const faltan = p.listoEn ? Math.ceil((p.listoEn - ahora()) / 60000) : null;
    const paga = Number(p.pagaCon) || 0;

    const acciones = [];
    if (!final) {
      if (p.estado === "recibido" || p.estado === "preparando") acciones.push(`<button class="go" data-estado="listo">✅ Listo</button>`);
      if (p.estado === "listo" && p.tipo === "domicilio") acciones.push(`<button class="go" data-estado="en_camino">🛵 En camino</button>`);
      if (p.estado === "listo" || p.estado === "en_camino") acciones.push(`<button class="go" data-estado="entregado">Entregado</button>`);
    }
    acciones.push(`<button data-pagado="${p.pagado ? "0" : "1"}" class="${p.pagado ? "pagado" : ""}">${p.pagado ? "💵 Pagado ✓" : "💵 Marcar pagado"}</button>`);
    acciones.push(`<button data-imprimir>🖨️ Ticket</button>`);
    if (!final) acciones.push(`<button class="bad" data-estado="cancelado">Cancelar</button>`);

    return `<article class="ped ${p.estado === "recibido" && p.origen !== "caja" ? "nuevo" : ""} ${final ? "final" : ""}" data-id="${p.id}">
      <div class="ped-head">
        <span class="cod">#${esc(p.codigo)}</span>
        <span class="badge ${p.tipo}">${esc(C.tipoLargo(p))}</span>
        <span class="badge">${p.origen === "caja" ? "Caja" : "En línea"}</span>
        <span class="badge est ${p.estado}">${C.ESTADO_TXT[p.estado] || p.estado}</span>
        <span class="hace">${horaDe(p.creado - C.offset)} · ${haceTxt(p.creado)}</span>
      </div>
      ${c.nombre || tel ? `<p class="cli">${esc(c.nombre)}${tel ? ` · <a href="tel:${tel}">${esc(c.tel)}</a>` : ""}${wa ? ` · <a href="${wa}" target="_blank" rel="noopener">WhatsApp</a>` : ""}</p>` : ""}
      ${p.tipo === "domicilio" ? `<p class="entrega">🛵 ${esc(p.zona?.nombre || "Sin zona")} · envío ${money(p.envio)}
        ${c.dir ? `<br>${esc(c.dir)}` : ""}${c.ref ? `<br>Ref.: ${esc(c.ref)}` : ""}
        ${c.ubic ? `<br>📍 <a href="https://maps.google.com/?q=${c.ubic.lat},${c.ubic.lng}" target="_blank" rel="noopener">Ver ubicación en el mapa</a>` : ""}</p>` : ""}
      <ul>${(p.lineas || []).map((l) => `<li><b>${l.qty}×</b> ${esc(l.nombre)} <span class="r">${money(l.precio * l.qty)}</span>${l.detalle ? `<small>${esc(l.detalle)}</small>` : ""}</li>`).join("")}</ul>
      <div class="tot"><span>Total</span><span>${money(p.total)}</span></div>
      <p class="pago">${esc(C.PAGO_TXT[p.pago] || p.pago || "")}${p.pago === "efectivo" && paga > p.total ? ` · paga con ${money(paga)} → cambio ${money(paga - p.total)}` : ""}</p>
      ${p.notas ? `<p class="notas">📝 ${esc(p.notas)}</p>` : ""}
      ${!final && p.listoEn && p.tipo !== "mesa" ? `<div class="tiempo">
        <span>${p.tipo === "domicilio" ? "Llega" : "Listo"} ~${horaDe(p.listoEn - C.offset)} · <b class="${faltan < 0 ? "tarde" : ""}">${faltan > 0 ? `faltan ${faltan} min` : faltan === 0 ? "ya" : `${-faltan} min tarde`}</b></span>
        <span class="mini"><button data-sumar="5">+5</button><button data-sumar="10">+10</button><button data-sumar="15">+15</button></span>
      </div>` : ""}
      <div class="btns">${acciones.join("")}</div>
    </article>`;
  }

  function renderPedidos() {
    const activos = pedidos.filter((p) => !C.FINALES.includes(p.estado)).sort((a, b) => a.creado - b.creado);
    const hechos = pedidos.filter((p) => C.FINALES.includes(p.estado));
    const vendido = pedidos.filter((p) => p.estado !== "cancelado").reduce((a, p) => a + (p.total || 0), 0);
    $("#filtros").innerHTML = `
      <button class="${filtro === "activos" ? "on" : ""}" data-filtro="activos">En curso <span class="n">${activos.length}</span></button>
      <button class="${filtro === "hechos" ? "on" : ""}" data-filtro="hechos">Terminados <span class="n">${hechos.length}</span></button>
      <span class="s-total">Vendido (36 h): <b>${money(vendido)}</b></span>`;
    const lista = filtro === "activos" ? activos : hechos;
    $("#lista").innerHTML = lista.length
      ? lista.map(tarjeta).join("")
      : `<p class="vacio">${filtro === "activos" ? "No hay pedidos en curso. Los pedidos en línea aparecen aquí solos y suena un aviso." : "Todavía no hay pedidos terminados."}</p>`;
  }

  // ---------- Tiempo y agotados ----------
  const TIEMPOS = { llevar: [15, 20, 25, 30, 40, 45, 60, 75, 90], domicilio: [20, 30, 40, 45, 60, 75, 90, 120] };

  function renderAjustes() {
    const e = C.estado;
    const ing = new Set(e.agotados?.ingredientes || []);
    const prod = new Set(e.agotados?.productos || []);
    const nAgotados = ing.size + prod.size;
    $("#ajustes").innerHTML = `
      <section class="s-card">
        <h3>Pedidos en línea</h3>
        <button class="s-switch ${e.abierto === false ? "off" : "on"}" data-abierto="${e.abierto === false ? "1" : "0"}">
          ${e.abierto === false ? "⏸ Pausados — toca para volver a recibir" : "✅ Recibiendo pedidos — toca para pausar"}</button>
        <p class="hint">Si se pausa, los clientes pueden ver el menú pero no pedir. Los tickets de caja siguen funcionando.</p>
      </section>

      <section class="s-card">
        <h3>Tiempo de espera <small>aplica a todos los pedidos hasta que lo cambies</small></h3>
        ${["llevar", "domicilio"].map((t) => `
          <p class="s-label">${t === "llevar" ? "Pasan" : "A domicilio"}: <b>${e.tiempo[t]} min</b></p>
          <div class="chips big">${TIEMPOS[t].map((m) => `<button class="chip ${e.tiempo[t] === m ? "on" : ""}" data-tiempo="${t}" data-min="${m}">${m} min</button>`).join("")}</div>`).join("")}
        <p class="hint">El cliente lo ve antes de pedir (“¿Seguimos?”) y en su seguimiento. Si un pedido se atrasa, súmale minutos desde Pedidos.</p>
      </section>

      <section class="s-card">
        <h3>Agotados hoy ${nAgotados ? `<small>${nAgotados} marcados</small>` : ""}</h3>
        <p class="hint">Toca lo que se acabó. Desaparece al momento para clientes, mesas y caja. Vuelve a tocarlo cuando haya otra vez.</p>
        <p class="s-label">Ingredientes</p>
        <div class="chips big">${INGREDIENTES.map((i) => `<button class="chip ${ing.has(i.id) ? "agotado" : ""}" data-ing="${i.id}">${ing.has(i.id) ? "✕ " : ""}${esc(i.nombre)}</button>`).join("")}</div>
        ${CATEGORIAS.map((c) => `
          <p class="s-label">${esc(c.nombre)}</p>
          <div class="chips big">${ITEMS.filter((i) => i.cat === c.id).map((i) => {
            const porIng = !prod.has(i.id) && !C.itemDisponible(i);
            return `<button class="chip ${prod.has(i.id) ? "agotado" : porIng ? "agotado soft" : ""}" data-prod="${i.id}" title="${porIng ? "Agotado por un ingrediente" : ""}">${prod.has(i.id) ? "✕ " : ""}${esc(i.nombre)}${porIng ? " · por ingrediente" : ""}</button>`;
          }).join("")}</div>`).join("")}
        ${nAgotados ? `<button class="secondary s-reset" data-reset-agotados>Volver a activar todo</button>` : ""}
      </section>

      <section class="s-card">
        <h3>Otras apps</h3>
        <div class="s-links">
          <a href="cocina.html" target="_blank" rel="noopener">👨‍🍳 Pantalla de cocina</a>
          <a href="pedidos.html" target="_blank" rel="noopener">🛵 App de pedidos</a>
          <a href="menu.html" target="_blank" rel="noopener">📖 Menú de mesa</a>
        </div>
      </section>`;
  }

  async function guardarEstado(cambio, texto) {
    try {
      await C.cambiarEstado(cambio);
      C.aviso(texto || "Guardado ✓", "ok");
    } catch (e) {
      if (e.status === 401) return salir();
      C.aviso("No se pudo guardar. Revisa el internet.", "error");
    }
  }

  function toggleLista(lista, id) {
    const s = new Set(lista || []);
    s.has(id) ? s.delete(id) : s.add(id);
    return [...s];
  }

  // ---------- Pestañas ----------
  function irA(t) {
    tab = t;
    document.body.classList.remove("tab-ticket", "tab-pedidos", "tab-ajustes");
    document.body.classList.add(`tab-${t}`);
    document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === t));
    ["ticket", "pedidos", "ajustes"].forEach((x) => { $(`#tab-${x}`).hidden = x !== t; });
    if (t === "pedidos") renderPedidos();
    if (t === "ajustes") renderAjustes();
    window.scrollTo(0, 0);
  }

  // ---------- Eventos ----------
  $("#loginForm").addEventListener("submit", (e) => {
    e.preventDefault();
    C.prepararAudio();
    entrar($("#pin").value.trim());
  });

  document.addEventListener("click", (e) => {
    C.prepararAudio();
    const b = e.target.closest("button");
    if (!b || $("#overlay").contains(b)) return;
    const d = b.dataset;
    if ("salir" in d) return salir();
    if ("tab" in d) return irA(d.tab);
    if ("filtro" in d) { filtro = d.filtro; return renderPedidos(); }

    // Ajustes
    const e2 = C.estado;
    if ("abierto" in d) return guardarEstado({ abierto: d.abierto === "1" }, d.abierto === "1" ? "Recibiendo pedidos ✓" : "Pedidos en línea pausados");
    if ("tiempo" in d) return guardarEstado({ tiempo: { [d.tiempo]: Number(d.min) } }, `Tiempo ${d.tiempo === "llevar" ? "para los que pasan" : "a domicilio"}: ${d.min} min ✓`);
    if ("ing" in d) return guardarEstado({ agotados: { ingredientes: toggleLista(e2.agotados?.ingredientes, d.ing) } });
    if ("prod" in d) return guardarEstado({ agotados: { productos: toggleLista(e2.agotados?.productos, d.prod) } });
    if ("resetAgotados" in d) {
      if (confirm("¿Volver a activar todos los productos e ingredientes?")) guardarEstado({ agotados: { ingredientes: [], productos: [] } }, "Todo activo otra vez ✓");
      return;
    }

    // Pedidos
    const id = b.closest(".ped")?.dataset.id;
    if (!id) return;
    const p = pedidos.find((x) => x.id === id);
    if ("imprimir" in d) return C.imprimirTicket(p);
    if ("pagado" in d) return cambiar(id, { pagado: d.pagado === "1" });
    if ("sumar" in d) return cambiar(id, { sumar: Number(d.sumar) });
    if ("estado" in d) {
      if (d.estado === "cancelado" && !confirm(`¿Cancelar el pedido #${p.codigo}? ${p.origen === "caja" ? "" : "El cliente lo verá en su pantalla."}`)) return;
      cambiar(id, { estado: d.estado });
    }
  });

  document.addEventListener("ticket-enviado", () => cargar().catch(() => {}));
  C.alCambiarEstado(() => {
    renderEstado();
    if (tab === "ajustes") renderAjustes();
  });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && C.pin) cargar().catch(() => {}); });

  if (C.pin) entrar();
  else mostrarLogin();
})();
