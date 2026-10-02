(() => {
  "use strict";

  const API = "/api/pedidos";
  const $ = (s) => document.querySelector(s);
  const money = (n) => "$" + Number(n).toLocaleString("es-MX", { maximumFractionDigits: 2 });
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const horaDe = (ts) => new Date(ts).toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit" });
  const FINALES = ["entregado", "cancelado"];
  const PAGO_TXT = { efectivo: "Efectivo", tarjeta: "Tarjeta", transferencia: "Transferencia" };
  const ESTADO_TXT = { recibido: "Nuevo", preparando: "En el horno", listo: "Listo", en_camino: "En camino", entregado: "Entregado", cancelado: "Cancelado" };

  const get = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const set = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* nada */ } };

  let pin = get("cr-pin", "");
  let pedidos = [];
  let offset = 0;
  let tab = "activos";
  let conocidos = null; // ids ya vistos, para avisar de pedidos nuevos
  let timer = null;
  let enLinea = true;
  let audio = null;

  const ahora = () => Date.now() + offset;
  const haceTxt = (ts) => {
    const m = Math.floor((ahora() - ts) / 60000);
    return m < 1 ? "hace un momento" : m < 60 ? `hace ${m} min` : `hace ${Math.floor(m / 60)} h ${m % 60} min`;
  };

  // ---------- Sonido de pedido nuevo ----------
  function prepararAudio() {
    try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); audio.resume?.(); } catch { audio = null; }
  }
  function timbre() {
    if (!audio) return;
    [0, 0.25].forEach((t) => {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, audio.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.3, audio.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + t + 0.2);
      o.connect(g).connect(audio.destination);
      o.start(audio.currentTime + t);
      o.stop(audio.currentTime + t + 0.22);
    });
    navigator.vibrate?.([200, 100, 200]);
  }

  // ---------- Datos ----------
  async function api(method, query = "", body) {
    const r = await fetch(API + query, {
      method,
      headers: { "x-panel-pin": pin, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    if (r.status === 401) throw new Error("pin");
    if (!r.ok) throw new Error("red");
    return r.json();
  }

  async function cargar() {
    try {
      const data = await api("GET");
      offset = data.ahora - Date.now();
      const ids = new Set(data.pedidos.map((p) => p.id));
      if (conocidos) {
        const nuevos = data.pedidos.filter((p) => !conocidos.has(p.id));
        if (nuevos.length) timbre();
      }
      conocidos = ids;
      pedidos = data.pedidos;
      enLinea = true;
    } catch (e) {
      if (e.message === "pin") return salir(true);
      enLinea = false;
    }
    render();
  }

  async function cambiar(id, cambio) {
    try {
      const { pedido, ahora: srv } = await api("PATCH", `?id=${encodeURIComponent(id)}`, cambio);
      offset = srv - Date.now();
      pedidos = pedidos.map((p) => (p.id === id ? pedido : p));
      render();
    } catch (e) {
      if (e.message === "pin") return salir(true);
      alert("No se pudo guardar el cambio. Revisa tu conexión.");
    }
  }

  // ---------- Vista ----------
  function tarjeta(p) {
    const c = p.cliente || {};
    const final = FINALES.includes(p.estado);
    const tel = (c.tel || "").replace(/\D/g, "");
    const wa = tel.length === 10 ? `https://wa.me/52${tel}` : tel ? `https://wa.me/${tel}` : "";
    const nuevo = p.estado === "recibido" && !p.listoEn;
    const faltan = p.listoEn ? Math.ceil((p.listoEn - ahora()) / 60000) : null;

    let tiempo = "";
    if (!final) {
      tiempo = p.listoEn
        ? `<div class="tiempo ok"><p>${p.tipo === "domicilio" ? "Llega" : "Listo"} a las ${horaDe(p.listoEn - offset)}
              <small>· ${faltan > 0 ? `faltan ${faltan} min` : `pasado por ${-faltan} min`}</small></p>
            <div class="btns">
              <button data-sumar="5">+5 min</button><button data-sumar="10">+10 min</button><button data-sumar="15">+15 min</button>
              <button data-reset>Cambiar</button>
            </div></div>`
        : `<div class="tiempo"><p>¿En cuánto estará? <small>El cliente lo ve al instante</small></p>
            <div class="btns">${[15, 20, 30, 40, 45, 60].map((m) => `<button class="go" data-min="${m}">${m} min</button>`).join("")}</div></div>`;
    }

    const siguiente = p.tipo === "domicilio"
      ? `<button data-estado="en_camino">🛵 En camino</button>`
      : `<button data-estado="listo">✅ Listo para recoger</button>`;

    const paga = Number(p.pagaCon) || 0;
    const pago = `${esc(PAGO_TXT[p.pago] || p.pago || "")}${p.pago === "efectivo" && paga > p.total ? ` · paga con ${money(paga)}, llevar ${money(paga - p.total)} de cambio` : ""}`;

    return `<article class="ped ${nuevo ? "nuevo" : ""} ${final ? "final" : ""}" data-id="${p.id}">
      <div class="ped-head">
        <span class="cod">#${esc(p.codigo)}</span>
        <span class="badge ${p.tipo === "domicilio" ? "dom" : ""}">${p.tipo === "domicilio" ? "A domicilio" : "Para llevar"}</span>
        <span class="badge est">${ESTADO_TXT[p.estado] || p.estado}</span>
        <span class="hace">${horaDe(p.creado - offset)} · ${haceTxt(p.creado)}</span>
      </div>
      <p class="cli">${esc(c.nombre)}${tel ? ` · <a href="tel:${tel}">${esc(c.tel)}</a>` : ""}${wa ? ` · <a href="${wa}" target="_blank" rel="noopener">WhatsApp</a>` : ""}</p>
      ${p.tipo === "domicilio" ? `<p class="entrega">${c.ubic ? `📍 <a href="https://maps.google.com/?q=${c.ubic.lat},${c.ubic.lng}" target="_blank" rel="noopener">Ver ubicación en el mapa</a>${c.ubic.acc > 100 ? " (precisión baja)" : ""}` : ""}
        ${c.dir ? `<br>${esc(c.dir)}` : ""}${c.ref ? `<br>Ref.: ${esc(c.ref)}` : ""}</p>` : ""}
      <ul>${(p.lineas || []).map((l) => `<li>${l.qty}× ${esc(l.nombre)} — ${money(l.precio * l.qty)}${l.detalle ? `<small>${esc(l.detalle)}</small>` : ""}</li>`).join("")}</ul>
      <div class="tot"><span>Total</span><span>${money(p.total)}</span></div>
      <p class="pago">Pago: ${pago}</p>
      ${p.notas ? `<p class="notas">Notas: ${esc(p.notas)}</p>` : ""}
      ${tiempo}
      ${final ? "" : `<div class="btns estados">
        ${p.estado === "listo" || p.estado === "en_camino" ? "" : siguiente}
        <button data-estado="entregado">Entregado</button>
        <button class="bad" data-estado="cancelado">Cancelar</button>
      </div>`}
    </article>`;
  }

  function render() {
    $("#estado").innerHTML = enLinea
      ? `<span class="dot" aria-hidden="true"></span> En vivo <button class="salir" data-salir>Salir</button>`
      : `⚠️ Sin conexión, reintentando… <button class="salir" data-salir>Salir</button>`;
    const activos = pedidos.filter((p) => !FINALES.includes(p.estado));
    const hechos = pedidos.filter((p) => FINALES.includes(p.estado));
    $("#tabs").innerHTML = `
      <button class="${tab === "activos" ? "on" : ""}" data-tab="activos">Activos<span class="n">${activos.length}</span></button>
      <button class="${tab === "hechos" ? "on" : ""}" data-tab="hechos">Terminados<span class="n">${hechos.length}</span></button>`;
    const lista = tab === "activos" ? activos.sort((a, b) => a.creado - b.creado) : hechos;
    $("#lista").innerHTML = lista.length
      ? lista.map(tarjeta).join("")
      : `<p class="vacio">${tab === "activos" ? "Sin pedidos por ahora. Los nuevos aparecen aquí solos y suena un aviso." : "Todavía no hay pedidos terminados."}</p>`;
  }

  // ---------- Sesión ----------
  function entrar() {
    $("#login").hidden = true;
    $("#app").hidden = false;
    cargar();
    clearInterval(timer);
    timer = setInterval(cargar, 5000);
  }
  function salir(pinMalo) {
    clearInterval(timer);
    pin = "";
    set("cr-pin", "");
    conocidos = null;
    $("#app").hidden = true;
    $("#login").hidden = false;
    $("#loginError").hidden = !pinMalo;
    $("#estado").innerHTML = "";
  }

  $("#loginForm").addEventListener("submit", (e) => {
    e.preventDefault();
    prepararAudio();
    pin = $("#pin").value.trim();
    set("cr-pin", pin);
    entrar();
  });

  document.addEventListener("click", (e) => {
    prepararAudio();
    const b = e.target.closest("button");
    if (!b) return;
    const d = b.dataset;
    if ("salir" in d) return salir(false);
    if ("tab" in d) { tab = d.tab; return render(); }
    const id = b.closest(".ped")?.dataset.id;
    if (!id) return;
    if ("min" in d) cambiar(id, { minutos: Number(d.min) });
    else if ("sumar" in d) cambiar(id, { sumar: Number(d.sumar) });
    else if ("reset" in d) {
      const m = prompt("¿En cuántos minutos estará? (desde ahora)", "20");
      if (m !== null && Number(m) >= 0) cambiar(id, { minutos: Number(m) });
    } else if ("estado" in d) {
      if (d.estado === "cancelado" && !confirm("¿Cancelar este pedido? El cliente lo verá en su pantalla.")) return;
      cambiar(id, { estado: d.estado });
    }
  });

  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && pin) cargar(); });

  if (pin) entrar();
  else salir(false);
})();
