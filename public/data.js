// Menú de Casa Rincón "Del horno a la mesa" (Oaxaca), capturado de su menú publicado.
// Para cambiar precios o platillos solo se edita este archivo.

const CONFIG = {
  nombre: "Casa Rincón",
  lema: "Del horno a la mesa",
  ciudad: "Oaxaca",
  // WhatsApp que recibe los pedidos: 52 + 10 dígitos. Para la demo, el número de Impulsa Lab.
  whatsapp: "529241796248",
  // El tiempo de entrega no es fijo: lo pone el encargado desde el panel (panel.html).
};

const TAMANOS = [
  { id: "personal", nombre: "Personal", reb: 4 },
  { id: "mediana", nombre: "Mediana", reb: 6 },
  { id: "grande", nombre: "Grande", reb: 8 },
  { id: "familiar", nombre: "Familiar", reb: 10 },
  { id: "jumbo", nombre: "Jumbo", reb: 12 },
  { id: "gigante", nombre: "La Gigante", reb: 20 },
];

// Precio por tamaño, en el mismo orden que TAMANOS.
const PRECIOS = {
  clasica: [125, 195, 240, 290, 340, 680],
  especialidad: [150, 235, 295, 350, 400, 790],
};

// Orilla rellena de queso Philadelphia, por tamaño.
const ORILLA = [80, 110, 150, 170, 200, 300];

// Costo de cada sabor adicional después del segundo (solo La Gigante, hasta 4 sabores).
const EXTRA_SABOR = { clasica: 35, especialidad: 40 };

const CATEGORIAS = [
  { id: "clasicas", nombre: "Pizzas clásicas", img: "pepperoni.jpg" },
  { id: "especialidades", nombre: "Pizzas especialidades", img: "cuachirindo.jpg" },
  { id: "breadlab", nombre: "Bread Lab", img: "calzone.jpg" },
  { id: "pastas", nombre: "Pastas", icono: "🍝" },
  { id: "acompanantes", nombre: "Ensalada y papas", icono: "🥗" },
];

const ITEMS = [
  // ---------- Pizzas clásicas ----------
  { id: "margarita", cat: "clasicas", tipo: "pizza", linea: "clasica", nombre: "Margarita", lema: "Sutil y ligera",
    desc: "Fusión de quesos, salsa de la casa, rebanadas de tomate al pesto, albahaca orgánica y su toque de queso parmesano.", sinCarne: true },
  { id: "hawaiana", cat: "clasicas", tipo: "pizza", linea: "clasica", nombre: "Hawaiana", lema: "Un clásico de la pizza latina",
    desc: "Fusión de quesos, salsa de la casa, jamón de pavo, piña y pesto." },
  { id: "cubana", cat: "clasicas", tipo: "pizza", linea: "clasica", nombre: "Cubana", lema: "La llenadora",
    desc: "Fusión de quesos, salsa de la casa, salchicha de pavo, piña y salsa BBQ." },
  { id: "peppechamps", cat: "clasicas", tipo: "pizza", linea: "clasica", nombre: "Peppechamps", lema: "Jugosa explosión",
    desc: "Mezcla de quesos, salsa de la casa, pepperoni y champiñones frescos al pesto." },
  { id: "carnes-frias", cat: "clasicas", tipo: "pizza", linea: "clasica", nombre: "Carnes frías", lema: "Bien calientes",
    desc: "Fusión de quesos, jamón de pavo, salchicha de pavo, pepperoni y salsa de la casa." },
  { id: "champinones", cat: "clasicas", tipo: "pizza", linea: "clasica", nombre: "Champiñones", lema: "Pura sabrosura",
    desc: "Mezcla de quesos, salsa de la casa, champiñones, pimiento morrón, cebolla morada y pesto.", sinCarne: true },
  { id: "choriqueso", cat: "clasicas", tipo: "pizza", linea: "clasica", nombre: "Choriqueso", lema: "Para los amantes del chori",
    desc: "Chorizo precocido, mezcla de quesos y salsa de la casa." },
  { id: "mexicana", cat: "clasicas", tipo: "pizza", linea: "clasica", nombre: "Mexicana", lema: "¡Ajuaaa!",
    desc: "Fusión de quesos, salsa de la casa, chorizo precocido y chile jalapeño.", picante: true },
  { id: "pepperoni", cat: "clasicas", tipo: "pizza", linea: "clasica", nombre: "Pepperoni", lema: "Otro gran clásico",
    desc: "Mezcla de quesos, salsa de la casa y pepperoni campestre.", img: "pepperoni.jpg" },
  { id: "dos-quesos", cat: "clasicas", tipo: "pizza", linea: "clasica", nombre: "Dos quesos", lema: "Equilibrada",
    desc: "Queso mozzarella, queso manchego, salsa de la casa y su toque de pesto.", sinCarne: true },
  { id: "peppenos", cat: "clasicas", tipo: "pizza", linea: "clasica", nombre: "Peppeños", lema: "Un golpe de sabor",
    desc: "Mezcla de quesos, salsa de la casa, pepperoni campestre, rodajas de chile jalapeño y su toque de pesto.", picante: true },

  // ---------- Pizzas especialidades ----------
  { id: "cuachirindo", cat: "especialidades", tipo: "pizza", linea: "especialidad", nombre: "Cuachirindo", lema: "El gran jefe",
    desc: "Fusión de quesos, salsa de la casa, pimiento morrón, pepperoni, champiñón, queso crema, cebolla morada y aceitunas negras.", img: "cuachirindo.jpg" },
  { id: "juppa", cat: "especialidades", tipo: "pizza", linea: "especialidad", nombre: "Juppa", lema: "El gran capitán zapoteca",
    desc: "Fusión de quesos, salsa de la casa, jamón de pavo, chorizo precocido, piña y chile jalapeño.", picante: true },
  { id: "5-quesos", cat: "especialidades", tipo: "pizza", linea: "especialidad", nombre: "5 Quesos", lema: "Sin palabras, deli deli",
    desc: "Queso mozzarella, queso manchego, queso gouda, queso crema, queso parmesano y pesto.", img: "5-quesos.jpg", sinCarne: true },
  { id: "peppe-lovers", cat: "especialidades", tipo: "pizza", linea: "especialidad", nombre: "Peppe-Lover's", lema: "Mucho peppe",
    desc: "Fusión de quesos, salsa de la casa y pepperoni extra, extra pepperoni." },
  { id: "chapulines", cat: "especialidades", tipo: "pizza", linea: "especialidad", nombre: "Chapulines", lema: "La de Oax",
    desc: "Fusión de quesos, salsa de la casa, chapulines al ajo y pesto." },
  { id: "pomelia", cat: "especialidades", tipo: "pizza", linea: "especialidad", nombre: "Pomelia", lema: "Dulce combinación",
    desc: "Fusión de quesos, salsa de la casa, manzana verde, nuez, queso de cabra y miel 100% orgánica.", sinCarne: true },
  { id: "honey-pepperoni", cat: "especialidades", tipo: "pizza", linea: "especialidad", nombre: "Honey Pepperoni", lema: "Dulce, picoso y jugoso",
    desc: "Fusión de quesos, salsa de la casa, pepperoni, pimiento quebrajado, miel de maple, queso parmesano y pesto.", picante: true },
  { id: "bacon-bliss", cat: "especialidades", tipo: "pizza", linea: "especialidad", nombre: "Bacon Bliss", lema: "La del TikTok",
    desc: "Fusión de quesos más la mezcla viral de tocino horneado con cebolla morada, el toque picante del chile jalapeño y parmesano.", picante: true },
  { id: "campestre", cat: "especialidades", tipo: "pizza", linea: "especialidad", nombre: "Campestre", lema: "Jugosa y fresca",
    desc: "Fusión de quesos, salsa de la casa, pimiento morrón, cebolla morada, abundantes elotitos y champiñones naturales en láminas.", img: "campestre.jpg", sinCarne: true },
  { id: "vegetariana", cat: "especialidades", tipo: "pizza", linea: "especialidad", nombre: "Vegetariana", lema: "Cero carne",
    desc: "Queso, salsa de la casa, pimiento morrón, cebolla morada, cargadita de aceitunas negras y champiñones frescos.", sinCarne: true },
  { id: "levanta-muertos", cat: "especialidades", tipo: "pizza", linea: "especialidad", nombre: "Levanta Muertos", lema: "Picosa pero sabrosa",
    desc: "Fusión de quesos, salsa de la casa, chile jalapeño, chile chipotle, salsa Tabasco, búfalo, salsa habanera, salsa macha, salchicha de pavo, pepperoni y jamón.", picante: true },
  { id: "lappa", cat: "especialidades", tipo: "pizza", linea: "especialidad", nombre: "Lappa", lema: "La princesa",
    desc: "Fusión de quesos, salsa de la casa, pepperoni, champiñones, aceitunas negras, queso parmesano y pesto." },
  { id: "serrana-real", cat: "especialidades", tipo: "pizza", linea: "especialidad", nombre: "Serrana Real", lema: "Especial",
    desc: "Fusión de quesos, jamón serrano maduro, toque de queso crema y queso parmesano." },

  // ---------- Bread Lab ----------
  { id: "chiken-bake", cat: "breadlab", nombre: "Chiken-Bake", precio: 120, icono: "🥖",
    desc: "Pechuga de pollo horneada, tocino, queso manchego, queso parmesano, aderezo ranch y paprika, envueltos en masa de orégano con una costra de quesos." },
  { id: "calzones", cat: "breadlab", nombre: "Calzones", lema: "El de batalla", img: "calzone.jpg",
    desc: "Pan de pizza relleno de tus sabores favoritos. Los especiales llevan además cubierta.",
    variantes: [
      { nombre: "Calzone clásico", precio: 60, sabores: "clasica" },
      { nombre: "Calzone especialidad", precio: 90, sabores: "especialidad" },
      { nombre: "Calzone especial (relleno y cubierto, clásico)", precio: 110, sabores: "clasica" },
      { nombre: "Calzone especial especialidad (relleno y cubierto)", precio: 130, sabores: "especialidad" },
    ] },
  { id: "pizza-rolls", cat: "breadlab", nombre: "Pizza Rolls", img: "rolls.jpg",
    desc: "Rollitos de pizza horneados. Máximo dos sabores por orden.",
    variantes: [
      { nombre: "Orden de 5 clásicos", precio: 220, sabores: "clasica", max: 2 },
      { nombre: "Orden de 10 clásicos", precio: 360, sabores: "clasica", max: 2 },
      { nombre: "Orden de 5 especialidad", precio: 280, sabores: "especialidad", max: 2 },
      { nombre: "Orden de 10 especialidad", precio: 460, sabores: "especialidad", max: 2 },
    ] },
  { id: "mega-jochos", cat: "breadlab", nombre: "Mega Jochos", icono: "🌭",
    desc: "Pan brioche suave horneado en casa, con doble salchicha de pavo, salsa y aderezo, con una cubierta tipo pizza.",
    variantes: [
      { nombre: "Mega Jocho clásico", precio: 120, sabores: "clasica" },
      { nombre: "Mega Jocho especialidad", precio: 130, sabores: "especialidad" },
    ] },
  { id: "dogo-pizza", cat: "breadlab", nombre: "Dogo Pizza", precio: 130, icono: "🌭",
    desc: "Masa de pizza cubierta por un par de salchichas de pavo San Rafael, con salsa de tomate casera, pepperoni, quesos y chimichurri (hotdog en pizza)." },
  { id: "emparedado", cat: "breadlab", nombre: "Emparedado", precio: 120, img: "emparedado.jpg",
    desc: "Pan de orégano con aderezos de la casa y su salsa, y vegetales frescos.",
    sabores: ["Arrachera", "Tasajo", "Pierna", "Pechuga", "Chorizo argentino", "Hawaiano", "Cubano", "Pepperoni", "Choriqueso", "Quesos", "Mexicano"] },
  { id: "baguepizzas", cat: "breadlab", nombre: "Baguepizzas", img: "baguepizza.jpg",
    desc: "Pan de orégano crujiente horneado en casa, con su salsa casera y queso gouda gratinado.",
    variantes: [
      { nombre: "Baguepizza clásica", precio: 70, sabores: "clasica" },
      { nombre: "Baguepizza especialidad", precio: 90,
        sabores: ["Juppa", "Cuachirindo", "Quesos", "Levanta Muertos", "Chapulines", "Peppelovers", "Vegetariana", "Campestre"] },
    ] },
  { id: "chori-pan", cat: "breadlab", nombre: "Chori-Pan", precio: 120, img: "jocho.jpg",
    desc: "Pan brioche suave horneado en casa, su capa de aderezos y salsas especiales, con queso gouda gratinado, cubriendo un chorizo 100% elaborado en casa con su toque de chimichurri." },

  // ---------- Pastas ----------
  { id: "pastas", cat: "pastas", nombre: "Pastas", precio: 200, icono: "🍝",
    desc: "Dile stop al hambre: pasta de 130 g con su respectivo pan crujiente al pesto. Tiempo de preparación: 40 minutos.",
    sabores: ["Boloñesa", "5 quesos", "Pesto", "Tocino y champis"] },

  // ---------- Ensalada y papas ----------
  { id: "ensalada", cat: "acompanantes", nombre: "Ensalada de la casa", precio: 140, icono: "🥗", sinCarne: true,
    desc: "Lechuga, tomate, aguacate, pepino, pimiento morrón, aceitunas, cebolla morada, ajonjolí, elotitos, vinagreta y pan tostado.",
    extras: [{ nombre: "Agregar pollo", precio: 50 }, { nombre: "Agregar arrachera", precio: 50 }] },
  { id: "papas", cat: "acompanantes", nombre: "Orden de papas", precio: 75, icono: "🍟", sinCarne: true,
    desc: "Papas a la francesa sazonadas con el toque de la casa." },
];
