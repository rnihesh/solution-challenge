import "dotenv/config";
import express, { Application } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";

import { healthRoutes } from "./routes/health";
import { authRoutes } from "./routes/auth";
import { issueRoutes } from "./routes/issues";
import { sosRoutes } from "./routes/sos";
import { communityRoutes } from "./routes/community";
import { municipalityRoutes } from "./routes/municipalities";
import { uploadRoutes } from "./routes/upload";
import { classifyRoutes } from "./routes/classify";
import { adminRoutes } from "./routes/admin";
import { mlRoutes } from "./routes/ml";
import { errorHandler } from "./middleware/errorHandler";
import { notFoundHandler } from "./middleware/notFoundHandler";
import { startSlaMonitor } from "./services/sla";

const app: Application = express();
const PORT = process.env.PORT || 3001;

app.use(helmet());
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "*",
    credentials: true,
  })
);
app.use(morgan("combined"));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.use("/api/health", healthRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/issues", issueRoutes);
app.use("/api/sos", sosRoutes);
app.use("/api/community", communityRoutes);
app.use("/api/municipalities", municipalityRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/classify", classifyRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/ml", mlRoutes);

app.get("/", (_req, res) => {
  res.json({
    name: "GDG HackXtreme API",
    version: "1.0.0",
    status: "running",
    timestamp: new Date().toISOString(),
  });
});

app.use(notFoundHandler);
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`API available at http://localhost:${PORT}/api`);
  console.log(`Health check at http://localhost:${PORT}/api/health`);
  startSlaMonitor();
});

export default app;
