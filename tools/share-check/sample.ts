import type { Message } from "@/shared/types";

// A made-up reply with everything the chat draws, to check that an image, a PDF and a Markdown file of it look right.
// When the chat learns to draw something new, it is added here.

export const QUESTION: Message = {
  role: "user",
  content: "¿Cómo va la tienda de Marta este semestre? Explícame también la fórmula del margen.",
};

const ANSWER_TEXT = String.raw`## Resumen del semestre

Las ventas de la **tienda de Marta** crecieron un _18 %_ respecto al semestre anterior [1], sobre todo por la
línea \`cuadernos\` y la [web nueva](https://ejemplo.com/tienda). El precio medio pasó de $12 a $14 por pedido.

### Lo más importante

- Mejor mes: **mayo**, con 30 pedidos.
- [x] Catálogo actualizado
- [ ] Revisar envíos internacionales

1. Mantener los precios.
2. Ampliar la línea de agendas [2].

| Mes | Pedidos | Ingresos |
|---|--:|--:|
| Enero | 12 | 168 € |
| Mayo | 30 | 420 € |
| Junio | 27 | 378 € |

> Las cifras son aproximadas y no incluyen devoluciones.

Los envíos de junio se retrasaron[^envios] y el precio antiguo ~~de 12 €~~ ya no se aplica[^precio].

[^envios]: Por la huelga de transporte de la segunda semana.
[^precio]: Desde el 1 de junio.

---

> [!WARNING]
> Revisa el stock de agendas antes de junio: en mayo se agotaron **dos semanas**.

> [!TIP] Un atajo para los envíos
> Agrupa los pedidos del viernes y envíalos juntos.

## La fórmula del margen

El margen es $m = \frac{p - c}{p}$, donde $p \neq 0$ es el precio y $c$ el coste. Con varios productos se suma
cada uno con su peso $w_i$:

$$
M = \sum_{i=1}^{n} w_i \, \frac{p_i - c_i}{p_i}
$$

Si $p = 14$ y $c = 9$, el margen es $\frac{5}{14} \approx 0{,}36$, y el discriminante de $x^2 - 5x + 6 = 0$ es
$\Delta = 1 > 0$.

## Las ventas en gráficos

\`\`\`chart
{"type": "bar", "title": "Ingresos por canal", "labels": ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio"],
 "series": [{"name": "Tienda", "values": [120, 150, 135, 180, 260, 230]},
            {"name": "Web", "values": [48, 60, 75, 90, 160, 148]}], "unit": "€"}
\`\`\`

\`\`\`chart
{"type": "line", "title": "Pedidos por semana", "labels": ["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8"],
 "series": [{"name": "2025", "values": [8, 11, 9, 14, null, 18, 21, 19]}]}
\`\`\`

\`\`\`chart
{"type": "pie", "title": "Ventas por línea", "labels": ["Cuadernos", "Agendas", "Láminas", "Otros"],
 "series": [{"values": [45, 30, 20, 5]}], "unit": "%"}
\`\`\`

## Cómo se prepara un pedido

\`\`\`mermaid
flowchart LR
  A[Pedido] --> B{¿Pagado?}
  B -->|Sí| C[Preparar]
  B -->|No| D[Recordatorio]
  C --> E[Enviar]
\`\`\`

\`\`\`mermaid
pie title Ventas por línea
  "Cuadernos" : 45
  "Agendas" : 30
  "Láminas" : 25
\`\`\`

\`\`\`ts
// Margen de un producto
const margin = (price: number, cost: number) => (price - cost) / price;
\`\`\`

\`\`\`diff
- const shipping = 4.5;
+ const shipping = order.total > 50 ? 0 : 4.5;
  const total = order.total + shipping;
\`\`\`

\`\`\`ts
const catalog = [
  { "producto": "Cuaderno 1", "precio": 11, "stock": 3 },
  { "producto": "Cuaderno 2", "precio": 12, "stock": 6 },
  { "producto": "Cuaderno 3", "precio": 13, "stock": 9 },
  { "producto": "Cuaderno 4", "precio": 14, "stock": 12 },
  { "producto": "Cuaderno 5", "precio": 15, "stock": 15 },
  { "producto": "Cuaderno 6", "precio": 16, "stock": 18 },
  { "producto": "Cuaderno 7", "precio": 10, "stock": 21 },
  { "producto": "Cuaderno 8", "precio": 11, "stock": 24 },
  { "producto": "Cuaderno 9", "precio": 12, "stock": 27 },
  { "producto": "Cuaderno 10", "precio": 13, "stock": 30 },
  { "producto": "Cuaderno 11", "precio": 14, "stock": 33 },
  { "producto": "Cuaderno 12", "precio": 15, "stock": 36 },
  { "producto": "Cuaderno 13", "precio": 16, "stock": 39 },
  { "producto": "Cuaderno 14", "precio": 10, "stock": 42 },
  { "producto": "Cuaderno 15", "precio": 11, "stock": 45 },
  { "producto": "Cuaderno 16", "precio": 12, "stock": 48 },
  { "producto": "Cuaderno 17", "precio": 13, "stock": 51 },
  { "producto": "Cuaderno 18", "precio": 14, "stock": 54 },
  { "producto": "Cuaderno 19", "precio": 15, "stock": 57 },
  { "producto": "Cuaderno 20", "precio": 16, "stock": 60 },
  { "producto": "Cuaderno 21", "precio": 10, "stock": 63 },
  { "producto": "Cuaderno 22", "precio": 11, "stock": 66 },
  { "producto": "Cuaderno 23", "precio": 12, "stock": 69 },
  { "producto": "Cuaderno 24", "precio": 13, "stock": 72 },
  { "producto": "Cuaderno 25", "precio": 14, "stock": 75 },
  { "producto": "Cuaderno 26", "precio": 15, "stock": 78 },
  { "producto": "Cuaderno 27", "precio": 16, "stock": 81 },
  { "producto": "Cuaderno 28", "precio": 10, "stock": 84 },
  { "producto": "Cuaderno 29", "precio": 11, "stock": 87 },
  { "producto": "Cuaderno 30", "precio": 12, "stock": 90 },
  { "producto": "Cuaderno 31", "precio": 13, "stock": 93 },
  { "producto": "Cuaderno 32", "precio": 14, "stock": 96 },
  { "producto": "Cuaderno 33", "precio": 15, "stock": 99 },
];
\`\`\`

\`\`\`
{"producto":"Cuaderno A5","precio":14,"etiquetas":["papel","agenda"],"stock":{"tienda":12,"web":30}}
\`\`\`

<nyra-document title="Informe del semestre" filename="informe-semestre.md">
# Informe del semestre

Las ventas subieron un 18 %. El margen medio fue $M \approx 0{,}36$.

| Línea | Ventas |
|---|--:|
| Cuadernos | 45 |
| Agendas | 30 |

![Panel de la tienda](panel-tienda.png)
</nyra-document>

¿Quieres que prepare el informe completo con los gráficos de cada mes?`
  // Raw, so the formulas keep their backslashes; the code marks are escaped only to fit inside it
  .replaceAll("\\`", "`");

export const ANSWER: Message = {
  role: "assistant",
  content: ANSWER_TEXT,
  webSearch: {
    steps: [
      {
        query: "ventas papelería semestre",
        engine: "duckduckgo",
        sources: [
          { n: 1, title: "Informe de comercio minorista", url: "https://ejemplo.com/comercio" },
          { n: 2, title: "Tendencias en papelería", url: "https://ejemplo.org/papeleria" },
        ],
      },
    ],
  },
};
