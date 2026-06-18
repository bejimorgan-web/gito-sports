import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { getDatabase } from "./db/connection.js";
import validateUploadsAtStartup from "./startup/validateUploads.js";

// run lightweight uploads validation before starting the server
validateUploadsAtStartup();

const app = createApp();
getDatabase();

const port = Number(process.env.PORT ?? 3000);
app.listen(port, "0.0.0.0", () => {
  console.log(`GiTO backend listening on port ${port}`);
});

