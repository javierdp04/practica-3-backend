import "dotenv/config";
import express, { type ErrorRequestHandler } from "express";
import { connect_mongo } from "./config/database.js";
import client_router from "./routes/clientes.routes.js"
import account_router from "./routes/cuentas.routes.js"
import transfer_router from "./routes/transferencias.routes.js"
import { config_client_collection } from "./controllers/clientes.controllers.js";
import { config_account_collection, config_client_collection_account_module, config_movements_collection } from "./controllers/cuentas.controllers.js";
import { config_account_collection_transfer_module, config_movements_collection_transfer_module } from "./controllers/transferencias.controllers.js";
import type { ClientT } from "./models/clientes.models.js";
import type { AccountT } from "./models/cuentas.models.js";
import type { MovementsT } from "./models/operaciones.models.js";

const app = express();

const PORT = process.env.PORT;

app.use(express.json());

const error_handler : ErrorRequestHandler = (err, _req, res, _next) => {
    if (err?.type === "entity.parse.failed") {
        res.status(400).json({ error : "El cuerpo de la petición no es un JSON válido" });
        return;
    }
    res.status(500).json({ error : "Error inesperado" });
}

const start_server = async() => {
    try{
        const bank_db = await connect_mongo();

        const clients = bank_db.collection<ClientT>("clientes");
        const accounts = bank_db.collection<AccountT>("cuentas");
        const movements = bank_db.collection<MovementsT>("movimientos");

        await clients.createIndex({ email : 1 }, { unique : true });
        await clients.createIndex({ dni : 1 }, { unique : true });
        await accounts.createIndex({ iban : 1 }, { unique : true });
        await accounts.createIndex({ clienteId : 1, estado : 1 });
        await movements.createIndex({ cuentaId : 1, fecha : -1 });

        config_client_collection(clients);
        config_account_collection(accounts);
        config_client_collection_account_module(clients);
        config_movements_collection(movements);
        config_account_collection_transfer_module(accounts);
        config_movements_collection_transfer_module(movements);

        app.use("/clientes", client_router);
        app.use("/cuentas", account_router);
        app.use("/transferencias", transfer_router);

        app.use((_req, res) => {
            res.status(404).json({ error : "Ruta no encontrada" });
        });
        app.use(error_handler);

        app.listen(PORT, () => {
            console.log(`Server listen on Port: ${PORT}`)
        })
    }catch{
        console.log("Error starting the server");
    }
}

start_server();
