import { MongoServerError } from "mongodb";
import type { Request, Response } from "express";

export class HttpError extends Error {
    status : number;
    constructor(status : number, message : string) {
        super(message);
        this.status = status;
    }
}

export const send_error = (res : Response, err : unknown, fallback : string) => {
    if (err instanceof HttpError) {
        res.status(err.status).json({ error : err.message });
        return;
    }
    res.status(500).json({ error : fallback });
}

export const is_object_id = (value : unknown) : value is string =>
    typeof value === "string" && /^[0-9a-fA-F]{24}$/.test(value);

export const duplicated_key = (err : unknown) : string | null => {
    if (!(err instanceof MongoServerError) || err.code !== 11000) return null;
    return Object.keys(err.keyPattern ?? err.keyValue ?? {})[0] ?? "";
}

export const parse_pagination = (query : Request["query"]) : { pagina : number, limite : number } | string => {
    const pagina = query.pagina === undefined ? 1 : Number(query.pagina);
    const limite = query.limite === undefined ? 20 : Number(query.limite);
    if (!Number.isInteger(pagina) || pagina < 1) return "pagina debe ser un entero mayor o igual que 1";
    if (!Number.isInteger(limite) || limite < 1 || limite > 100) return "limite debe ser un entero entre 1 y 100";
    return { pagina, limite };
}

export const paginated = <T>(datos : T[], pagina : number, limite : number, totalElementos : number) => ({
    datos,
    pagina,
    limite,
    totalElementos,
    totalPaginas : Math.ceil(totalElementos / limite),
})
