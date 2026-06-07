import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import os from "os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;
const UPLOADS_DIR = path.join(__dirname, "uploads");

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
	fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

app.use(express.static(path.join(__dirname, "dist")));
app.use("/uploads", express.static(UPLOADS_DIR));
app.use(express.json());

wss.on("connection", (ws) => {
	console.log("Client connected");

	const pi = spawn("pi", ["--mode", "rpc", "--session-id", "web-ui"], {
		stdio: ["pipe", "pipe", "pipe"],
	});

	let buffer = "";
	pi.stdout.on("data", (data) => {
		buffer += data.toString();
		let lines = buffer.split("\n");
		buffer = lines.pop();

		for (const line of lines) {
			if (line.trim()) {
				ws.send(line);
			}
		}
	});

	pi.stderr.on("data", (data) => {
		console.error("Pi Error:", data.toString());
		ws.send(JSON.stringify({ type: "stderr", message: data.toString() }));
	});

	pi.on("exit", (code) => {
		console.log(`Pi exited with code ${code}`);
		ws.send(JSON.stringify({ type: "exit", code }));
	});

	ws.on("message", (message) => {
		try {
			const data = JSON.parse(message.toString());
			console.log("Incoming Message Type:", data.type);

			// Handle custom message for listing sessions
			if (data.type === "list_sessions") {
				console.log("Handling list_sessions locally...");
				const sessionBaseDir = path.join(os.homedir(), ".pi/agent/sessions");
				const workspaceSubDir = process.cwd().replace(/\//g, "-");
				const sessionDir = path.join(sessionBaseDir, `-${workspaceSubDir}-`);

				if (fs.existsSync(sessionDir)) {
					const files = fs.readdirSync(sessionDir)
						.filter(f => f.endsWith(".jsonl"))
						.map(f => ({
							name: f.split("_")[0],
							path: path.join(sessionDir, f)
						}))
						.sort((a, b) => b.name.localeCompare(a.name));

					ws.send(JSON.stringify({
						type: "response",
						command: "list_sessions",
						success: true,
						data: { sessions: files }
					}));
				} else {
					ws.send(JSON.stringify({
						type: "response",
						command: "list_sessions",
						success: true,
						data: { sessions: [] }
					}));
				}
				return;
			}

			// Handle file saving if attachments are present
			if (data.type === "prompt" && data.attachments && data.attachments.length > 0) {
				for (const att of data.attachments) {
					const filePath = path.join(UPLOADS_DIR, att.fileName);
					fs.writeFileSync(filePath, Buffer.from(att.content, "base64"));
					console.log(`File stored at: ${filePath}`);
					data.message = `[File stored at uploads/${att.fileName}]\n${data.message}`;
				}
			}

			pi.stdin.write(JSON.stringify(data) + "\n");
		} catch (e) {
			pi.stdin.write(message.toString() + "\n");
		}
	});

	ws.on("close", () => {
		console.log("Client disconnected");
		pi.kill();
	});
});

server.listen(PORT, () => {
	console.log(`Server running at http://localhost:${PORT}`);
});
