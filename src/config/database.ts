import { Db, MongoClient } from "mongodb";

const CLIENT_PASSWORD = process.env.CLIENT_PASSWORD || "";
export const client = new MongoClient(CLIENT_PASSWORD);

export const connect_mongo = async () : Promise<Db> => {
    return client.connect().then(() => {
        console.log("Succesfull conection");
        return client.db("backEndClases");
    }).catch((err) => {
        console.log("Error conecting");
        throw err;
    })
    
}
