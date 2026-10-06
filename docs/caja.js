// Caja (app principal), pensada para usarse desde el celular con pocos toques:
//   Nuevo   → arma tickets (lo maneja menu.js en modo caja)
//   Mesas   → cuentas abiertas: agregar más, quitar, imprimir y cobrar
//   Pedidos → los de "Pasan" y "A domicilio": un botón grande con el siguiente paso
//   Ajustes → tiempo de espera, pedidos en línea y lo que se acabó
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
  const final = (p) => C.FINALES.includes(p.estado);

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

  // ---------- Datos ----------
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
    if (tab === "mesas") renderMesas();
  }

  async function cambiar(id, cambio, texto) {
    try {
      const { pedido, ahora: srv } = await C.api(`/api/pedidos?id=${encodeURIComponent(id)}`, { method: "PATCH", body: cambio, conPin: true });
      C.offset = srv - Date.now();
      pedidos = pedidos.map((p) => (p.id === id ? pedido : p));
      if (texto) C.aviso(texto, "ok");
      renderTodo();
    } catch (e) {
      if (e.status === 401) return salir();
      C.aviso("No se pudo guardar. Revisa el internet.", "error");
    }
  }

  // ---------- Encabezado y contadores ----------
  const mesasAbiertas = () => {
    const porCuenta = new Map();
    for (const p of pedidos) {
      if (p.tipo !== "mesa" || p.cerrada || p.estado === "cancelado") continue;
      if (!porCuenta.has(p.cuenta)) porCuenta.set(p.cuenta, []);
      porCuenta.get(p.cuenta).push(p);
    }
    return [...porCuenta.entries()]
      .map(([cuenta, rondas]) => ({ cuenta, mesa: rondas[0].mesa, rondas: rondas.sort((a, b) => a.creado - b.creado) }))
      .sort((a, b) => Number(a.mesa) - Number(b.mesa) || a.rondas[0].creado - b.rondas[0].creado);
  };
  const pedidosFuera = () => pedidos.filter((p) => p.tipo !== "mesa");

  function renderEstado() {
    const activos = pedidosFuera().filter((p) => !final(p)).length;
    $("#nPedidos").textContent = activos || "";
    $("#nMesas").textContent = mesasAbiertas().length || "";
    const e = C.estado;
    $("#estado").innerHTML = `${enLinea ? '<span class="dot" aria-hidden="true"></span>' : "⚠️"}
      <span class="s-chip ${e.abierto === false ? "off" : ""}">${e.abierto === false ? "En línea: pausado" : `⏱ Pasan ${e.tiempo.llevar} · Domicilio ${e.tiempo.domicilio} min`}</span>
      <button class="salir" data-salir>Salir</button>`;
  }

  function renderTodo() {
    renderEstado();
    if (tab === "pedidos") renderPedidos();
    if (tab === "mesas") renderMesas();
  }

  // ---------- Mesas: cuentas abiertas ----------
  function renderMesas() {
    const mesas = mesasAbiertas();
    $("#mesas").innerHTML = mesas.length
      ? mesas.map((m) => {
        const total = m.rondas.reduce((a, p) => a + p.total, 0);
        const lineas = m.rondas.flatMap((p, r) => p.lineas.map((l, i) => ({ ...l, pedido: p, i, ronda: r + 1 })));
        return `<article class="mesa" data-cuenta="${esc(m.cuenta)}" data-mesa="${esc(m.mesa)}">
          <header>
            <span class="mesa-num">Mesa ${esc(m.mesa)}</span>
            <span class="hace">Abierta ${horaDe(m.rondas[0].creado - C.offset)} · ${haceTxt(m.rondas[0].creado)}</span>
          </header>
          <ul>${lineas.map((l) => `<li>
              <span class="q">${l.qty}×</span>
              <span class="n">${esc(l.nombre)}${l.detalle ? `<small>${esc(l.detalle)}</small>` : ""}</span>
              <span class="r">${money(l.precio * l.qty)}</span>
              <span class="st" title="${l.pedido.estado === "listo" ? "Listo" : "En cocina"}">${l.pedido.estado === "listo" || l.pedido.estado === "entregado" ? "✅" : "🔥"}</span>
              <button class="x" data-quitar="${l.pedido.id}" data-i="${l.i}" aria-label="Quitar ${esc(l.nombre)}">×</button>
            </li>`).join("")}</ul>
          <div class="tot"><span>Total de la mesa</span><span>${money(total)}</span></div>
          <div class="mesa-btns">
            <button class="big go" data-agregar>➕ Agregar</button>
            <button class="big" data-cuenta-print>🖨️ Cuenta</button>
            <button class="big pay" data-cobrar>💵 Cobrar</button>
          </div>
        </article>`;
      }).join("")
      : `<p class="vacio">No hay mesas abiertas.<br>En <b>Nuevo</b> elige “Mesa” y el número: la cuenta queda abierta aquí para agregar más y cobrar al final.</p>`;
  }

  function ticketDeMesa(m) {
    const lineas = m.rondas.flatMap((p) => p.lineas);
    return {
      codigo: m.rondas.map((p) => p.codigo).join(", "),
      tipo: "mesa", mesa: m.mesa, creado: m.rondas[0].creado,
      lineas, subtotal: lineas.reduce((a, l) => a + l.precio * l.qty, 0),
      envio: 0, total: m.rondas.reduce((a, p) => a + p.total, 0), pago: "", cliente: {},
    };
  }

  async function cobrar(m) {
    const total = m.rondas.reduce((a, p) => a + p.total, 0);
    const resp = prompt(`Mesa ${m.mesa}: total ${money(total)}.\n¿Con cuánto paga? (vacío si es exacto o con tarjeta)`, "");
    if (resp === null) return;
    const paga = Number(String(resp).replace(/[^\d.]/g, "")) || 0;
    if (paga && paga < total) return alert("No alcanza para el total.");
    try {
      await C.api(`/api/pedidos?cuenta=${encodeURIComponent(m.cuenta)}`, { method: "PATCH", body: { cerrar: true, pago: paga ? "efectivo" : "" }, conPin: true });
      C.aviso(paga > total ? `Mesa ${m.mesa} cobrada · cambio ${money(paga - total)}` : `Mesa ${m.mesa} cobrada y cerrada ✓`, "ok");
      await cargar();
    } catch (e) {
      if (e.status === 401) return salir();
      C.aviso("No se pudo cobrar. Revisa el internet.", "error");
    }
  }

  // ---------- Pedidos: Pasan y A domicilio ----------
  // Un solo botón grande con el siguiente paso; lo demás en botones chicos.
  function siguientePaso(p) {
    if (p.estado === "recibido" || p.estado === "preparando") return { estado: "listo", txt: "✅ Ya está listo" };
    if (p.estado === "listo" && p.tipo === "domicilio") return { estado: "en_camino", txt: "🛵 Ya salió a entregar" };
    if (p.estado === "listo" || p.estado === "en_camino") return { estado: "entregado", txt: "✔ Entregado" };
    return null;
  }

  function tarjeta(p) {
    const c = p.cliente || {};
    const tel = (c.tel || "").replace(/\D/g, "");
    const wa = tel.length === 10 ? `https://wa.me/52${tel}` : "";
    const faltan = p.listoEn ? Math.ceil((p.listoEn - ahora()) / 60000) : null;
    const paga = Number(p.pagaCon) || 0;
    const sig = !final(p) && siguientePaso(p);
    return `<article class="ped ${final(p) ? "final" : ""} ${p.origen !== "caja" && p.estado !== "listo" && !final(p) ? "linea" : ""}" data-id="${p.id}">
      <div class="ped-head">
        <span class="cod">#${esc(p.codigo)}</span>
        <span class="badge ${p.tipo}">${esc(C.tipoLargo(p))}</span>
        ${p.origen !== "caja" ? '<span class="badge web">En línea</span>' : ""}
        <span class="badge est ${p.estado}">${C.ESTADO_TXT[p.estado] || p.estado}</span>
      </div>
      <p class="hace">${horaDe(p.creado - C.offset)} · ${haceTxt(p.creado)}${!final(p) && p.listoEn ? ` · <b class="${faltan < 0 ? "tarde" : ""}">${faltan > 0 ? `listo en ${faltan} min` : faltan === 0 ? "ya" : `${-faltan} min tarde`}</b>` : ""}</p>
      ${c.nombre || tel ? `<p class="cli">${esc(c.nombre)}${tel ? ` · <a href="tel:${tel}">${esc(c.tel)}</a>` : ""}${wa ? ` · <a href="${wa}" target="_blank" rel="noopener">WhatsApp</a>` : ""}</p>` : ""}
      ${p.tipo === "domicilio" ? `<p class="entrega">🛵 ${esc(p.zona?.nombre || "Sin zona")} · envío ${money(p.envio)}
        ${c.dir ? `<br>${esc(c.dir)}` : ""}${c.ref ? `<br>Ref.: ${esc(c.ref)}` : ""}
        ${c.ubic ? `<br>📍 <a href="https://maps.google.com/?q=${c.ubic.lat},${c.ubic.lng}" target="_blank" rel="noopener">Ver ubicación en el mapa</a>` : ""}</p>` : ""}
      <ul>${(p.lineas || []).map((l) => `<li><b>${l.qty}×</b> ${esc(l.nombre)} <span class="r">${money(l.precio * l.qty)}</span>${l.detalle ? `<small>${esc(l.detalle)}</small>` : ""}</li>`).join("")}</ul>
      <div class="tot"><span>Total</span><span>${money(p.total)}</span></div>
      <p class="pago">${esc(C.PAGO_TXT[p.pago] || p.pago || "")}${p.pago === "efectivo" && paga > p.total ? ` · paga con ${money(paga)} → cambio ${money(paga - p.total)}` : ""}${p.pagado ? " · <b>pagado ✓</b>" : ""}</p>
      ${p.notas ? `<p class="notas">📝 ${esc(p.notas)}</p>` : ""}
      ${sig ? `<button class="paso" data-estado="${sig.estado}">${sig.txt}</button>` : ""}
      <div class="chicos">
        ${!final(p) && p.estado !== "listo" ? '<button data-sumar="10">⏱ +10 min</button>' : ""}
        <button data-imprimir>🖨️ Ticket</button>
        <button data-pagado="${p.pagado ? "0" : "1"}">${p.pagado ? "Quitar pagado" : "💵 Pagado"}</button>
        ${!final(p) ? '<button class="bad" data-estado="cancelado">Cancelar</button>' : ""}
      </div>
    </article>`;
  }

  function renderPedidos() {
    const fuera = pedidosFuera();
    const activos = fuera.filter((p) => !final(p)).sort((a, b) => a.creado - b.creado);
    const hechos = fuera.filter(final);
    const inicioDia = new Date().setHours(0, 0, 0, 0);
    const vendido = pedidos
      .filter((p) => p.estado !== "cancelado" && p.creado - C.offset >= inicioDia)
      .reduce((a, p) => a + (p.total || 0), 0);
    $("#filtros").innerHTML = `
      <button class="${filtro === "activos" ? "on" : ""}" data-filtro="activos">En curso <span class="n">${activos.length}</span></button>
      <button class="${filtro === "hechos" ? "on" : ""}" data-filtro="hechos">Terminados <span class="n">${hechos.length}</span></button>
      <span class="s-total">Vendido hoy: <b>${money(vendido)}</b></span>`;
    const lista = filtro === "activos" ? activos : hechos;
    $("#lista").innerHTML = lista.length
      ? lista.map(tarjeta).join("")
      : `<p class="vacio">${filtro === "activos" ? "No hay pedidos en curso.<br>Los pedidos en línea aparecen aquí solos y suena un aviso." : "Todavía no hay pedidos terminados."}</p>`;
  }

  // ---------- Ajustes: tiempo y lo que se acabó ----------
  const TIEMPOS = { llevar: [15, 20, 25, 30, 40, 45, 60, 75, 90], domicilio: [20, 30, 40, 45, 60, 75, 90, 120] };

  function renderAjustes() {
    const e = C.estado;
    const ing = new Set(e.agotados?.ingredientes || []);
    const prod = new Set(e.agotados?.productos || []);
    const nAgotados = ing.size + prod.size;
    const chipIng = (i) => `<button class="chip ${ing.has(i.id) ? "agotado" : ""}" data-ing="${i.id}">${ing.has(i.id) ? "✕ " : ""}${esc(i.nombre)}</button>`;
    $("#ajustes").innerHTML = `
      <section class="s-card">
        <h3>⏱ Tiempo de espera</h3>
        <p class="hint">Vale para todos los pedidos hasta que lo cambies. El cliente lo ve antes de pedir.</p>
        ${["llevar", "domicilio"].map((t) => `
          <p class="s-label">${t === "llevar" ? "Pasan" : "A domicilio"}: <b>${e.tiempo[t]} min</b></p>
          <div class="chips big">${TIEMPOS[t].map((m) => `<button class="chip ${e.tiempo[t] === m ? "on" : ""}" data-tiempo="${t}" data-min="${m}">${m}</button>`).join("")}</div>`).join("")}
      </section>

      <section class="s-card">
        <h3>📲 Pedidos en línea</h3>
        <button class="s-switch ${e.abierto === false ? "off" : "on"}" data-abierto="${e.abierto === false ? "1" : "0"}">
          ${e.abierto === false ? "⏸ Pausados · toca para volver a recibir" : "✅ Recibiendo · toca para pausar"}</button>
        <p class="hint">En pausa, los clientes ven el menú pero no pueden pedir. Los tickets de caja siguen funcionando.</p>
      </section>

      <section class="s-card">
        <h3>😕 Se acabó… ${nAgotados ? `<small>${nAgotados} marcados</small>` : ""}</h3>
        <p class="s-label">Ingredientes <small>— el platillo se sigue vendiendo y se pregunta: “¿sin ese ingrediente o con otro?”</small></p>
        <div class="chips big">${INGREDIENTES.filter((i) => !i.base).map(chipIng).join("")}</div>
        <p class="s-label">Base <small>— sin esto no se puede hacer el platillo, así que se apaga</small></p>
        <div class="chips big">${INGREDIENTES.filter((i) => i.base).map(chipIng).join("")}</div>
        <details class="s-prods">
          <summary>Apagar un platillo completo${prod.size ? ` (${prod.size})` : ""}</summary>
          ${CATEGORIAS.map((c) => `
            <p class="s-label">${esc(c.nombre)}</p>
            <div class="chips big">${ITEMS.filter((i) => i.cat === c.id).map((i) => {
              const porBase = !prod.has(i.id) && !C.itemDisponible(i);
              return `<button class="chip ${prod.has(i.id) ? "agotado" : porBase ? "agotado soft" : ""}" data-prod="${i.id}">${prod.has(i.id) ? "✕ " : ""}${esc(i.nombre)}${porBase ? " · sin base" : ""}</button>`;
            }).join("")}</div>`).join("")}
        </details>
        ${nAgotados ? `<button class="secondary s-reset" data-reset-agotados>Ya hay de todo otra vez</button>` : ""}
      </section>

      <section class="s-card">
        <h3>🔗 Otras pantallas</h3>
        <div class="s-links">
          <a href="cocina.html" target="_blank" rel="noopener">👨‍🍳 Monitor de cocina</a>
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
  const TABS = ["ticket", "mesas", "pedidos", "ajustes"];
  function irA(t) {
    tab = t;
    TABS.forEach((x) => document.body.classList.toggle(`tab-${x}`, x === t));
    document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === t));
    TABS.forEach((x) => { $(`#tab-${x}`).hidden = x !== t; });
    if (t === "pedidos") renderPedidos();
    if (t === "mesas") renderMesas();
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
    if (!b || $("#overlay").contains(b) || $("#destino").contains(b)) return;
    const d = b.dataset;
    if ("salir" in d) return salir();
    if ("tab" in d) return irA(d.tab);
    if ("filtro" in d) { filtro = d.filtro; return renderPedidos(); }

    // Ajustes
    const est = C.estado;
    if ("abierto" in d) return guardarEstado({ abierto: d.abierto === "1" }, d.abierto === "1" ? "Recibiendo pedidos ✓" : "Pedidos en línea en pausa");
    if ("tiempo" in d) return guardarEstado({ tiempo: { [d.tiempo]: Number(d.min) } }, `${d.tiempo === "llevar" ? "Pasan" : "A domicilio"}: ${d.min} min ✓`);
    if ("ing" in d) return guardarEstado({ agotados: { ingredientes: toggleLista(est.agotados?.ingredientes, d.ing) } });
    if ("prod" in d) return guardarEstado({ agotados: { productos: toggleLista(est.agotados?.productos, d.prod) } });
    if ("resetAgotados" in d) return guardarEstado({ agotados: { ingredientes: [], productos: [] } }, "Todo disponible otra vez ✓");

    // Mesas
    const mesaEl = b.closest(".mesa");
    if (mesaEl) {
      const m = mesasAbiertas().find((x) => x.cuenta === mesaEl.dataset.cuenta);
      if (!m) return;
      if ("agregar" in d) {
        irA("ticket");
        document.dispatchEvent(new CustomEvent("agregar-a-mesa", { detail: { cuenta: m.cuenta, mesa: m.mesa } }));
        return;
      }
      if ("cuentaPrint" in d) return C.imprimirTicket(ticketDeMesa(m));
      if ("cobrar" in d) return cobrar(m);
      if ("quitar" in d) {
        const p = m.rondas.find((x) => x.id === d.quitar);
        const l = p?.lineas[Number(d.i)];
        if (l && confirm(`¿Quitar ${l.qty}× ${l.nombre} de la Mesa ${m.mesa}?`)) cambiar(p.id, { quitarLinea: Number(d.i) }, "Quitado ✓");
      }
      return;
    }

    // Pedidos
    const id = b.closest(".ped")?.dataset.id;
    if (!id) return;
    const p = pedidos.find((x) => x.id === id);
    if ("imprimir" in d) return C.imprimirTicket(p);
    if ("pagado" in d) return cambiar(id, { pagado: d.pagado === "1" });
    if ("sumar" in d) return cambiar(id, { sumar: Number(d.sumar) }, "+10 min ✓");
    if ("estado" in d) {
      if (d.estado === "cancelado" && !confirm(`¿Cancelar el pedido #${p.codigo}?${p.origen === "caja" ? "" : " El cliente lo verá en su pantalla."}`)) return;
      cambiar(id, { estado: d.estado });
    }
  });

  document.addEventListener("ticket-enviado", (e) => {
    cargar().catch(() => {});
  });
  C.alCambiarEstado(() => {
    renderEstado();
    if (tab === "ajustes") renderAjustes();
  });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && C.pin) cargar().catch(() => {}); });

  if (C.pin) entrar();
  else mostrarLogin();
})();
