# Práctica 3 – API bancaria (Express + MongoDB)

## Requisitos

- Node.js 20 o superior y npm
- MongoDB (local o MongoDB Atlas)

## Configuración del `.env`

Copia el archivo de ejemplo y rellena los valores:

```bash
cp .env.example .env
```

```env
PORT=3000
CLIENT_PASSWORD=mongodb://localhost:27017
```

- `PORT`: puerto en el que escucha el servidor.
- `CLIENT_PASSWORD`: URI de conexión a MongoDB (local o de Atlas, p. ej. `mongodb+srv://usuario:contraseña@cluster.mongodb.net`).

La base de datos usada es `backEndClases`; las colecciones e índices se crean automáticamente al arrancar.

## Levantar MongoDB

Arranca una instancia local:

```bash
mongod
```

O usa un clúster de MongoDB Atlas y pon su URI en `CLIENT_PASSWORD`.

## Instalar dependencias

```bash
npm install
```

## Arrancar el servidor

Desarrollo (recarga automática):

```bash
npm run dev
```

Producción:

```bash
npm run build
npm start
```

El servidor queda disponible en `http://localhost:<PORT>`.
