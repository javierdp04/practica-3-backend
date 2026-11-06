import { ObjectId } from "mongodb";

export type ClientT = {
    _id : ObjectId,
    nombre : string,
    email : string,
    dni : string,
    creadoEn : string
}
