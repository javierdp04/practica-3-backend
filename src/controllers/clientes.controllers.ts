import type { Request, Response } from "express";
import { Collection, ObjectId } from "mongodb";
import type { ClientT } from "../models/clientes.models.js"
import { duplicated_key, is_object_id, paginated, parse_pagination } from "../utils.js";

let client_collection : Collection<ClientT>

export const config_client_collection = (collection : Collection<ClientT>) => {
	client_collection = collection;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DNI_REGEX = /^\d{8}[A-Za-z]$/;

const duplicated_message = (key : string) =>
	key === "dni" ? "Ya existe un cliente con ese dni" : "Ya existe un cliente con ese email";

export const get_client = async (req : Request, res : Response) => {
	const id = req.params.id;

	if (!is_object_id(id)) {
		res.status(400).json({ error : "El id no es un ObjectId válido" });
		return;
	}

	try {
		const client = await client_collection.findOne({ _id : new ObjectId(id) });
		if (!client) {
			res.status(404).json({ error : "No existe el cliente" });
			return;
		}
		res.json(client);
	} catch {
		res.status(500).json({ error : "Error al buscar el cliente" });
	}
}

export const get_clients = async (req : Request, res : Response) => {
	const pagination = parse_pagination(req.query);
	if (typeof pagination === "string") {
		res.status(400).json({ error : pagination });
		return;
	}
	const { pagina, limite } = pagination;

	try {
		const [datos, total] = await Promise.all([
			client_collection.find().sort({ creadoEn : 1, _id : 1 }).skip((pagina - 1) * limite).limit(limite).toArray(),
			client_collection.countDocuments(),
		]);
		res.json(paginated(datos, pagina, limite, total));
	} catch {
		res.status(500).json({ error : "Error al listar los clientes" });
	}
}

export const post_client = async (req : Request, res : Response) => {
	const { nombre, email, dni } = req.body ?? {};

	if (typeof nombre !== "string" || nombre.trim() === "" ||
		typeof email !== "string" || email.trim() === "" ||
		typeof dni !== "string" || dni.trim() === "") {
		res.status(400).json({ error : "nombre, email y dni son obligatorios" });
		return;
	}
	if (!EMAIL_REGEX.test(email.trim())) {
		res.status(400).json({ error : "El email no tiene un formato válido" });
		return;
	}
	if (!DNI_REGEX.test(dni.trim())) {
		res.status(400).json({ error : "El dni debe tener 8 dígitos y una letra" });
		return;
	}

	const new_client : ClientT = {
		_id : new ObjectId(),
		nombre : nombre.trim(),
		email : email.trim().toLowerCase(),
		dni : dni.trim().toUpperCase(),
		creadoEn : new Date().toISOString()
	}

	try {
		await client_collection.insertOne(new_client);
		res.status(201).json(new_client);
	} catch (err) {
		const key = duplicated_key(err);
		if (key !== null) {
			res.status(409).json({ error : duplicated_message(key) });
			return;
		}
		res.status(500).json({ error : "Error al crear el cliente" });
	}
}

export const patch_client_email_or_name = async (req : Request, res : Response) => {
	const id = req.params.id;
	const body = req.body ?? {};

	if (!is_object_id(id)) {
		res.status(400).json({ error : "El id no es un ObjectId válido" });
		return;
	}
	if (body.dni !== undefined) {
		res.status(400).json({ error : "El dni no se puede modificar" });
		return;
	}

	const changes : Partial<Pick<ClientT, "nombre" | "email">> = {};

	if (body.nombre !== undefined) {
		if (typeof body.nombre !== "string" || body.nombre.trim() === "") {
			res.status(400).json({ error : "El nombre no puede estar vacío" });
			return;
		}
		changes.nombre = body.nombre.trim();
	}
	if (body.email !== undefined) {
		if (typeof body.email !== "string" || !EMAIL_REGEX.test(body.email.trim())) {
			res.status(400).json({ error : "El email no tiene un formato válido" });
			return;
		}
		changes.email = body.email.trim().toLowerCase();
	}
	if (Object.keys(changes).length === 0) {
		res.status(400).json({ error : "Hay que indicar nombre o email" });
		return;
	}

	try {
		const updated = await client_collection.findOneAndUpdate(
			{ _id : new ObjectId(id) },
			{ $set : changes },
			{ returnDocument : "after" }
		);
		if (!updated) {
			res.status(404).json({ error : "No existe el cliente" });
			return;
		}
		res.json(updated);
	} catch (err) {
		const key = duplicated_key(err);
		if (key !== null) {
			res.status(409).json({ error : duplicated_message(key) });
			return;
		}
		res.status(500).json({ error : "Error al modificar el cliente" });
	}
}
