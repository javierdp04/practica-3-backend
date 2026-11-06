import { ObjectId } from "mongodb";

export const TIPOS_CUENTA = ["corriente", "ahorro"] as const;
export type TipoCuenta = typeof TIPOS_CUENTA[number];

export const ESTADOS_CUENTA = ["activa", "bloqueada", "cerrada"] as const;
export type EstadoCuenta = typeof ESTADOS_CUENTA[number];

export type AccountT = {
    _id : ObjectId,
    iban : string,
    clienteId : ObjectId,
    tipo : TipoCuenta,
    saldo : number,
    descubiertoMax : number,
    estado : EstadoCuenta,
    creadaEn : string
}
