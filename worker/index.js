// Cloudflare Worker - 班级共享云盘后端
const EXPIRY_DAYS = 7;

// SHA-256 辅助函数 (使用 Web Crypto API)
async function sha256(text) {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// 从 Authorization 头提取 Bearer token
function getTokenFromHeader(request) {
    const auth = request.headers.get('Authorization');
    if (auth && auth.startsWith('Bearer ')) {
        return auth.slice(7);
    }
    return null;
}

// 检查令牌有效性并自动续期
async function checkToken(request, env) {
    const token = getTokenFromHeader(request);
    if (!token) return jsonResponse({ valid: false }, 401);

    const data = await env.DEVICE_STORE.get(token, 'json');
    if (!data || data.expiry < Date.now()) {
        return jsonResponse({ valid: false }, 401);
    }

    // 续期
    data.expiry = Date.now() + EXPIRY_DAYS * 24 * 60 * 60 * 1000;
    await env.DEVICE_STORE.put(token, JSON.stringify(data));
    return jsonResponse({ valid: true, expiry: data.expiry });
}

// 注册设备（需要 device_proof = SHA256(PASSWORD_HASH + token)）
async function registerDevice(request, env) {
    if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

    let body;
    try {
        body = await request.json();
    } catch (e) {
        return jsonResponse({ error: 'Invalid JSON' }, 400);
    }

    const { token, device_proof } = body;
    if (!token || !device_proof) {
        return jsonResponse({ error: 'Missing parameters' }, 400);
    }

    const expectedHash = env.PASSWORD_HASH;
    // 验证设备凭证：SHA256(PASSWORD_HASH + token)
    const expectedProof = await sha256(expectedHash + token);
    if (device_proof !== expectedProof) {
        return jsonResponse({ success: false, error: 'Invalid device proof' }, 403);
    }

    // 检查是否已存在且未过期，若已存在则直接返回成功（防止重复注册）
    const existing = await env.DEVICE_STORE.get(token, 'json');
    if (existing && existing.expiry > Date.now()) {
        return jsonResponse({ success: true, message: 'Already registered' });
    }

    const entry = {
        expiry: Date.now() + EXPIRY_DAYS * 24 * 60 * 60 * 1000
    };
    await env.DEVICE_STORE.put(token, JSON.stringify(entry));
    return jsonResponse({ success: true });
}

// 获取文件列表
async function getFileList(request, env) {
    const token = getTokenFromHeader(request);
    if (!token) return jsonResponse({ error: 'Token required' }, 401);

    const data = await env.DEVICE_STORE.get(token, 'json');
    if (!data || data.expiry < Date.now()) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const fileList = await env.FILE_LIST_STORE.get('filelist', 'json');
    if (!fileList) {
        return jsonResponse({ error: 'File list not found' }, 500);
    }
    return jsonResponse(fileList);
}

// JSON 响应辅助
function jsonResponse(data, status = 200) {
    const allowedOrigin = globalThis.ALLOWED_ORIGIN || '*'; // 由环境变量设置
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': allowedOrigin,
            'Vary': 'Origin'
        }
    });
}

// CORS 预检处理
function handleOptions(request) {
    const allowedOrigin = globalThis.ALLOWED_ORIGIN || '*';
    const headers = {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Max-Age': '86400',
    };
    return new Response(null, { headers });
}

export default {
    async fetch(request, env) {
        // 设置全局 ALLOWED_ORIGIN，便于 jsonResponse 使用
        globalThis.ALLOWED_ORIGIN = env.ALLOWED_ORIGIN || '';

        const url = new URL(request.url);
        const path = url.pathname;

        if (request.method === 'OPTIONS') {
            return handleOptions(request);
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