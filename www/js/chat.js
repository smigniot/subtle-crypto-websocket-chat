// vim: set ts=4 sts=4 sw=4 expandtab :

const KEY_ALGORITHM = {
    name: "RSA-OAEP",
    modulusLength: 4096,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: "SHA-256"
};

const STORE = {
    key_obtained: false,
    key_announced: true,
    participants: [],
    myhash: "-",
    messages: [],
};

window.addEventListener('load', () => {
    new Vue({ el: 'main', data: STORE,
        methods:{
            mom: when=>moment(when).format('HH:mm'),
        }
    });

    const oldPub = localStorage.getItem("id_rsa.pub");
    const oldPriv = localStorage.getItem("id_rsa");
    if(oldPub && oldPriv) {
        crypto.subtle.importKey("jwk",JSON.parse(oldPub),KEY_ALGORITHM,
                true, ["encrypt"]).then(pub=>{
            crypto.subtle.importKey("jwk",JSON.parse(oldPriv),KEY_ALGORITHM,
                    true, ["decrypt"]).then(priv=>{
                const key = {publicKey: pub, privateKey: priv};
                start(key);
            });
        });
    } else {
        crypto.subtle.generateKey(KEY_ALGORITHM,true,
                ["sign","encrypt","decrypt"]).then(key=>{
            crypto.subtle.exportKey("jwk", key.publicKey).then(pubJwk=>{
                crypto.subtle.exportKey("jwk", key.privateKey).then(privJwk=>{
                    localStorage.setItem("id_rsa.pub", JSON.stringify(pubJwk));
                    localStorage.setItem("id_rsa", JSON.stringify(privJwk));
                    start(key);
                });
            });
        });
    }
});

function ar2str(ar) {
    return String.fromCharCode.apply(null, 
        [...new Uint8Array(ar)]);
}
function ab2str(buf) {
    return String.fromCharCode.apply(null, new Uint8Array(buf));
}
function str2ab(str) {
    const buf = new ArrayBuffer(str.length); // 2 bytes for each char
    const bufView = new Uint8Array(buf);
    for (let i=0, strLen=str.length; i < strLen; i++) {
        bufView[i] = str.charCodeAt(i);
    }
    return buf;
}

function start(key) {
    STORE.key_obtained = true;
    crypto.subtle.exportKey("spki", key.publicKey).then(spki=>{
        const pem = ["-----BEGIN PUBLIC KEY-----",
            btoa(ab2str(spki)),
            "-----END PUBLIC KEY-----"].join("\n");
        STORE.myhash = stupidhash(pem);
        STORE.messages.push({
            who:"-",
            text:`Connected as ${STORE.myhash}`,
            when:Date.now(),
        });
        announce(key, pem);
    });
}

function announce(key, pem) {
    const host = location.origin.replace(/^http/, 'ws');
    const ws = new WebSocket(host);
    ws.onmessage = message => {
        const event = JSON.parse(message.data);
        switch(event.type) {
            case 'presences':
                handlePresences(pem, event.pems);
                break;
            case 'leaved':
                removePresence(event.pem);
                break;
            case 'message':
                handleMessage(key, event.source, event.payload);
                break;
        }
    };

    ws.onclose = () => {
        STORE.key_announced = false;
    }
    ws.onopen = () => {
        document.querySelector("#message").focus();
        ws.send(JSON.stringify({
            type:"announcement",
            pem: pem
        }));
        window.publish = () => { doPublish(ws); };
    };
}

function doPublish(ws) {
    const input = document.querySelector("input#message");
    const text = input.value;

    STORE.participants.filter(p=>p.accepted).forEach(p=>{
        crypto.subtle.encrypt(KEY_ALGORITHM, p.key, str2ab(text)).then(cipher=>{
            const payload = btoa(ar2str(cipher));
            console.log("SENDING");
            ws.send(JSON.stringify({
                type: "message",
                destination: p.pem,
                payload: payload
            }));
            STORE.messages.splice(0,0,{
                who:STORE.myhash,
                text:text,
                when:Date.now(),
            });
        });
    });
    
    input.value = "";
    input.focus();
}

function stupidhash(s) {
    const num = s.split("")
        .reduce((a,b)=>{
            a=((a<<5)-a)+b.charCodeAt(0);
            return a&a;
        },0);
    return Math.abs(num).toString(16).toUpperCase();
}

function handlePresences(myPem, otherPems) {
    if(otherPems.find(otherPem=>otherPem===myPem)) {
        STORE.key_announced = true;
    }
    const promises = otherPems
        .filter(otherPem=>otherPem != myPem)
        .map(otherPem=>new Promise((resolve,reject)=>{
            const b64 = otherPem.split(/[\r\n]+/g)
                .map(l=>l.trim())
                .filter(l=>!l.match(/-----/))
                .join("");
            const payload = str2ab(atob(b64));
            crypto.subtle.importKey("spki", payload, KEY_ALGORITHM,
                    true, ["encrypt"]).then(otherPub=>{
                resolve({
                    hash:stupidhash(otherPem),
                    pem:otherPem,
                    key:otherPub,
                    accepted:false,
                });
            }, reject);
        }));
    Promise.all(promises).then(others=>{
        const accepted = STORE.participants.reduce((acc,other)=>{
            if(other.accepted) {
                acc[other.pem] = true;
            }
            return acc;
        },{});
        others.forEach(other=>{
            if(accepted[other.pem]) {
                other.accepted = true;
            }
        });
        STORE.participants.splice(0,STORE.participants.length);
        others.forEach(other=>STORE.participants.push(other));
    });
}

function removePresence(removedPem) {
    let index = -1;
    for(let i=0, n=STORE.participants.length; i<n; i++) {
        if(STORE.participants[i].pem == removedPem) {
            index = i; break;
        }
    }
    if(index !== -1) {
        STORE.participants.splice(index, 1);
    }
}

function handleMessage(key, sourcePem, payload) {
    const when = Date.now();
    const who = stupidhash(sourcePem);
    const buf = str2ab(atob(payload));
    crypto.subtle.decrypt(KEY_ALGORITHM, key.privateKey, buf).then(plain=>{
        const text = ar2str(plain);
        STORE.messages.splice(0,0,{
            who:who,
            text:text,
            when:when,
        });
    });
    console.log("MSG", who, payload);
}

