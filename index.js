// vim: set ts=4 sts=4 sw=4 expandtab :

// Requires
const http = require('http');
const express = require('express');
const ws = require('ws');
const path = require('path');

// Configuration
const PORT = process.env.PORT || 5000;

// HTTP application
const server = express()
    .use('/', express.static(path.join(__dirname, "www")))
    .listen(PORT);
console.log(`Chat server running on port ${PORT}`);
const wss = new ws.Server({ server:server });

// WebSocket application
wss.on('connection', socket=>{
    console.log("WebSocket connection opened");
    socket.on('message', json=>{
        const o = JSON.parse(json);
        switch(o.type) {
            case 'announcement':
                socket.pem = o.pem;
                const pemset = new Set();
                wss.clients.forEach(client=>{
                    if(client.readyState == ws.OPEN) {
                        const pem = client.pem
                        if(pem) pemset.add(pem);
                    }
                });
                const payload = JSON.stringify({
                    type: 'presences',
                    pems: [...pemset].sort(),
                })
                wss.clients.forEach(client=>{
                    if(client.readyState == ws.OPEN) {
                        client.send(payload);
                    }
                });
                break;
            case 'message':
                const source = who = socket.pem;
                wss.clients.forEach(client=>{
                    if((o.destination === client.pem) && 
                            (client.readyState == ws.OPEN)) {
                        client.send(JSON.stringify({
                            type:'message',
                            source: source,
                            payload: o.payload,
                        }));
                    }
                });
                break;
        }
    });
    socket.on('close', ()=>{
        console.log("WebSocket connection closed");
        const pem = socket.pem;
        if(pem) {
            const payload = JSON.stringify({
                type: 'leaved',
                pem: pem,
            });
            wss.clients.forEach(client=>{
                if((client != socket) && (client.readyState == ws.OPEN)) {
                    client.send(payload);
                }
            });
        }
    });
});

