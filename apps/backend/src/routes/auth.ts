import { Router } from "express";

import { createAccessToken } from "../services/jwt";

export const authRouter = Router();

authRouter.post("/login", (request, response) => {
  const { email } = request.body as { email?: string };

  if (!email) {
    response.status(400).json({ error: "email_required" });
    return;
  }

  const operator = {
    id: "local-operator",
    name: "Local Operator",
    email,
    role: "admin"
  };

  response.json({
    data: {
      operator,
      accessToken: createAccessToken({
        sub: operator.id,
        role: operator.role
      })
    }
  });
});

authRouter.post("/logout", (_request, response) => {
  response.status(204).send();
});
