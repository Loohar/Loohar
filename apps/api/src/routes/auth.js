import bcrypt from "bcrypt";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../utils/tokens.js";

const router = Router();

const credentialsSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(8),
    name: z.string().min(2).optional(),
    role: z.enum(["CUSTOMER", "RESTAURANT_OWNER"]).optional(),
    restaurantId: z.string().optional()
  })
});

router.post("/register", validate(credentialsSchema), async (req, res, next) => {
  try {
    const { email, password, name, role = "CUSTOMER", restaurantId } = req.body;
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { email, passwordHash, name: name || email, role, restaurantId }
    });
    res.status(201).json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role, restaurantId: user.restaurantId },
      accessToken: signAccessToken(user),
      refreshToken: signRefreshToken(user)
    });
  } catch (error) {
    next(error);
  }
});

router.post("/login", validate(credentialsSchema.pick({ body: true })), async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { email: req.body.email } });
    if (!user || !(await bcrypt.compare(req.body.password, user.passwordHash))) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    res.json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role, restaurantId: user.restaurantId },
      accessToken: signAccessToken(user),
      refreshToken: signRefreshToken(user)
    });
  } catch (error) {
    next(error);
  }
});

router.post("/refresh-token", async (req, res, next) => {
  try {
    const payload = verifyRefreshToken(req.body.refreshToken);
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) return res.status(401).json({ error: "Invalid refresh token" });
    res.json({ accessToken: signAccessToken(user), refreshToken: signRefreshToken(user) });
  } catch (error) {
    next(error);
  }
});

router.post("/logout", (req, res) => {
  res.status(204).send();
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

export default router;

