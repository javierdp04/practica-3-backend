import { Collection, ObjectId, type ClientSession, type Filter } from "mongodb";
import type { Request, Response } from "express";
import { randomInt } from "node:crypto";
import { client } from "../config/database.js";
import { ESTADOS_CUENTA, TIPOS_CUENTA, type AccountT, type EstadoCuenta, type TipoCuenta } from "../models/cuentas.models.js";
import type { ClientT } from "../models/clientes.models.js";
import { TIPOS_MOVIMIENTO, type MovementsT, type TipoMovimiento } from "../models/operaciones.models.js";
import { HttpError, duplicated_key, is_object_id, paginated, parse_pagination, send_error } from "../utils.js";

let account_collection : Collection<AccountT>
let client_collection : Collection<ClientT>
let movements_collection : Collection<MovementsT>

export const config_account_collection = (collection : Collection<AccountT>) => {
    account_collection = collection;
}
export const config_client_collection_account_module = (collection : Collection<ClientT>) => {
    client_collection = collection;
}
export const config_movements_collection = (collection : Collection<MovementsT>) => {
    movements_collection = collection;
}

const MAX_CUENTAS_ABIERTAS = 3;
const MAX_INTENTOS_IBAN = 5;

export const get_accounts = async (req : Request, res : Response) => {
    const pagination = parse_pagination(req.query);
    if (typeof pagination === "string") {
        res.status(400).json({ error : pagination });
        return;
    }
    const { pagina, limite } = pagination;

    const filter : Filter<AccountT> = {};

    if (req.query.clienteId !== undefined) {
        if (!is_object_id(req.query.clienteId)) {
            res.status(400).json({ error : "clienteId no es un ObjectId válido" });
            return;
        }
        filter.clienteId = new ObjectId(req.query.clienteId);
    }
    if (req.query.tipo !== undefined) {
        if (!is_tipo_cuenta(req.query.tipo)) {
            res.status(400).json({ error : `tipo debe ser uno de: ${TIPOS_CUENTA.join(", ")}` });
            return;
        }
        filter.tipo = req.query.tipo;
    }
    if (req.query.estado !== undefined) {
        if (!is_estado_cuenta(req.query.estado)) {
            res.status(400).json({ error : `estado debe ser uno de: ${ESTADOS_CUENTA.join(", ")}` });
            return;
        }
        filter.estado = req.query.estado;
    }

    try {
        const [datos, total] = await Promise.all([
            account_collection.find(filter).sort({ creadaEn : 1, _id : 1 }).skip((pagina - 1) * limite).limit(limite).toArray(),
            account_collection.countDocuments(filter),
        ]);
        res.json(paginated(datos, pagina, limite, total));
    } catch {
        res.status(500).json({ error : "Error al listar las cuentas" });
    }
}

export const post_account = async (req : Request, res : Response) => {
    const { clienteId, tipo } = req.body ?? {};

    if (!is_object_id(clienteId)) {
        res.status(400).json({ error : "clienteId no es un ObjectId válido" });
        return;
    }
    if (!is_tipo_cuenta(tipo)) {
        res.status(400).json({ error : `tipo debe ser uno de: ${TIPOS_CUENTA.join(", ")}` });
        return;
    }

    try {
        const client_id = new ObjectId(clienteId);

        const client_on_database = await client_collection.findOne({ _id : client_id });
        if (!client_on_database) {
            res.status(404).json({ error : "No existe el cliente" });
            return;
        }

        const open_accounts = await account_collection.countDocuments({
            clienteId : client_id,
            estado : { $ne : "cerrada" }
        });
        if (open_accounts >= MAX_CUENTAS_ABIERTAS) {
            res.status(409).json({ error : `El cliente ya tiene ${MAX_CUENTAS_ABIERTAS} cuentas no cerradas` });
            return;
        }

        for (let intento = 0; intento < MAX_INTENTOS_IBAN; intento++) {
            const new_account : AccountT = {
                _id : new ObjectId(),
                iban : generateIban(),
                clienteId : client_id,
                tipo,
                saldo : 0,
                descubiertoMax : tipo === "corriente" ? 50000 : 0,
                estado : "activa",
                creadaEn : new Date().toISOString()
            }
            try {
                await account_collection.insertOne(new_account);
                res.status(201).json(new_account);
                return;
            } catch (err) {
                if (duplicated_key(err) !== "iban") throw err;
            }
        }
        res.status(500).json({ error : "No se pudo generar un IBAN único" });
    } catch {
        res.status(500).json({ error : "Error al crear la cuenta" });
    }
}

export const get_account = async (req : Request, res : Response) => {
    const id = req.params.id;

    if (!is_object_id(id)) {
        res.status(400).json({ error : "El id no es un ObjectId válido" });
        return;
    }

    try {
        const account = await account_collection.findOne({ _id : new ObjectId(id) });
        if (!account) {
            res.status(404).json({ error : "No existe la cuenta" });
            return;
        }
        const owner = await client_collection.findOne({ _id : account.clienteId });
        res.json({
            ...account,
            titular : {
                nombre : owner?.nombre ?? null,
                email : owner?.email ?? null
            }
        });
    } catch {
        res.status(500).json({ error : "Error al buscar la cuenta" });
    }
}

export const get_account_movements = async (req : Request, res : Response) => {
    const id = req.params.id;

    if (!is_object_id(id)) {
        res.status(400).json({ error : "El id no es un ObjectId válido" });
        return;
    }

    const pagination = parse_pagination(req.query);
    if (typeof pagination === "string") {
        res.status(400).json({ error : pagination });
        return;
    }
    const { pagina, limite } = pagination;

    const filter : Filter<MovementsT> = { cuentaId : new ObjectId(id) };

    if (req.query.tipo !== undefined) {
        const tipos = String(req.query.tipo).split(",").map(t => t.trim()).filter(t => t !== "");
        if (tipos.length === 0 || !tipos.every(is_tipo_movimiento)) {
            res.status(400).json({ error : `tipo debe ser uno o varios de: ${TIPOS_MOVIMIENTO.join(", ")}` });
            return;
        }
        filter.tipo = { $in : tipos as TipoMovimiento[] };
    }

    if (req.query.categoria !== undefined) {
        filter.categoria = String(req.query.categoria);
    }

    const date_filter : { $gte? : string, $lt? : string } = {};
    if (req.query.desde !== undefined) {
        const from = parse_date(String(req.query.desde));
        if (!from) {
            res.status(400).json({ error : "desde no es una fecha válida" });
            return;
        }
        date_filter.$gte = from.toISOString();
    }
    if (req.query.hasta !== undefined) {
        const to = parse_date(String(req.query.hasta));
        if (!to) {
            res.status(400).json({ error : "hasta no es una fecha válida" });
            return;
        }
        if (/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.hasta))) {
            to.setUTCDate(to.getUTCDate() + 1);
        } else {
            to.setTime(to.getTime() + 1);
        }
        date_filter.$lt = to.toISOString();
    }
    if (date_filter.$gte && date_filter.$lt && date_filter.$gte >= date_filter.$lt) {
        res.status(400).json({ error : "desde debe ser anterior a hasta" });
        return;
    }
    if (date_filter.$gte || date_filter.$lt) {
        filter.fecha = date_filter;
    }

    const orden = req.query.orden === undefined ? "-fecha" : String(req.query.orden);
    if (orden !== "fecha" && orden !== "-fecha") {
        res.status(400).json({ error : "orden debe ser fecha o -fecha" });
        return;
    }
    const direction = orden === "fecha" ? 1 : -1;

    try {
        const account = await account_collection.findOne({ _id : new ObjectId(id) });
        if (!account) {
            res.status(404).json({ error : "No existe la cuenta" });
            return;
        }
        const [datos, total] = await Promise.all([
            movements_collection.find(filter)
                .sort({ fecha : direction, _id : direction })
                .skip((pagina - 1) * limite)
                .limit(limite)
                .toArray(),
            movements_collection.countDocuments(filter),
        ]);
        res.json(paginated(datos, pagina, limite, total));
    } catch {
        res.status(500).json({ error : "Error al obtener el extracto" });
    }
}

export const patch_account_state = async (req : Request, res : Response) => {
    const id = req.params.id;
    const estado = req.body?.estado;

    if (!is_object_id(id)) {
        res.status(400).json({ error : "El id no es un ObjectId válido" });
        return;
    }
    if (!is_estado_cuenta(estado)) {
        res.status(400).json({ error : `Estado '${estado}' no válido. Valores posibles: ${ESTADOS_CUENTA.join(", ")}` });
        return;
    }

    try {
        const account = await account_collection.findOne({ _id : new ObjectId(id) });
        if (!account) {
            res.status(404).json({ error : "No existe la cuenta" });
            return;
        }

        const current = account.estado;

        if (!ALLOWED_TRANSITIONS[current].includes(estado)) {
            res.status(409).json({ error : `Transición no permitida: estado actual '${current}', solicitado '${estado}'` });
            return;
        }
        if (estado === "cerrada" && account.saldo !== 0) {
            res.status(409).json({ error : `No se puede cerrar una cuenta con saldo distinto de 0 (saldo actual: ${account.saldo})` });
            return;
        }

        const filter : Filter<AccountT> = { _id : account._id, estado : current };
        if (estado === "cerrada") filter.saldo = 0;

        const result = await account_collection.findOneAndUpdate(
            filter,
            { $set : { estado } },
            { returnDocument : "after" }
        );
        if (!result) {
            res.status(409).json({ error : `La cuenta ha cambiado mientras se procesaba la petición (estado solicitado '${estado}'), inténtalo de nuevo` });
            return;
        }
        res.json(result);
    } catch {
        res.status(500).json({ error : "Error al cambiar el estado de la cuenta" });
    }
}

export const deposit_money = async (req : Request, res : Response) => {
    const id = req.params.id;

    if (!is_object_id(id)) {
        res.status(400).json({ error : "El id no es un ObjectId válido" });
        return;
    }

    const body = parse_operation_body(req.body);
    if (typeof body === "string") {
        res.status(400).json({ error : body });
        return;
    }

    const session = client.startSession();
    try {
        const movement = await session.withTransaction(async () => {
            const account = await account_collection.findOne({ _id : new ObjectId(id) }, { session });
            if (!account) throw new HttpError(404, "No existe la cuenta");

            check_account_operation(account, "ingreso");

            const updated = await account_collection.findOneAndUpdate(
                { _id : account._id },
                { $inc : { saldo : body.importe } },
                { session, returnDocument : "after" }
            );
            if (!updated) throw new HttpError(404, "No existe la cuenta");

            const new_movement : MovementsT = {
                _id : new ObjectId(),
                cuentaId : account._id,
                tipo : "ingreso",
                importe : body.importe,
                saldoResultante : updated.saldo,
                concepto : body.concepto,
                categoria : body.categoria,
                fecha : new Date().toISOString(),
            };
            await movements_collection.insertOne(new_movement, { session });
            return new_movement;
        });
        res.status(201).json(movement);
    } catch (err) {
        send_error(res, err, "Error al realizar el ingreso");
    } finally {
        await session.endSession();
    }
}

export const withdraw_money = async (req : Request, res : Response) => {
    const id = req.params.id;

    if (!is_object_id(id)) {
        res.status(400).json({ error : "El id no es un ObjectId válido" });
        return;
    }

    const body = parse_operation_body(req.body);
    if (typeof body === "string") {
        res.status(400).json({ error : body });
        return;
    }

    const session = client.startSession();
    try {
        const movement = await session.withTransaction(async () => {
            const account = await account_collection.findOne({ _id : new ObjectId(id) }, { session });
            if (!account) throw new HttpError(404, "No existe la cuenta");

            check_account_operation(account, "retirada");
            await check_withdrawal_rules(account, body.importe, body.importe, session);

            const updated = await account_collection.findOneAndUpdate(
                { _id : account._id },
                { $inc : { saldo : -body.importe } },
                { session, returnDocument : "after" }
            );
            if (!updated) throw new HttpError(404, "No existe la cuenta");

            const new_movement : MovementsT = {
                _id : new ObjectId(),
                cuentaId : account._id,
                tipo : "retirada",
                importe : -body.importe,
                saldoResultante : updated.saldo,
                concepto : body.concepto,
                categoria : body.categoria,
                fecha : new Date().toISOString(),
            };
            await movements_collection.insertOne(new_movement, { session });
            return new_movement;
        });
        res.status(201).json(movement);
    } catch (err) {
        send_error(res, err, "Error al realizar la retirada");
    } finally {
        await session.endSession();
    }
}

const ALLOWED_TRANSITIONS : Record<EstadoCuenta, EstadoCuenta[]> = {
    activa    : ["bloqueada", "cerrada"],
    bloqueada : ["activa", "cerrada"],
    cerrada   : [],
}

const is_estado_cuenta = (value : unknown) : value is EstadoCuenta =>
    typeof value === "string" && (ESTADOS_CUENTA as readonly string[]).includes(value);

const is_tipo_cuenta = (value : unknown) : value is TipoCuenta =>
    typeof value === "string" && (TIPOS_CUENTA as readonly string[]).includes(value);

const is_tipo_movimiento = (value : string) : value is TipoMovimiento =>
    (TIPOS_MOVIMIENTO as readonly string[]).includes(value);

export const check_account_operation = (account : AccountT, operation : TipoMovimiento) => {
    if (account.estado === "cerrada") {
        throw new HttpError(409, `La cuenta ${account.iban} está cerrada y no admite operaciones`);
    }
    if (account.estado === "bloqueada" && (operation === "retirada" || operation === "transferencia_emitida")) {
        throw new HttpError(409, `La cuenta ${account.iban} está bloqueada: solo admite ingresos y transferencias recibidas`);
    }
}

export type OperationBody = { importe : number, concepto : string, categoria : string };

export const parse_operation_body = (body : any) : OperationBody | string => {
    const importe = body?.importe;
    const concepto = body?.concepto;
    const categoria = body?.categoria;

    if (typeof importe !== "number" || !Number.isInteger(importe) || importe <= 0) {
        return "importe debe ser un número entero mayor que 0";
    }
    if (typeof concepto !== "string" || concepto.trim() === "") {
        return "concepto es obligatorio";
    }
    if (categoria !== undefined && (typeof categoria !== "string" || categoria.trim() === "")) {
        return "categoria debe ser un texto no vacío";
    }
    return { importe, concepto : concepto.trim(), categoria : categoria?.trim() ?? "otros" };
}

export const DAILY_WITHDRAWAL_LIMIT = 100000;

export const check_withdrawal_rules = async (account : AccountT, importe : number, total : number, session : ClientSession) => {
    const available = account.saldo + account.descubiertoMax;
    if (total > available) {
        throw new HttpError(409, `Saldo insuficiente: disponible ${available} céntimos (incluido descubierto), solicitado ${total}`);
    }

    const start_of_day = new Date();
    start_of_day.setHours(0, 0, 0, 0);

    const [result] = await movements_collection.aggregate<{ total : number }>([
        { $match : {
            cuentaId : account._id,
            tipo : { $in : ["retirada", "transferencia_emitida"] },
            fecha : { $gte : start_of_day.toISOString() },
        } },
        { $group : { _id : null, total : { $sum : { $abs : "$importe" } } } },
    ], { session }).toArray();

    const withdrawn_today = result?.total ?? 0;
    if (withdrawn_today + importe > DAILY_WITHDRAWAL_LIMIT) {
        throw new HttpError(409, `Límite diario superado: retirado hoy ${withdrawn_today} céntimos, solicitado ${importe}, límite ${DAILY_WITHDRAWAL_LIMIT}`);
    }
}

const parse_date = (str : string) : Date | null => {
    if (!/^\d{4}-\d{2}-\d{2}/.test(str)) return null;
    const date = new Date(str);
    return isNaN(date.getTime()) ? null : date;
}

const toNumeric = (str : string) : string =>
    [...str.toUpperCase()]
        .map(c => (c >= "A" && c <= "Z" ? String(c.charCodeAt(0) - 55) : c))
        .join("");

const mod97 = (numeric : string) : number => {
    let remainder = 0;
    for (let i = 0; i < numeric.length; i += 7) {
        const chunk = numeric.slice(i, i + 7);
        remainder = Number(String(remainder) + chunk) % 97;
    }
    return remainder;
};

const randomDigits = (length : number) : string =>
    Array.from({ length }, () => randomInt(0, 10)).join("");

export const isValidIban = (iban : unknown) : boolean => {
    if (typeof iban !== "string") return false;
    const value = iban.toUpperCase();
    if (!/^ES\d{22}$/.test(value)) return false;
    return mod97(toNumeric(value.slice(4) + value.slice(0, 4))) === 1;
};

export const generateIban = () : string => {
    const bban = randomDigits(20);
    const check = 98 - mod97(toNumeric(bban + "ES00"));
    return "ES" + String(check).padStart(2, "0") + bban;
};
