const express = require('express');
const { Octokit } = require("@octokit/rest");
const moment = require('moment-timezone');
const fetch = require('node-fetch');
const app = express();
const path = require('path');

app.use(express.static(path.join(__dirname, 'view')));
app.use(express.json());

const { GH_TOKEN, GH_OWNER, GH_REPO, AUTH_JSON_URL } = process.env;
const octokit = new Octokit({ auth: GH_TOKEN });
const DB_PATH = "setting/database.json";

// --- CORE UTILS ---
async function fetchDB() {
    const { data } = await octokit.repos.getContent({ owner: GH_OWNER, repo: GH_REPO, path: DB_PATH });
    return JSON.parse(Buffer.from(data.content, 'base64').toString());
}

async function commitDB(content, message) {
    let sha;
    try {
        const { data } = await octokit.repos.getContent({ owner: GH_OWNER, repo: GH_REPO, path: DB_PATH });
        sha = data.sha;
    } catch (e) { sha = null; }

    return octokit.repos.createOrUpdateFileContents({
        owner: GH_OWNER, repo: GH_REPO, path: DB_PATH,
        message: `[Vortunix Core] ${message}`,
        content: Buffer.from(JSON.stringify(content, null, 2)).toString('base64'),
        sha: sha
    });
}

// --- ENDPOINTS ---
app.get('/', (req, res) => {
    res.status(404).send(`
        <!DOCTYPE html>
        <html>
        <head><title>404 Not Found</title></head>
        <body style="font-family: sans-serif; text-align: center; padding-top: 50px;">
            <h1>404 Not Found</h1>
            <p>The resource you are looking for might have been removed or is temporarily unavailable.</p>
            <hr><address>Apache/2.4.41 (Ubuntu) Server at ${req.hostname} Port 443</address>
        </body>
        </html>
    `);
});

// 3. Tambahkan Route Fallback jika user akses url sembarang
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'view', 'index.html'));
});

// 1. Verifikasi Real-time & Auto-Logging
app.get('/api/verifikasi/:token', async (req, res) => {
    try {
        const db = await fetchDB();
        const botIndex = db.findIndex(b => b.token === req.params.token);
        
        if (botIndex !== -1) {
            const bot = db[botIndex];
            const timeNow = moment().tz("Asia/Jakarta").format("HH:mm:ss");
            
            // Log Activity
            const newLog = { 
                time: timeNow, 
                status: bot.status, 
                ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress 
            };
            if (!bot.logs) bot.logs = [];
            bot.logs.unshift(newLog);
            if (bot.logs.length > 10) bot.logs.pop();

            // Background Commit (tidak menunggu proses simpan selesai agar API cepat)
            commitDB(db, `Ping ${bot.ownerName}`).catch(e => {});

            res.json({ success: true, ...bot });
        } else {
            res.status(404).json({ success: false, message: "Invalid Node" });
        }
    } catch (e) { res.status(500).json({ success: false }); }
});

// 2. Dashboard Stats
app.get('/api/stats', async (req, res) => {
    try {
        const db = await fetchDB();
        res.json({
            total: db.length,
            active: db.filter(b => b.status === 'Active').length,
            banned: db.filter(b => b.status === 'Banned').length,
            nonactive: db.filter(b => b.status === 'Nonactive').length
        });
    } catch (e) { res.status(500).json({ error: "Stats fail" }); }
});

// 3. Live Logs Stream
app.get('/api/logs', async (req, res) => {
    try {
        const db = await fetchDB();
        let logs = [];
        db.forEach(b => { if(b.logs) b.logs.forEach(l => logs.push({ ...l, name: b.ownerName, number: b.number })); });
        logs.sort((a,b) => b.time.localeCompare(a.time));
        res.json(logs.slice(0, 20));
    } catch (e) { res.json([]); }
});

// 4. CRUD Operations
app.get('/api/list', async (req, res) => {
    try { res.json(await fetchDB()); } catch (e) { res.json([]); }
});

app.post('/api/sync', async (req, res) => {
    try {
        await commitDB(req.body.newList, req.body.action);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const response = await fetch(AUTH_JSON_URL);
        const users = await response.json();
        const user = users.find(u => u.username === username && u.password === password);
        user ? res.json({ success: true, username: user.username }) : res.status(401).json({ success: false });
    } catch (e) { res.status(500).json({ error: "Auth Service Error" }); }
});

module.exports = app;
