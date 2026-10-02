import { createApplication } from "../server/src/application.js";

var app = createApplication(process.env, { root: process.cwd(), serveStatic: false });

export const config = { api: { bodyParser: false } };

export default function handler(req, res) {
  app.server.emit("request", req, res);
}