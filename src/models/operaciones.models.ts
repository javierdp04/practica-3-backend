import { ObjectId } from "mongodb";

export const TIPOS_MOVIMIENTO = ["ingreso", "retirada", "transferencia_emitida", "transferencia_recibida", "comision"] as const;
export type TipoMovimiento = typeof TIPOS_MOVIMIENTO[number];

export type MovementsT = {
    _id : ObjectId,
    cuentaId : ObjectId,
    tipo : TipoMovimiento,
    importe : number,
    saldoResultante : number,
    concepto : string,
    categoria : string,
    transferenciaId? : ObjectId,
    fecha : string,
}
