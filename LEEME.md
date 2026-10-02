# Casa Rincón · menú digital (demo de Impulsa Lab)

Menú digital con pedidos para llevar y a domicilio, seguimiento en vivo y panel para el restaurante.

- `public/` — la página: `index.html` (menú del cliente) y `panel.html` (panel del encargado).
- `public/data.js` — menú, precios y WhatsApp que recibe los pedidos. Para cambiar precios solo se edita este archivo.
- `netlify/functions/pedidos.mjs` — API de pedidos (`/api/pedidos`), guarda en Netlify Blobs.

## Cómo funciona
1. El cliente arma su pedido y lo confirma: se guarda y recibe un número de pedido.
2. El encargado lo ve en `/panel.html` (con PIN) y elige en cuánto estará: 15, 20, 30… min.
3. El cliente ve el tiempo y el estado en su pantalla, actualizado cada 5 segundos.
4. El cliente también puede mandar el pedido por WhatsApp.

En las mesas, el QR abre `/?mesa`: el menú solo para ver; la orden la toman los meseros.

## Configuración
- PIN del panel: variable de entorno `PANEL_PIN` en Netlify.
- Probar en la compu: `npx netlify-cli dev` y abrir http://localhost:8888
