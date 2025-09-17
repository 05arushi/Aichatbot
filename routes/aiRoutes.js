import express from "express";
import { askAI } from "../Controller/aiController.js";

const router = express.Router();

router.post("/askai", askAI);

export default router;
