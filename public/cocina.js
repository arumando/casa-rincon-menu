// Pantalla de cocina: solo los pedidos por preparar, en orden de llegada.
(() => {
  "use strict";

  const C = Core;
  const { $, esc, horaDe } = C;

  let pedidos = [];
  let vista = "cocina"; // cocina | listos
  let conocidos = null;
  let timer = null;
  let enLinea = true;
  let wakeLock = null;

  const ahora = () => Date.now() + C.offset;
  const minutosDesde = (ts) => Math.max(0, Math.floor((ahora() - ts) / 60000));

  // Que la pantalla no se apague (si el navegador lo permite).
  async function mantenerEncendida() {
    try { wakeLock = await navigator.wakeLock?.request("screen"); } catch { /* sin soporte */ }
  }

  async function entrar(pinNuevo) {
    if (pinNuevo !== undefined) C.setPin(pinNuevo);
    try {
      await cargar(true);
    } catch (e) {
      return mostrarLogin(e.status === 401 ? "PIN incorrecto." : "No hay conexión. Intenta de nuevo.");
    }
    $("#login").hidden = true;
    $("#app").hidden = false;
    mantenerEncendida();
    clearInterval(timer);
    timer = setInterval(() => cargar().catch(() => {}), 4000);
  }

  function mostrarLogin(error) {
    clearInterval(timer);
    $("#app").hidden = true;
    $("#login").hidden = false;
    $("#loginError").hidden = !error;
    $("#loginError").textContent = error || "";
    $("#estado").innerHTML = "";
  }

  function salir() {
    C.setPin("");
    conocidos = null;
    mostrarLogin();
  }

  async function cargar(lanzar) {
    try {
      const data = await C.api("/api/pedidos", { conPin: true });
      C.offset = data.ahora - Date.now();
      if (conocidos) {
        const nuevos = data.pedidos.filter((p) => !conocidos.has(p.id));
        if (nuevos.length) C.timbre();
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
    render();
  }

  async function cambiar(id, estado) {
    try {
      const { pedido } = await C.api(`/api/pedidos?id=${encodeURIComponent(id)}`, { method: "PATCH", body: { estado }, conPin: true });
      pedidos = pedidos.map((p) => (p.id === id ? pedido : p));
      render();
    } catch (e) {
      if (e.status === 401) return salir();
      C.aviso("No se pudo guardar. Revisa el internet.", "error");
    }
  }

  function tarjeta(p) {
    const min = minutosDesde(p.creado);
    const tarde = p.listoEn && ahora() > p.listoEn;
    const enCocina = p.estado === "recibido" || p.estado === "preparando";
    const boton = p.estado === "recibido"
      ? `<button class="k-btn empezar" data-estado="preparando">▶ Empezar</button>`
      : p.estado === "preparando"
        ? `<button class="k-btn listo" data-estado="listo">✅ ¡Listo!</button>`
        : `<button class="k-btn volver" data-estado="preparando">↩ Regresar a cocina</button>`;
    return `<article class="k-ped ${p.estado} ${tarde && enCocina ? "tarde" : ""}" data-id="${p.id}">
      <header>
        <span class="k-cod">#${esc(p.codigo)}</span>
        <span class="k-tipo ${p.tipo}">${esc(C.tipoLargo(p)).toUpperCase()}</span>
      </header>
      <p class="k-meta">Llegó ${horaDe(p.creado - C.offset)} · hace ${min} min${p.listoEn && p.tipo !== "mesa" ? ` · entregar ~${horaDe(p.listoEn - C.offset)}` : ""}</p>
      <ul>${(p.lineas || []).map((l) => `<li><b>${l.qty}×</b> ${esc(l.nombre)}${l.detalle ? `<small>${esc(l.detalle)}</small>` : ""}</li>`).join("")}</ul>
      ${p.notas ? `<p class="k-notas">📝 ${esc(p.notas)}</p>` : ""}
      ${boton}
    </article>`;
  }

  function render() {
    $("#estado").innerHTML = `${enLinea ? '<span class="dot" aria-hidden="true"></span> En vivo' : "⚠️ Sin conexión, reintentando…"} <button class="salir" data-salir>Salir</button>`;
    const enCocina = pedidos.filter((p) => p.estado === "recibido" || p.estado === "preparando").sort((a, b) => a.creado - b.creado);
    const listos = pedidos.filter((p) => ["listo", "en_camino", "entregado"].includes(p.estado)).sort((a, b) => b.actualizado - a.actualizado).slice(0, 12);
    $("#filtros").innerHTML = `
      <button class="${vista === "cocina" ? "on" : ""}" data-vista="cocina">Por preparar <span class="n">${enCocina.length}</span></button>
      <button class="${vista === "listos" ? "on" : ""}" data-vista="listos">Listos <span class="n">${listos.length}</span></button>`;
    const lista = vista === "cocina" ? enCocina : listos;
    $("#tablero").innerHTML = lista.length
      ? lista.map(tarjeta).join("")
      : `<p class="vacio">${vista === "cocina" ? "Sin pedidos por preparar 👌<br>Los nuevos aparecen aquí solos y suena un aviso." : "Aún no hay pedidos listos."}</p>`;
  }

  setInterval(() => { $("#reloj").textContent = new Date().toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit" }); }, 1000);

  $("#loginForm").addEventListener("submit", (e) => {
    e.preventDefault();
    C.prepararAudio();
    entrar($("#pin").value.trim());
  });

  document.addEventListener("click", (e) => {
    C.prepararAudio();
    const b = e.target.closest("button");
    if (!b) return;
    const d = b.dataset;
    if ("salir" in d) return salir();
    if ("vista" in d) { vista = d.vista; return render(); }
    const id = b.closest(".k-ped")?.dataset.id;
    if (id && "estado" in d) cambiar(id, d.estado);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && C.pin) {
      cargar().catch(() => {});
      if (!wakeLock || wakeLock.released) mantenerEncendida();
    }
  });

  if (C.pin) entrar();
  else mostrarLogin();
})();
