# Casa Rincón · sistema digital (demo de Impulsa Lab)

Cuatro apps que trabajan juntas y se actualizan en vivo:

| App | Archivo | Para quién |
|---|---|---|
| Portada | `docs/index.html` | Lleva a las 4 apps |
| Pedidos | `docs/pedidos.html` | Clientes: para llevar y a domicilio. Al entrar ven el tiempo de espera y deciden si siguen; después siguen su pedido en vivo |
| Menú de mesa | `docs/menu.html` | QR en las mesas: solo para ver; la orden la toman los meseros |
| Caja | `docs/caja.html` | Encargada (con PIN, desde el celular): tickets, mesas abiertas, pedidos que llegan, tiempo de espera y lo que se acabó |
| Cocina | `docs/cocina.html` | Monitor (PIN una sola vez): pedidos por preparar, solo para ver |

## Cómo funciona
- **Tiempo de espera**: el encargado lo fija en Caja → Ajustes (para llevar y a domicilio) y aplica a todos los pedidos hasta que lo cambie. Si uno se atrasa, se le suman minutos desde Pedidos.
- **Se acabó un ingrediente**: en Caja → Ajustes. Si es un ingrediente normal (chorizo, piña…) el platillo se sigue vendiendo y se pregunta "¿sin ese ingrediente o con otro?". Si es base (pan, pasta, papas) el platillo se apaga.
- **Mesas**: el ticket de una mesa queda como cuenta abierta (pestaña Mesas): se le agregan rondas, se quitan productos y se cobra al final.
- **Cocina**: monitor solo para ver; los pedidos se quitan cuando la caja los marca o al pasar su hora. Opcional: teclado numérico, número + Enter = listo.
- **Envío a domicilio**: zonas y costos en `ZONAS` dentro de `docs/data.js`.
- **Pausar pedidos en línea**: en Caja → Ajustes.

## Dónde vive
- **Páginas**: GitHub Pages (rama `main`, carpeta `/docs`). Cada `git push` a `main` se publica solo en 1–2 minutos.
- **Datos en vivo** (pedidos, tiempo, agotados): API en Netlify (`netlify/functions/`), guardada en Netlify Blobs.
  Publicar cambios de la API: `npx netlify-cli deploy --prod`.
- **PIN** de caja y cocina: variable `PANEL_PIN` en Netlify (no está en el código).

## Cambiar el menú
Todo está en `docs/data.js`: platillos, precios, zonas de envío, ingredientes y WhatsApp.
