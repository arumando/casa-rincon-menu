// Monitor de cocina: solo para ver, nadie tiene que tocarlo.
// - Los pedidos aparecen solos, en orden de llegada, con aviso sonoro.
// - Se quitan solos cuando la caja los marca listos, o cuando ya pasó su hora (+ margen).
// - Opcional: con un teclado numérico USB, escribir el número + Enter lo marca como listo.
(() => {
  "use strict";

  const C = Core;
  const { $, esc, horaDe } = C;
  const MARGEN_MIN = 20; // minutos después de su hora en que un pedido sin marcar sale del monitor
  const RECIENTES_MIN = 10; // minutos que se muestran los recién listos abajo

  let pedidos = [];
  let conocidos = null;
  const nuevosHasta = new Map(); // id -> hasta cuándo se resalta como nuevo
  let timer = null;
  let enLinea = true;
  let wakeLock = null;
  let tecleado = "";

  const ahora = () => Date.now() + C.offset;
  const minutos = (ms) => Math.floor(ms / 60000);

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
    document.documentElement.requestFullscreen?.().catch(() => {});
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
  }

  async function cargar(lanzar) {
    try {
      const data = await C.api("/api/pedidos", { conPin: true });
      C.offset = data.ahora - Date.now();
      if (conocidos) {
        const nuevos = data.pedidos.filter((p) => !conocidos.has(p.id) && enCocina(p));
        if (nuevos.length) {
          C.timbre();
          nuevos.forEach((p) => nuevosHasta.set(p.id, Date.now() + 60000));
        }
      }
      conocidos = new Set(data.pedidos.map((p) => p.id));
      pedidos = data.pedidos;
      enLinea = true;
    } catch (e) {
      if (e.status === 401) {
        if (lanzar) throw e;
        C.setPin("");
        return mostrarLogin("El PIN cambió: vuelve a entrar.");
      }
      enLinea = false;
      if (lanzar) throw e;
    }
    render();
  }

  // ¿Va en el monitor? En preparación y sin pasarse demasiado de su hora.
  const enCocina = (p) =>
    (p.estado === "recibido" || p.estado === "preparando") && (!p.listoEn || ahora() < p.listoEn + MARGEN_MIN * 60000);

  function tarjeta(p) {
    const transcurrido = ahora() - p.creado;
    const total = Math.max(1, (p.listoEn || p.creado + 30 * 60000) - p.creado);
    const avance = Math.min(1, transcurrido / total);
    const faltan = p.listoEn ? Math.ceil((p.listoEn - ahora()) / 60000) : null;
    const tarde = faltan !== null && faltan < 0;
    const ronda = p.tipo === "mesa" && pedidos.some((o) => o.cuenta === p.cuenta && o.creado < p.creado && o.estado !== "cancelado");
    const nuevo = (nuevosHasta.get(p.id) || 0) > Date.now();
    return `<article class="k-ped ${tarde ? "tarde" : faltan !== null && faltan <= 5 ? "pronto" : ""} ${nuevo ? "nuevo" : ""}">
      <header>
        <span class="k-cod">#${esc(p.codigo)}</span>
        <span class="k-tipo ${p.tipo}">${esc(C.tipoLargo(p)).toUpperCase()}</span>
      </header>
      ${ronda ? '<p class="k-ronda">➕ SE AGREGÓ A LA MESA</p>' : ""}
      <ul>${(p.lineas || []).map((l) => `<li><b>${l.qty}×</b> ${esc(l.nombre)}${l.detalle ? `<small>${esc(l.detalle)}</small>` : ""}</li>`).join("")}</ul>
      ${p.notas ? `<p class="k-notas">📝 ${esc(p.notas)}</p>` : ""}
      <footer>
        <div class="k-barra"><span style="width:${Math.round(avance * 100)}%"></span></div>
        <p class="k-meta">Llegó ${horaDe(p.creado - C.offset)} · hace ${minutos(transcurrido)} min
          <b>${faltan === null ? "" : tarde ? `· ${-faltan} min TARDE` : `· faltan ${faltan} min`}</b></p>
      </footer>
    </article>`;
  }

  function render() {
    const lista = pedidos.filter(enCocina).sort((a, b) => a.creado - b.creado);
    const tarde = lista.filter((p) => p.listoEn && ahora() > p.listoEn).length;
    const recientes = pedidos
      .filter((p) => ["listo", "en_camino", "entregado"].includes(p.estado) && ahora() - p.actualizado < RECIENTES_MIN * 60000)
      .sort((a, b) => b.actualizado - a.actualizado)
      .slice(0, 8);
    $("#estado").innerHTML = `${enLinea ? '<span class="dot" aria-hidden="true"></span> En vivo' : "⚠️ Sin conexión, reintentando…"}`;
    $("#resumen").innerHTML = `<span><b>${lista.length}</b> en preparación</span>${tarde ? `<span class="k-tarde"><b>${tarde}</b> atrasado${tarde > 1 ? "s" : ""}</span>` : ""}`;
    $("#tablero").innerHTML = lista.length
      ? lista.map(tarjeta).join("")
      : `<p class="k-vacio">Sin pedidos por preparar 👌<br><small>Los nuevos aparecen aquí solos y suena un aviso.</small></p>`;
    $("#recientes").innerHTML = recientes.length
      ? `<span class="k-rec-t">Listos:</span>${recientes.map((p) => `<span class="k-rec">#${esc(p.codigo)} · ${esc(C.tipoLargo(p))}</span>`).join("")}`
      : "";
    $("#tecla").hidden = !tecleado;
    $("#tecla").textContent = tecleado ? `#${tecleado} ⏎ marcar listo` : "";
  }

  // Teclado numérico (opcional): número + Enter = listo. Supr/Retroceso borra.
  async function marcarListo(codigo) {
    const p = pedidos.find((x) => x.codigo === codigo && enCocina(x));
    if (!p) return C.aviso(`No hay pedido #${codigo} en preparación`, "error");
    try {
      await C.api(`/api/pedidos?id=${encodeURIComponent(p.id)}`, { method: "PATCH", body: { estado: "listo" }, conPin: true });
      C.aviso(`#${codigo} listo ✓`, "ok");
      await cargar();
    } catch {
      C.aviso("No se pudo marcar. Revisa el internet.", "error");
    }
  }

  document.addEventListener("keydown", (e) => {
    if ($("#app").hidden) return;
    if (/^\d$/.test(e.key)) tecleado = (tecleado + e.key).slice(-4);
    else if (e.key === "Backspace" || e.key === "Delete" || e.key === "Escape") tecleado = "";
    else if (e.key === "Enter" && tecleado) {
      marcarListo(tecleado);
      tecleado = "";
    } else return;
    e.preventDefault();
    render();
  });

  setInterval(() => {
    $("#reloj").textContent = new Date().toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit" });
  }, 1000);
  setInterval(() => { if (!$("#app").hidden) render(); }, 30000); // los minutos avanzan aunque no haya cambios

  $("#loginForm").addEventListener("submit", (e) => {
    e.preventDefault();
    C.prepararAudio();
    entrar($("#pin").value.trim());
  });
  document.addEventListener("click", () => C.prepararAudio());

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && C.pin) {
      cargar().catch(() => {});
      if (!wakeLock || wakeLock.released) mantenerEncendida();
    }
  });

  if (C.pin) entrar();
  else mostrarLogin();
})();
