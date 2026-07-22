# Backend en la nube — El Mundo de Cloe

Este backend conecta tu app a tu clúster de **TiDB Cloud** usando
**Netlify Functions** (funciones serverless que viven junto a tu sitio).

## 1. Crear las tablas en TiDB

1. Entra a tu clúster en TiDB Cloud → pestaña **SQL Editor** (o conéctate con
   cualquier cliente MySQL usando los datos de conexión de tu clúster).
2. Copia y ejecuta todo el contenido de `esquema.sql`.
3. Verifica que se crearon las tablas: `clients`, `orders`, `order_items`,
   `payments`, `proformas`, `proforma_items`, `document_log`, y las vistas
   `client_balances` y `order_balances`.

## 2. Subir este backend a Netlify

**Opción A — junto a tu sitio actual (recomendado):**
Copia la carpeta `netlify/` y el archivo `netlify.toml` dentro del mismo
repositorio de GitHub donde ya tienes `elmundodecloe.netlify.app`. Netlify
detecta la carpeta `netlify/functions` automáticamente y despliega las
funciones cada vez que subes cambios.

**Opción B — sitio nuevo separado:**
Sube esta carpeta completa a un repositorio nuevo en GitHub y conéctalo a un
nuevo sitio en Netlify.

## 3. Configurar las variables de entorno en Netlify

En Netlify: **Site settings → Environment variables**, agrega:

| Variable        | Dónde encontrarla en TiDB Cloud                          |
|-----------------|-----------------------------------------------------------|
| `TIDB_HOST`     | Clúster → Connect → Host                                   |
| `TIDB_PORT`     | Normalmente `4000`                                          |
| `TIDB_USER`     | Clúster → Connect → User (ej. `xxxxx.root`)                |
| `TIDB_PASSWORD` | La contraseña que generaste al crear el usuario             |
| `TIDB_DATABASE` | `mundo_de_cloe` (el nombre que usa el esquema.sql)          |

**Nunca pongas estas credenciales dentro del HTML de tu app** — por eso
viven aquí, en el backend, donde nadie más las puede ver.

## 4. Instalar dependencias y desplegar

Netlify instala `mysql2` automáticamente al desplegar gracias al
`package.json` incluido. Si quieres probarlo en tu computadora antes:

```
npm install
npm install -g netlify-cli
netlify dev
```

Esto levanta las funciones en `http://localhost:8888/api/...`

## 5. Endpoints disponibles

| Método | Ruta                              | Qué hace                                  |
|--------|------------------------------------|--------------------------------------------|
| GET    | `/api/clients`                     | Lista todos los clientes con su saldo       |
| GET    | `/api/clients?id=5`                | Detalle de un cliente + pedidos + pagos     |
| POST   | `/api/clients`                     | Crea un cliente                             |
| POST   | `/api/orders`                      | Crea un pedido con sus artículos            |
| POST   | `/api/payments`                    | Registra un abono                           |
| POST   | `/api/proformas`                   | Crea una proforma                           |
| POST   | `/api/proformas?action=convert`    | Convierte una proforma en pedido real       |
| GET    | `/api/summary`                     | Totales para el encabezado (clientes, etc.) |

Todos devuelven y reciben JSON. Ejemplos de body en los comentarios de cada
archivo dentro de `netlify/functions/`.

## 6. Siguiente paso: conectar tu app HTML a esta API

Tu artifact actual guarda todo con `window.storage` (memoria de Claude).
El siguiente paso es cambiar esas llamadas por `fetch('/api/clients')`, etc.
Dime cuando tengas el backend desplegado y funcionando, y actualizo la app
para que hable con esta API en vez de guardar los datos en el navegador.
