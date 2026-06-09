const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 环境变量
const privateKeyPem = process.env.PRIVATE_KEY;
const accessPassword = process.env.ACCESS_PASSWORD;
const workerUrl = process.env.WORKER_URL || 'https://your-worker.workers.dev';
const pagesUrl = process.env.PAGES_URL || '';  // 例如 https://你的用户名.github.io
const cloudflareApiToken = process.env.CLOUDFLARE_API_TOKEN;
const cloudflareAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const kvNamespaceId = process.env.KV_NAMESPACE_ID;

if (!privateKeyPem || !accessPassword) {
    console.error('Missing PRIVATE_KEY or ACCESS_PASSWORD secret');
    process.exit(1);
}

// 生成密钥对、哈希、签名
const privateKey = crypto.createPrivateKey({ key: privateKeyPem, format: 'pem', type: 'pkcs8' });
const publicKey = crypto.createPublicKey(privateKey);
const publicKeyJwk = publicKey.export({ format: 'jwk' });
const passwordHash = crypto.createHash('sha256').update(accessPassword).digest('hex');
const signature = crypto.sign('sha256', Buffer.from(passwordHash, 'hex'), {
    key: privateKey,
    padding: crypto.constants.RSA_PKCS1_PADDING
}).toString('hex');

// 读取 data 目录文件列表
const dataDir = path.join(__dirname, '..', '..', 'data');
let fileList = [];
if (fs.existsSync(dataDir)) {
    fileList = fs.readdirSync(dataDir)
        .map(name => {
            const filePath = path.join(dataDir, name);
            const stat = fs.statSync(filePath);
            return stat.isFile() ? { name, size: stat.size, mtime: stat.mtime.toISOString() } : null;
        })
        .filter(Boolean);
}

// 1. 生成 index.html
const templatePath = path.join(__dirname, '..', '..', 'index.html');
let html = fs.readFileSync(templatePath, 'utf-8');
html = html.replace('__PUBLIC_KEY_JWK__', JSON.stringify(publicKeyJwk));
html = html.replace('"__PASSWORD_HASH__"', JSON.stringify(passwordHash));
html = html.replace('"__SIGNATURE__"', JSON.stringify(signature));
html = html.replace('"__WORKER_URL__"', JSON.stringify(workerUrl));

// 2. 写入 dist 目录
const distDir = path.join(__dirname, '..', '..', 'dist');
fs.mkdirSync(distDir, { recursive: true });
fs.writeFileSync(path.join(distDir, 'index.html'), html);
if (fs.existsSync(dataDir)) {
    fs.cpSync(dataDir, path.join(distDir, 'data'), { recursive: true });
}

// 3. 上传文件列表和 Worker 环境变量到 Cloudflare KV
async function uploadToKV() {
    if (!cloudflareApiToken || !cloudflareAccountId || !kvNamespaceId) {
        console.log('Skipping KV upload – missing CF credentials');
        return;
    }

    const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${cloudflareAccountId}/storage/kv/namespaces/${kvNamespaceId}`;
    const headers = {
        'Authorization': `Bearer ${cloudflareApiToken}`,
        'Content-Type': 'application/json'
    };

    const putKV = async (key, value) => {
        const resp = await fetch(`${baseUrl}/values/${key}`, {
            method: 'PUT',
            headers,
            body: typeof value === 'string' ? value : JSON.stringify(value)
        });
        if (!resp.ok) {
            console.error(`Failed to upload ${key}: ${resp.status} ${await resp.text()}`);
        } else {
            console.log(`Uploaded ${key} to KV`);
        }
    };

    // 上传文件列表（Worker 通过 FILE_LIST_STORE 读取）
    await putKV('filelist', JSON.stringify(fileList));
    // 上传 Worker 所需的环境变量（也可以直接用 wrangler secret，这里提供 KV 方式作为备用）
    await putKV('password_hash', passwordHash);
    await putKV('signature', signature);       // 非必须，但可保留
    await putKV('public_key_jwk', JSON.stringify(publicKeyJwk));
}

uploadToKV().catch(err => {
    console.error('KV upload error:', err);
    process.exit(1);
});
