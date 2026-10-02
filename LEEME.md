# Casa Rincón · sistema digital (demo de Impulsa Lab)

Cuatro apps que trabajan juntas y se actualizan en vivo:

| App | Archivo | Para quién |
|---|---|---|
| Portada | `docs/index.html` | Lleva a las 4 apps |
| Pedidos | `docs/pedidos.html` | Clientes: para llevar y a domicilio. Al entrar ven el tiempo de espera y deciden si siguen; después siguen su pedido en vivo |
| Menú de mesa | `docs/menu.html` | QR en las mesas: solo para ver; la orden la toman los meseros |
| Caja | `docs/caja.html` | Encargado (con PIN): tickets de todo el menú, pedidos que llegan, tiempo de espera del día y agotados |
| Cocina | `docs/cocina.html` | Cocina (con PIN): pedidos por preparar, “Empezar” y “¡Listo!” |

## Cómo funciona
- **Tiempo de espera**: el encargado lo fija en Caja → “Tiempo y agotados” (para llevar y a domicilio) y aplica a todos los pedidos hasta que lo cambie. Si uno se atrasa, se le suman minutos desde Pedidos.
- **Agotados**: en Caja se marca un ingrediente (chorizo, pan brioche…) o un producto; desaparece al momento en todas las apps.
- **Envío a domicilio**: zonas y costos en `ZONAS` dentro de `docs/data.js`.
- **Pausar pedidos en línea**: en Caja → “Tiempo y agotados”.

## Dónde vive
- **Páginas**: GitHub Pages (rama `main`, carpeta `/docs`). Cada `git push` a `main` se publica solo en 1–2 minutos.
- **Datos en vivo** (pedidos, tiempo, agotados): API en Netlify (`netlify/functions/`), guardada en Netlify Blobs.
  Publicar cambios de la API: `npx netlify-cli deploy --prod`.
- **PIN** de caja y cocina: variable `PANEL_PIN` en Netlify (no está en el código).

## Cambiar el menú
Todo está en `docs/data.js`: platillos, precios, zonas de envío, ingredientes y WhatsApp.
