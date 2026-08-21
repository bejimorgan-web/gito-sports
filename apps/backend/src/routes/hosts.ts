import { Router } from "express";

import type { CreateHostRequest, UpdateHostRequest } from "@gito/shared";
import { protectedRoute } from "../middleware/protected.js";
import { createHost, deleteHost, getHostById, listHosts, updateHost } from "../repositories/hosts-repository.js";

export const hostsRouter = Router();

hostsRouter.get("/", (request, response) => {
  const sportId = typeof request.query.sportId === "string" ? request.query.sportId : undefined;
  response.json({ data: listHosts(sportId) });
});

hostsRouter.get("/:hostId", (request, response) => {
  const host = getHostById(request.params.hostId);
  if (!host) {
    response.status(404).json({ error: "host_not_found" });
    return;
  }
  response.json({ data: host });
});

hostsRouter.post("/", protectedRoute, (request, response) => {
  try {
    const host = createHost(request.body as CreateHostRequest);
    response.status(201).json({ data: host });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message === "host_duplicate" ? 409 : 400;
    response.status(status).json({ error: message, message });
  }
});

hostsRouter.put("/:hostId", protectedRoute, (request, response) => {
  try {
    const host = updateHost(String(request.params.hostId ?? ""), request.body as UpdateHostRequest);
    if (!host) {
      response.status(404).json({ error: "host_not_found" });
      return;
    }
    response.json({ data: host });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message === "host_duplicate" ? 409 : 400;
    response.status(status).json({ error: message, message });
  }
});

hostsRouter.delete("/:hostId", protectedRoute, (request, response) => {
  try {
    if (!deleteHost(String(request.params.hostId ?? ""))) {
      response.status(404).json({ error: "host_not_found" });
      return;
    }
    response.status(204).send();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const count = Number((error as { count?: number }).count ?? 0);
    const friendlyMessage = message === "host_in_use"
      ? `This host cannot be deleted because ${count || "existing"} competition${count === 1 ? " uses" : "s use"} it.`
      : message;
    response.status(message === "host_in_use" ? 409 : 400).json({ error: message, message: friendlyMessage });
  }
});
