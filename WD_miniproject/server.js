// Core Node.js modules used to create the server, read files, and resolve paths.
const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const ROOT = __dirname;
const CSV_PATH = path.join(ROOT, "data", "trains.csv");
const PORT = Number(process.env.PORT) || 3000;
const PORT_TRIES = 10;

// Basic content types for static files served by the Node server.
const MIME = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png"
};

function sendJson(response, status, body) {
    response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(body));
}

// Small CSV parser for this project. It handles commas inside quoted values.
function parseCsvRow(row) {
    const values = [];
    let current = "";
    let inQuotes = false;

    for (let index = 0; index < row.length; index += 1) {
        const char = row[index];

        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === "," && !inQuotes) {
            values.push(current.trim());
            current = "";
        } else {
            current += char;
        }
    }

    values.push(current.trim());
    return values;
}

// Reads trains.csv and groups individual stop rows into complete train objects.
async function readTrainData() {
    const csv = await fs.promises.readFile(CSV_PATH, "utf8");
    const lines = { western: new Map(), central: new Map(), harbour: new Map() };

    csv.split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(1)
        .forEach((row) => {
            const [
                trainNo,
                trainName,
                lineName,
                direction,
                station,
                stationOrder,
                time,
                platform,
                trainType,
                carCount,
                acLocal,
                dayType = "Weekday"
            ] = parseCsvRow(row);

            const lineKey = lineName.toLowerCase();
            if (!lines[lineKey]) return;

            // trainNo + direction gives one unique service in the timetable.
            const key = `${trainNo}-${direction}`;
            const trains = lines[lineKey];

            if (!trains.has(key)) {
                trains.set(key, {
                    trainNo,
                    trainName,
                    line: lineName,
                    direction,
                    trainType,
                    carCount: Number(carCount) || 0,
                    acLocal,
                    dayType,
                    stops: []
                });
            }

            trains.get(key).stops.push({
                station,
                order: Number(stationOrder) || 0,
                time,
                platform
            });
        });

    // Return plain arrays so the frontend can consume them directly as JSON.
    return Object.fromEntries(
        Object.entries(lines).map(([lineKey, trains]) => [
            lineKey,
            Array.from(trains.values())
                .map((train) => ({
                    ...train,
                    stops: train.stops.sort((first, second) => first.order - second.order)
                }))
                .sort((first, second) => first.stops[0].time.localeCompare(second.stops[0].time))
        ])
    );
}

// Serves HTML, CSS, JS, and image files from the project folder.
async function serveFile(urlPath, response) {
    const requestPath = urlPath === "/" ? "/index.html" : decodeURIComponent(urlPath);
    const filePath = path.join(ROOT, path.normalize(requestPath).replace(/^[/\\]+/, ""));

    // Prevent requests from escaping the project folder.
    if (!filePath.startsWith(ROOT)) {
        response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Forbidden");
        return;
    }

    try {
        const stats = await fs.promises.stat(filePath);
        const finalPath = stats.isDirectory() ? path.join(filePath, "index.html") : filePath;
        const type = MIME[path.extname(finalPath).toLowerCase()] || "application/octet-stream";
        response.writeHead(200, { "Content-Type": type });
        fs.createReadStream(finalPath).pipe(response);
    } catch (error) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Not found");
    }
}

// Main request handler: API routes first, then static files.
const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url, `http://${request.headers.host || "localhost"}`);

    if (request.method !== "GET") {
        response.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Method not allowed");
        return;
    }

    if (requestUrl.pathname === "/api/health") {
        sendJson(response, 200, { ok: true });
        return;
    }

    if (requestUrl.pathname.startsWith("/api/local-lines/")) {
        const lineKey = requestUrl.pathname.split("/").pop();

        if (!["western", "central", "harbour"].includes(lineKey)) {
            sendJson(response, 404, { error: "Line not found" });
            return;
        }

        try {
            const data = await readTrainData();
            sendJson(response, 200, { line: lineKey, trains: data[lineKey] || [] });
        } catch (error) {
            sendJson(response, 500, { error: error.message });
        }
        return;
    }

    await serveFile(requestUrl.pathname, response);
});

// If port 3000 is already busy, try the next port automatically.
function startServer(port = PORT, triesLeft = PORT_TRIES) {
    server.once("error", (error) => {
        if (error.code === "EADDRINUSE" && triesLeft > 1) {
            const nextPort = port + 1;
            console.log(`Port ${port} is busy. Trying http://localhost:${nextPort} ...`);
            startServer(nextPort, triesLeft - 1);
            return;
        }

        throw error;
    });

    server.listen(port, () => {
        console.log(`Mumbai Transit Hub running at http://localhost:${port}`);
    });
}

if (require.main === module) {
    startServer();
}

module.exports = { parseCsvRow, readTrainData, server, startServer };
