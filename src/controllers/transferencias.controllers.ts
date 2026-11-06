import { Collection, ObjectId } from "mongodb";
import type { Request, Response } from "express";
import { client } from "../config/database.js";
import type { AccountT } from "../models/cuentas.models.js";
import type { MovementsT } from "../models/operaciones.models.js";
import { HttpError, send_error } from "../utils.js";
import { parse_operation_body, check_account_operation, check_withdrawal_rules, isValidIban } from "./cuentas.controllers.js";

let account_collection : Collection<AccountT>
let movements_collection : Collection<MovementsT>

export const config_account_collection_transfer_module = (collection : Collection<AccountT>) => {
    account_collection = collection;
}
export const config_movements_collection_transfer_module = (collection : Collection<MovementsT>) => {
    movements_collection = collection;
}

const calculate_commission = (origin : AccountT, destination : AccountT, importe : number) : number => {
    if (origin.clienteId.equals(destination.clienteId)) return 0;
    return Math.max(100, Math.ceil(importe * 5 / 1000));
}

export const post_transfer = async (req : Request, res : Response) => {
    const origin_iban = req.body?.ibanOrigen;
    const destination_iban = req.body?.ibanDestino;

    if (!isValidIban(origin_iban)) {
        res.status(400).json({ error : "El IBAN de origen no es válido" });
        return;
    }
    if (!isValidIban(destination_iban)) {
        res.status(400).json({ error : "El IBAN de destino no es válido" });
        return;
    }
    if (origin_iban.toUpperCase() === destination_iban.toUpperCase()) {
        res.status(400).json({ error : "El IBAN de origen y el de destino deben ser distintos" });
        return;
    }

    const body = parse_operation_body(req.body);
    if (typeof body === "string") {
        res.status(400).json({ error : body });
        return;
    }

    const session = client.startSession();
    try {
        const result = await session.withTransaction(async () => {
            const origin = await account_collection.findOne({ iban : origin_iban.toUpperCase() }, { session });
            if (!origin) throw new HttpError(404, "No existe la cuenta de origen");
            const destination = await account_collection.findOne({ iban : destination_iban.toUpperCase() }, { session });
            if (!destination) throw new HttpError(404, "No existe la cuenta de destino");

            check_account_operation(origin, "transferencia_emitida");
            check_account_operation(destination, "transferencia_recibida");

            const commission = calculate_commission(origin, destination, body.importe);
            await check_withdrawal_rules(origin, body.importe, body.importe + commission, session);

            const updated_origin = await account_collection.findOneAndUpdate(
                { _id : origin._id },
                { $inc : { saldo : -(body.importe + commission) } },
                { session, returnDocument : "after" }
            );
            const updated_destination = await account_collection.findOneAndUpdate(
                { _id : destination._id },
                { $inc : { saldo : body.importe } },
                { session, returnDocument : "after" }
            );
            if (!updated_origin || !updated_destination) throw new HttpError(404, "No existe la cuenta");

            const transferenciaId = new ObjectId();
            const fecha = new Date().toISOString();
            const movements : MovementsT[] = [
                {
                    _id : new ObjectId(),
                    cuentaId : origin._id,
                    tipo : "transferencia_emitida",
                    importe : -body.importe,
                    saldoResultante : updated_origin.saldo + commission,
                    concepto : body.concepto,
                    categoria : body.categoria,
                    transferenciaId,
                    fecha,
                },
                {
                    _id : new ObjectId(),
                    cuentaId : destination._id,
                    tipo : "transferencia_recibida",
                    importe : body.importe,
                    saldoResultante : updated_destination.saldo,
                    concepto : body.concepto,
                    categoria : body.categoria,
                    transferenciaId,
                    fecha,
                },
            ];
            if (commission > 0) {
                movements.push({
                    _id : new ObjectId(),
                    cuentaId : origin._id,
                    tipo : "comision",
                    importe : -commission,
                    saldoResultante : updated_origin.saldo,
                    concepto : `Comisión transferencia: ${body.concepto}`,
                    categoria : "comisiones",
                    transferenciaId,
                    fecha,
                });
            }
            await movements_collection.insertMany(movements, { session });

            return {
                transferenciaId,
                ibanOrigen : origin.iban,
                ibanDestino : destination.iban,
                importe : body.importe,
                comision : commission,
                saldoOrigen : updated_origin.saldo,
                concepto : body.concepto,
                categoria : body.categoria,
                fecha,
            };
        });
        res.status(201).json(result);
    } catch (err) {
        send_error(res, err, "Error al realizar la transferencia");
    } finally {
        await session.endSession();
    }
}
