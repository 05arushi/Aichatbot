import express from "express";
import { askAI ,getHistory,getSessionMessages,deleteSessionMessages} from "../Controller/aiController.js";

const router = express.Router();

router.post("/askai", askAI);
router.get("/gethistory",getHistory);
router.post("/getmessages",getSessionMessages);
router.post("/deletesession",deleteSessionMessages);

export default router;
