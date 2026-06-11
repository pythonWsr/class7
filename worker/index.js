// Cloudflare Worker - 班级共享云盘后端
const EXPIRY_DAYS = 7;

async function sha256(text) {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function getTokenFromHeader(request) {
    const auth = request.headers.get('Authorization');
    if (auth && auth.startsWith('Bearer ')) {
        return auth.slice(7);
    }
    return null;
}

async function checkToken(request, env) {
    const token = getTokenFromHeader(request);
    if (!token) return jsonResponse({ valid: false }, 401, env);

    const data = await env.DEVICE_STORE.get(token, 'json');
    if (!data || data.expiry < Date.now()) {
        return jsonResponse({ valid: false }, 401, env);
    }

    // 续期
    data.expiry = Date.now() + EXPIRY_DAYS * 24 * 60 * 60 * 1000;
    await env.DEVICE_STORE.put(token, JSON.stringify(data));
    return jsonResponse({ valid: true, expiry: data.expiry }, 200, env);
}

async function registerDevice(request, env) {
    if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405, env);

    let body;
    try {
        body = await request.json();
    } catch (e) {
        return jsonResponse({ error: 'Invalid JSON' }, 400, env);
    }

    const { token, device_proof } = body;
    if (!token || !device_proof) {
        return jsonResponse({ error: 'Missing parameters' }, 400, env);
    }

    // ✅ 从 KV 读取密码哈希（关键修正）
    const expectedHash = await env.FILE_LIST_STORE.get('password_hash');
    if (!expectedHash) {
        return jsonResponse({ error: 'Server config error' }, 500, env);
    }

    // 验证设备凭证
    const expectedProof = await sha256(expectedHash + token);
    if (device_proof !== expectedProof) {
        return jsonResponse({ success: false, error: 'Invalid device proof' }, 403, env);
    }

    // 检查是否已存在且未过期
    const existing = await env.DEVICE_STORE.get(token, 'json');
    if (existing && existing.expiry > Date.now()) {
        return jsonResponse({ success: true, message: 'Already registered' }, 200, env);
    }

    const entry = {
        expiry: Date.now() + EXPIRY_DAYS * 24 * 60 * 60 * 1000
    };
    await env.DEVICE_STORE.put(token, JSON.stringify(entry));
    return jsonResponse({ success: true }, 200, env);
}

async function getFileList(request, env) {
    const token = getTokenFromHeader(request);
    if (!token) return jsonResponse({ error: 'Token required' }, 401, env);

    const data = await env.DEVICE_STORE.get(token, 'json');
    if (!data || data.expiry < Date.now()) {
        return jsonResponse({ error: 'Unauthorized' }, 401, env);
    }

    const fileList = await env.FILE_LIST_STORE.get('filelist', 'json');
    if (!fileList) {
        return jsonResponse({ error: 'File list not found' }, 500, env);
    }
    return jsonResponse(fileList, 200, env);
}

function jsonResponse(data, status = 200, env) {
    // 从环境变量获取允许的源（由 wrangler.toml 或控制台设置）
    const allowedOrigin = env?.ALLOWED_ORIGIN || '*';
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': allowedOrigin,
            'Vary': 'Origin'
        }
    });
}

function handleOptions(request, env) {
    const allowedOrigin = env?.ALLOWED_ORIGIN || '*';
    return new Response(null, {
        headers: {
            'Access-Control-Allow-Origin': allowedOrigin,
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Authorization, Content-Type',
            'Access-Control-Max-Age': '86400',
        }
    });
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const path = url.pathname;

        if (request.method === 'OPTIONS') {
            return handleOptions(request, env);
        }

        if (path === '/api/check' && request.method === 'GET') {
            return checkToken(request, env);
        } else if (path === '/api/register' && request.method === 'POST') {
            return registerDevice(request, env);
        } else if (path === '/api/filelist' && request.method === 'GET') {
            return getFileList(request, env);
        }

        return new Response('Not Found', { status: 404 });
    }
};