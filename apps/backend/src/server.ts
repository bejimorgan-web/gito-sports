import { createApp } from "./app";
import { env } from "./config/env";
import { getDatabase } from "./db/connection";
import validateUploadsAtStartup from "./startup/validateUploads";

// run lightweight uploads validation before starting the server
validateUploadsAtStartup();

const app = createApp();
getDatabase();

app.listen(env.port, () => {
  console.log(`GiTO backend listening on http://localhost:${env.port}`);
});

