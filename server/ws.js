// 极简 WebSocket 服务端（RFC6455 文本帧），不依赖第三方包
// 只处理：握手、文本帧、关闭、ping/pong。够本项目的联机用。
// 可选 TLS：传入 opts.tls（{key,cert} 或 {pfx,passphrase}）即用 https 提供服务，直接支持 wss://
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { EventEmitter } = require('events');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const DEFAULT_MAX_PAYLOAD = 64 * 1024; // 单帧上限：本项目最大消息是整桌快照，远小于 64KB

function encodeFrame(opcode, payload) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
  let head;
  if (data.length < 126) {
    head = Buffer.from([0x80 | opcode, data.length]);
  } else if (data.length < 65536) {
    head = Buffer.alloc(4);
    head[0] = 0x80 | opcode;
    head[1] = 126;
    head.writeUInt16BE(data.length, 2);
  } else {
    head = Buffer.alloc(10);
    head[0] = 0x80 | opcode;
    head[1] = 127;
    head.writeUInt32BE(0, 2);
    head.writeUInt32BE(data.length, 6);
  }
  return Buffer.concat([head, data]);
}

class Conn extends EventEmitter {
  constructor(socket, opts) {
    super();
    this.socket = socket;
    this.alive = true;
    this.buf = Buffer.alloc(0);
    this.frag = null;          // 分片文本帧累积（{ parts, bytes }）
    this.closeEmitted = false;
    this.id = crypto.randomBytes(4).toString('hex');
    this.maxPayload = (opts && opts.maxPayload) || DEFAULT_MAX_PAYLOAD;
    this.lastSeen = Date.now(); // 任意入站数据都会刷新，用于清理死连接
    this.ip = String(socket.remoteAddress || '').replace(/^::ffff:/, '');

    socket.on('data', (chunk) => {
      this.lastSeen = Date.now();
      this.buf = Buffer.concat([this.buf, chunk]);
      this.drain();
    });
    socket.on('close', () => this.finish());
    // 对端只发 FIN（半关闭）不发 WebSocket close 帧：不少网络设备/崩溃进程就是这样断的，
    // 只监听 'close' 会把这个连接和它的座位永远留在内存里
    socket.on('end', () => { try { socket.end(); } catch (e) {} this.finish(); });
    socket.on('error', () => { try { socket.destroy(); } catch (e) {} this.finish(); });
  }

  finish() {
    if (this.closeEmitted) return;
    this.closeEmitted = true;
    this.alive = false;
    this.emit('close');
  }

  // 分片上限也按 maxPayload 算，避免用「很多小分片」绕过 64KB 限制
  appendFragment(opcode, payload, fin) {
    if (!this.frag) this.frag = { opcode, parts: [], bytes: 0 };
    this.frag.bytes += payload.length;
    if (this.frag.bytes > this.maxPayload) { this.close(); return null; }
    this.frag.parts.push(payload);
    if (!fin) return null;
    const text = Buffer.concat(this.frag.parts).toString('utf8');
    this.frag = null;
    return text;
  }

  drain() {
    while (this.alive && this.buf.length >= 2) {
      const b0 = this.buf[0];
      const b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (this.buf.length < 4) return;
        len = this.buf.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) return;
        len = Number(this.buf.readBigUInt64BE(2));
        offset = 10;
      }
      // 超大帧直接断开，避免公网上有人用畸形长度把内存吃满
      if (len > this.maxPayload) { this.close(); return; }
      let maskKey = null;
      if (masked) {
        if (this.buf.length < offset + 4) return;
        maskKey = this.buf.slice(offset, offset + 4);
        offset += 4;
      }
      if (this.buf.length < offset + len) return;
      const payloadRaw = this.buf.slice(offset, offset + len);
      this.buf = this.buf.slice(offset + len);

      // RFC6455：客户端帧必须掩码（浏览器 / 微信都会带），不带就是畸形客户端
      if (!masked && opcode !== 0xA) { this.close(); return; }

      let payload = payloadRaw;
      if (maskKey) {
        payload = Buffer.alloc(len);
        for (let i = 0; i < len; i++) payload[i] = payloadRaw[i] ^ maskKey[i % 4];
      }

      if (opcode === 0x1 || opcode === 0x0) {
        let text = null;
        if (opcode === 0x1 && !fin) {
          text = this.appendFragment(0x1, payload, false);
          continue;
        }
        if (opcode === 0x0) {
          if (!this.frag) { this.close(); return; }
          text = this.appendFragment(0x0, payload, fin);
          if (text === null) continue;
        } else {
          text = fin ? payload.toString('utf8') : null;
        }
        if (text === null) continue;
        let msg;
        try { msg = JSON.parse(text); } catch (e) { continue; }
        // 单个消息处理抛错不能带走整个进程（一条畸形消息就能打崩服务端）
        try { this.emit('message', msg); } catch (e) {
          console.error('[ws] 消息处理异常：' + (e && e.stack ? e.stack : e));
        }
      } else if (opcode === 0x8) {
        this.close();
      } else if (opcode === 0x9) {
        this.socket.write(encodeFrame(0xA, payload));
      } else if (opcode === 0xA) {
        // pong：lastSeen 已经在 data 事件刷新，这里不用额外处理
      }
    }
  }

  send(obj) {
    if (!this.alive) return;
    try { this.socket.write(encodeFrame(0x1, JSON.stringify(obj))); } catch (e) { /* ignore */ }
  }

  close() {
    if (!this.alive) return;
    this.alive = false;
    this.buf = Buffer.alloc(0);
    this.frag = null;
    try { this.socket.write(encodeFrame(0x8, Buffer.alloc(0))); } catch (e) {}
    try { this.socket.end(); } catch (e) {}
    this.finish();
  }
}

// opts: { host, tls: {key,cert} | {pfx,passphrase}, maxPayload, health: () => object, onListen: fn }
function createServer(port, onConn, opts) {
  opts = opts || {};
  const tls = opts.tls && (opts.tls.pfx || (opts.tls.key && opts.tls.cert)) ? opts.tls : null;
  const maxPayload = opts.maxPayload || DEFAULT_MAX_PAYLOAD;

  function handler(req, res) {
    const path = String(req.url || '').split('?')[0];
    if (path === '/health') {
      let extra = {};
      try { extra = opts.health ? opts.health() : {}; } catch (e) { extra = {}; }
      const body = JSON.stringify(Object.assign({
        ok: true,
        uptime: Math.round(process.uptime()),
        secure: !!tls
      }, extra));
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(body);
      return;
    }
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('guangxi13 relay server is running');
  }

  const server = tls ? https.createServer(tls, handler) : http.createServer(handler);

  server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    if (!key) { socket.destroy(); return; }
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
    );
    const conn = new Conn(socket, { maxPayload });
    if (onConn) onConn(conn, req);
  });

  server.on('clientError', (err, socket) => { try { socket.destroy(); } catch (e) {} });
  server.listen(port, opts.host || '0.0.0.0', opts.onListen);
  return server;
}

module.exports = { createServer, Conn };
